/**
 * Storage Manager
 * Handles Chrome storage with fallback to localStorage
 */

class StorageManager
{
    constructor()
    {
        this.logger = typeof Logger !== 'undefined' ? new Logger('StorageManager') : console;
        this.storage = this.getStorageAPI();
        this.cache = new Map();
        this.listeners = new Map();
    }

    /**
     * Get appropriate storage API
     */
    getStorageAPI()
    {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
        {
            return chrome.storage.local;
        }

        // Fallback to localStorage wrapper
        return {
            get: (keys) => this.localStorageGet(keys),
            set: (items) => this.localStorageSet(items),
            remove: (keys) => this.localStorageRemove(keys),
            clear: () => this.localStorageClear()
        };
    }

    /**
     * LocalStorage fallback - get
     */
    async localStorageGet(keys)
    {
        return new Promise((resolve) =>
        {
            const result = {};
            const keysArray = Array.isArray(keys) ? keys : [keys];

            keysArray.forEach(key =>
            {
                try
                {
                    const value = localStorage.getItem(`fokus_${key}`);
                    if (value !== null)
                    {
                        result[key] = JSON.parse(value);
                    }
                } catch (error)
                {
                    this.logger.error(`Failed to get ${key} from localStorage:`, error);
                }
            });

            resolve(result);
        });
    }

    /**
     * LocalStorage fallback - set
     */
    async localStorageSet(items)
    {
        return new Promise((resolve, reject) =>
        {
            try
            {
                Object.entries(items).forEach(([key, value]) =>
                {
                    localStorage.setItem(`fokus_${key}`, JSON.stringify(value));
                });
                resolve();
            } catch (error)
            {
                this.logger.error('Failed to set localStorage:', error);
                reject(error);
            }
        });
    }

    /**
     * LocalStorage fallback - remove
     */
    async localStorageRemove(keys)
    {
        return new Promise((resolve) =>
        {
            const keysArray = Array.isArray(keys) ? keys : [keys];
            keysArray.forEach(key =>
            {
                localStorage.removeItem(`fokus_${key}`);
            });
            resolve();
        });
    }

    /**
     * LocalStorage fallback - clear
     */
    async localStorageClear()
    {
        return new Promise((resolve) =>
        {
            const keys = Object.keys(localStorage);
            keys.forEach(key =>
            {
                if (key.startsWith('fokus_'))
                {
                    localStorage.removeItem(key);
                }
            });
            resolve();
        });
    }

    /**
     * Get data from storage
     */
    async get(key, defaultValue = null)
    {
        try
        {
            // Check cache first
            if (this.cache.has(key))
            {
                const cached = this.cache.get(key);
                if (cached.expiry > Date.now())
                {
                    this.logger.debug(`Cache hit for ${key}`);
                    return cached.value;
                }
                this.cache.delete(key);
            }

            // Get from storage
            const result = await this.storage.get(key);
            const value = result[key];

            if (value !== undefined)
            {
                // Update cache
                this.updateCache(key, value);
                return value;
            }

            return defaultValue;
        } catch (error)
        {
            this.logger.error(`Failed to get ${key}:`, error);
            return defaultValue;
        }
    }

    /**
     * Get multiple values
     */
    async getMultiple(keys)
    {
        try
        {
            const result = await this.storage.get(keys);

            // Update cache for retrieved values
            Object.entries(result).forEach(([key, value]) =>
            {
                this.updateCache(key, value);
            });

            return result;
        } catch (error)
        {
            this.logger.error('Failed to get multiple values:', error);
            return {};
        }
    }

    /**
     * Set data in storage
     */
    async set(key, value)
    {
        try
        {
            const dataToStore = {
                [key]: {
                    ...value,
                    _timestamp: Date.now()
                }
            };

            await this.storage.set(dataToStore);

            // Update cache
            this.updateCache(key, value);

            // Notify listeners
            this.notifyListeners(key, value);

            this.logger.debug(`Stored ${key}`);
            return true;
        } catch (error)
        {
            this.logger.error(`Failed to set ${key}:`, error);

            // Check if quota exceeded
            if (error.message && error.message.includes('quota'))
            {
                await this.handleQuotaExceeded();
                // Retry once
                try
                {
                    await this.storage.set({ [key]: value });
                    return true;
                } catch (retryError)
                {
                    this.logger.error('Retry failed:', retryError);
                }
            }

            return false;
        }
    }

    /**
     * Set multiple values
     */
    async setMultiple(items)
    {
        try
        {
            const dataToStore = {};

            Object.entries(items).forEach(([key, value]) =>
            {
                dataToStore[key] = {
                    ...value,
                    _timestamp: Date.now()
                };
                this.updateCache(key, value);
            });

            await this.storage.set(dataToStore);

            // Notify listeners
            Object.entries(items).forEach(([key, value]) =>
            {
                this.notifyListeners(key, value);
            });

            return true;
        } catch (error)
        {
            this.logger.error('Failed to set multiple values:', error);
            return false;
        }
    }

    /**
     * Remove data from storage
     */
    async remove(key)
    {
        try
        {
            await this.storage.remove(key);
            this.cache.delete(key);
            this.notifyListeners(key, null);
            this.logger.debug(`Removed ${key}`);
            return true;
        } catch (error)
        {
            this.logger.error(`Failed to remove ${key}:`, error);
            return false;
        }
    }

    /**
     * Clear all storage
     */
    async clear()
    {
        try
        {
            await this.storage.clear();
            this.cache.clear();
            this.logger.info('Storage cleared');
            return true;
        } catch (error)
        {
            this.logger.error('Failed to clear storage:', error);
            return false;
        }
    }

    /**
     * Update cache
     */
    updateCache(key, value, ttl = 300000)
    { // 5 minutes default TTL
        this.cache.set(key, {
            value,
            expiry: Date.now() + ttl
        });
    }

    /**
     * Clear expired cache entries
     */
    clearExpiredCache()
    {
        const now = Date.now();
        let cleared = 0;

        this.cache.forEach((cached, key) =>
        {
            if (cached.expiry <= now)
            {
                this.cache.delete(key);
                cleared++;
            }
        });

        if (cleared > 0)
        {
            this.logger.debug(`Cleared ${cleared} expired cache entries`);
        }
    }

    /**
     * Handle quota exceeded error
     */
    async handleQuotaExceeded()
    {
        this.logger.warn('Storage quota exceeded, cleaning up...');

        try
        {
            // Get all storage data
            const allData = await this.storage.get(null);

            // Find old entries
            const entries = Object.entries(allData)
                .map(([key, value]) => ({
                    key,
                    value,
                    timestamp: value._timestamp || 0
                }))
                .sort((a, b) => a.timestamp - b.timestamp);

            // Remove oldest 20% of entries
            const toRemove = Math.ceil(entries.length * 0.2);
            const keysToRemove = entries.slice(0, toRemove).map(e => e.key);

            if (keysToRemove.length > 0)
            {
                await this.storage.remove(keysToRemove);
                this.logger.info(`Removed ${keysToRemove.length} old entries to free space`);
            }
        } catch (error)
        {
            this.logger.error('Failed to handle quota exceeded:', error);
        }
    }

    /**
     * Add storage change listener
     */
    addListener(key, callback)
    {
        if (!this.listeners.has(key))
        {
            this.listeners.set(key, new Set());
        }

        this.listeners.get(key).add(callback);

        // Set up Chrome storage listener if not already set
        if (chrome.storage && chrome.storage.onChanged && this.listeners.size === 1)
        {
            chrome.storage.onChanged.addListener(this.handleStorageChange.bind(this));
        }

        // Return unsubscribe function
        return () =>
        {
            const callbacks = this.listeners.get(key);
            if (callbacks)
            {
                callbacks.delete(callback);
                if (callbacks.size === 0)
                {
                    this.listeners.delete(key);
                }
            }
        };
    }

    /**
     * Handle Chrome storage changes
     */
    handleStorageChange(changes, areaName)
    {
        if (areaName !== 'local') return;

        Object.entries(changes).forEach(([key, change]) =>
        {
            this.notifyListeners(key, change.newValue);
        });
    }

    /**
     * Notify listeners of changes
     */
    notifyListeners(key, newValue)
    {
        const callbacks = this.listeners.get(key);
        if (callbacks)
        {
            callbacks.forEach(callback =>
            {
                try
                {
                    callback(newValue);
                } catch (error)
                {
                    this.logger.error('Listener callback error:', error);
                }
            });
        }
    }

    /**
     * Get storage usage
     */
    async getUsage()
    {
        try
        {
            if (chrome.storage && chrome.storage.local.getBytesInUse)
            {
                const bytesInUse = await new Promise((resolve) =>
                {
                    chrome.storage.local.getBytesInUse(null, resolve);
                });

                const quota = chrome.storage.local.QUOTA_BYTES;

                return {
                    used: bytesInUse,
                    total: quota,
                    percentage: Math.round((bytesInUse / quota) * 100)
                };
            }

            // Fallback for localStorage
            const used = new Blob(Object.values(localStorage)).size;
            const total = 5 * 1024 * 1024; // 5MB typical localStorage limit

            return {
                used,
                total,
                percentage: Math.round((used / total) * 100)
            };
        } catch (error)
        {
            this.logger.error('Failed to get storage usage:', error);
            return { used: 0, total: 0, percentage: 0 };
        }
    }

    /**
     * Export all storage data
     */
    async exportData()
    {
        try
        {
            const data = await this.storage.get(null);
            return {
                data,
                exportDate: new Date().toISOString(),
                version: '1.0.0'
            };
        } catch (error)
        {
            this.logger.error('Failed to export data:', error);
            return null;
        }
    }

    /**
     * Import storage data
     */
    async importData(importData)
    {
        try
        {
            if (!importData.data || !importData.version)
            {
                throw new Error('Invalid import data format');
            }

            // Clear existing data
            await this.clear();

            // Import new data
            await this.storage.set(importData.data);

            this.logger.info('Data imported successfully');
            return true;
        } catch (error)
        {
            this.logger.error('Failed to import data:', error);
            return false;
        }
    }
}

// Export singleton instance
const storageManager = new StorageManager();

// Make available globally if in browser context
if (typeof window !== 'undefined')
{
    window.StorageManager = StorageManager;
    window.storageManager = storageManager;
}