/**
 * Sync Service
 * Handles data synchronization between extension and Supabase
 */

import CONFIG from '../config.js';
import { Logger } from '../utils/logger.js';
import { StorageManager } from '../utils/storage.js';
import { supabaseClient } from '../supabaseClient.js';

export class SyncService
{
    constructor()
    {
        this.logger = new Logger('SyncService');
        this.storage = new StorageManager();
        this.syncInterval = null;
        this.syncInProgress = false;
        this.lastSyncTime = null;
        this.syncQueue = [];
        this.retryCount = 0;
        this.maxRetries = CONFIG.SYNC.RETRY_ATTEMPTS;
        this.isOnline = navigator.onLine;
        this.setupEventListeners();
    }

    /**
     * Setup event listeners
     */
    setupEventListeners()
    {
        // Listen for online/offline events
        window.addEventListener('online', () =>
        {
            this.logger.info('Connection restored');
            this.isOnline = true;
            this.processSyncQueue();
        });

        window.addEventListener('offline', () =>
        {
            this.logger.info('Connection lost');
            this.isOnline = false;
        });

        // Listen for storage changes
        if (chrome.storage && chrome.storage.onChanged)
        {
            chrome.storage.onChanged.addListener((changes, areaName) =>
            {
                if (areaName === 'local')
                {
                    this.handleStorageChange(changes);
                }
            });
        }
    }

    /**
     * Start sync service
     */
    start()
    {
        if (this.syncInterval)
        {
            this.logger.warn('Sync service already running');
            return;
        }

        this.logger.info('Starting sync service');

        // Initial sync
        this.syncNow();

        // Set up periodic sync
        this.syncInterval = setInterval(() =>
        {
            this.syncNow();
        }, CONFIG.SYNC.INTERVAL);
    }

    /**
     * Stop sync service
     */
    stop()
    {
        if (this.syncInterval)
        {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }

        this.logger.info('Sync service stopped');
    }

    /**
     * Perform immediate sync
     */
    async syncNow()
    {
        if (this.syncInProgress)
        {
            this.logger.debug('Sync already in progress');
            return { success: false, message: 'Sync already in progress' };
        }

        if (!this.isOnline)
        {
            this.logger.debug('Offline, queueing sync');
            return { success: false, message: 'Offline' };
        }

        this.syncInProgress = true;
        const startTime = Date.now();

        try
        {
            this.logger.info('Starting sync...');

            // Check authentication
            const user = await supabaseClient.getCurrentUser();
            if (!user)
            {
                this.logger.warn('User not authenticated, skipping sync');
                return { success: false, message: 'Not authenticated' };
            }

            // Process sync queue first
            await this.processSyncQueue();

            // Sync different data types
            const results = await Promise.allSettled([
                this.syncBlocklist(),
                this.syncStats(),
                this.syncSettings(),
                this.syncDevices()
            ]);

            // Check results
            const errors = results.filter(r => r.status === 'rejected');
            if (errors.length > 0)
            {
                this.logger.warn(`Sync completed with ${errors.length} errors`);
                errors.forEach(e => this.logger.error('Sync error:', e.reason));
            }

            // Update last sync time
            this.lastSyncTime = new Date().toISOString();
            await this.storage.set('last_sync_time', this.lastSyncTime);

            const duration = Date.now() - startTime;
            this.logger.info(`Sync completed in ${duration}ms`);

            // Reset retry count on success
            this.retryCount = 0;

            return {
                success: true,
                duration,
                lastSyncTime: this.lastSyncTime,
                errors: errors.length
            };
        } catch (error)
        {
            this.logger.error('Sync failed:', error);

            // Increment retry count
            this.retryCount++;

            // Schedule retry if under max retries
            if (this.retryCount < this.maxRetries)
            {
                const retryDelay = CONFIG.SYNC.RETRY_DELAY * Math.pow(2, this.retryCount - 1);
                this.logger.info(`Scheduling retry ${this.retryCount}/${this.maxRetries} in ${retryDelay}ms`);
                setTimeout(() => this.syncNow(), retryDelay);
            }

            return {
                success: false,
                error: error.message
            };
        } finally
        {
            this.syncInProgress = false;
        }
    }

    /**
     * Sync blocklist
     */
    async syncBlocklist()
    {
        try
        {
            const localBlocklist = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST);
            const remoteResult = await supabaseClient.getUserBlocklist();

            if (!remoteResult.success)
            {
                throw new Error('Failed to fetch remote blocklist');
            }

            const remoteBlocklist = remoteResult.data;

            // Compare and resolve conflicts
            const resolved = await this.resolveBlocklistConflicts(localBlocklist, remoteBlocklist);

            if (resolved.hasChanges)
            {
                // Update remote if local has changes
                if (resolved.localChanges)
                {
                    await supabaseClient.updateUserBlocklist(resolved.merged);
                }

                // Update local cache
                await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST, resolved.merged);

                this.logger.info('Blocklist synced successfully');
            }

            return { success: true };
        } catch (error)
        {
            this.logger.error('Blocklist sync error:', error);
            throw error;
        }
    }

    /**
     * Resolve blocklist conflicts
     */
    async resolveBlocklistConflicts(local, remote)
    {
        if (!local && !remote)
        {
            return { hasChanges: false, merged: null };
        }

        if (!local)
        {
            return { hasChanges: true, localChanges: false, merged: remote };
        }

        if (!remote)
        {
            return { hasChanges: true, localChanges: true, merged: local };
        }

        // Compare timestamps for conflict resolution
        const localTimestamp = local._timestamp || 0;
        const remoteTimestamp = new Date(remote.updated_at).getTime();

        let merged;
        let localChanges = false;

        if (CONFIG.SYNC.CONFLICT_RESOLUTION === 'server_wins')
        {
            merged = remote;
        } else if (CONFIG.SYNC.CONFLICT_RESOLUTION === 'client_wins')
        {
            merged = local;
            localChanges = true;
        } else
        {
            // Merge strategy - combine unique items
            merged = {
                ...remote,
                keywords: [...new Set([...(local.keywords || []), ...(remote.keywords || [])])],
                domains: [...new Set([...(local.domains || []), ...(remote.domains || [])])],
                github_urls: [...new Set([...(local.github_urls || []), ...(remote.github_urls || [])])]
            };

            // Check if local has unique items
            localChanges =
                merged.keywords.length > remote.keywords.length ||
                merged.domains.length > remote.domains.length ||
                merged.github_urls.length > remote.github_urls.length;
        }

        const hasChanges = JSON.stringify(local) !== JSON.stringify(merged);

        return { hasChanges, localChanges, merged };
    }

    /**
     * Sync statistics
     */
    async syncStats()
    {
        try
        {
            // Get pending stats from queue
            const pendingStats = await this.storage.get('pending_stats_sync');

            if (pendingStats && pendingStats.length > 0)
            {
                // Batch upload stats
                for (const stat of pendingStats)
                {
                    await supabaseClient.logBlockEvent(stat);
                }

                // Clear pending stats
                await this.storage.remove('pending_stats_sync');
                this.logger.info(`Synced ${pendingStats.length} pending stats`);
            }

            // Fetch latest stats from server
            const remoteStats = await supabaseClient.getUserStats();

            if (remoteStats.success)
            {
                await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.STATS, remoteStats.data);
            }

            return { success: true };
        } catch (error)
        {
            this.logger.error('Stats sync error:', error);
            throw error;
        }
    }

    /**
     * Sync settings
     */
    async syncSettings()
    {
        try
        {
            const localSettings = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.SETTINGS);

            if (!localSettings)
            {
                return { success: true };
            }

            // Settings are primarily local, but we can sync certain preferences
            const user = await supabaseClient.getCurrentUser();
            if (user)
            {
                // Update user metadata with settings
                const { error } = await supabaseClient.client.auth.updateUser({
                    data: {
                        extension_settings: localSettings
                    }
                });

                if (error)
                {
                    throw error;
                }
            }

            return { success: true };
        } catch (error)
        {
            this.logger.error('Settings sync error:', error);
            throw error;
        }
    }

    /**
     * Sync devices
     */
    async syncDevices()
    {
        try
        {
            const deviceInfo = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.DEVICE);

            if (!deviceInfo)
            {
                // Register device if not already registered
                const result = await supabaseClient.registerDevice(await this.getDeviceInfo());
                if (!result.success)
                {
                    throw new Error('Failed to register device');
                }
            } else
            {
                // Update last activity
                await this.updateDeviceActivity();
            }

            return { success: true };
        } catch (error)
        {
            this.logger.error('Device sync error:', error);
            throw error;
        }
    }

    /**
     * Get device info
     */
    async getDeviceInfo()
    {
        const info = {
            uuid: await this.getDeviceUUID(),
            browserName: this.getBrowserName(),
            browserVersion: this.getBrowserVersion(),
            os: this.getOperatingSystem(),
            name: `${this.getBrowserName()} on ${this.getOperatingSystem()}`
        };

        return info;
    }

    /**
     * Get or generate device UUID
     */
    async getDeviceUUID()
    {
        let uuid = await this.storage.get('device_uuid');

        if (!uuid)
        {
            uuid = crypto.randomUUID();
            await this.storage.set('device_uuid', uuid);
        }

        return uuid;
    }

    /**
     * Get browser name
     */
    getBrowserName()
    {
        const userAgent = navigator.userAgent;

        if (userAgent.includes('Chrome')) return 'Chrome';
        if (userAgent.includes('Firefox')) return 'Firefox';
        if (userAgent.includes('Safari')) return 'Safari';
        if (userAgent.includes('Edge')) return 'Edge';
        if (userAgent.includes('Opera')) return 'Opera';

        return 'Unknown';
    }

    /**
     * Get browser version
     */
    getBrowserVersion()
    {
        const userAgent = navigator.userAgent;
        const match = userAgent.match(/(Chrome|Firefox|Safari|Edge|Opera)\/(\d+\.\d+)/);
        return match ? match[2] : 'Unknown';
    }

    /**
     * Get operating system
     */
    getOperatingSystem()
    {
        const platform = navigator.platform;
        const userAgent = navigator.userAgent;

        if (platform.startsWith('Win')) return 'Windows';
        if (platform.startsWith('Mac')) return 'macOS';
        if (platform.includes('Linux')) return 'Linux';
        if (/Android/.test(userAgent)) return 'Android';
        if (/iPhone|iPad|iPod/.test(userAgent)) return 'iOS';

        return 'Unknown';
    }

    /**
     * Update device activity
     */
    async updateDeviceActivity()
    {
        try
        {
            const device = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.DEVICE);
            if (!device) return;

            const { error } = await supabaseClient.client
                .from('devices')
                .update({
                    last_activity: new Date().toISOString()
                })
                .eq('id', device.id);

            if (error)
            {
                throw error;
            }
        } catch (error)
        {
            this.logger.error('Failed to update device activity:', error);
        }
    }

    /**
     * Handle storage change
     */
    handleStorageChange(changes)
    {
        // Queue changes for sync
        Object.entries(changes).forEach(([key, change]) =>
        {
            if (this.shouldSyncKey(key))
            {
                this.queueSync({
                    key,
                    oldValue: change.oldValue,
                    newValue: change.newValue,
                    timestamp: Date.now()
                });
            }
        });
    }

    /**
     * Check if key should be synced
     */
    shouldSyncKey(key)
    {
        const syncKeys = [
            CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST,
            CONFIG.CACHE.STORAGE_KEYS.SETTINGS
        ];

        return syncKeys.includes(key);
    }

    /**
     * Queue sync operation
     */
    queueSync(operation)
    {
        this.syncQueue.push(operation);

        // Debounce sync
        if (this.syncDebounceTimer)
        {
            clearTimeout(this.syncDebounceTimer);
        }

        this.syncDebounceTimer = setTimeout(() =>
        {
            this.processSyncQueue();
        }, 1000);
    }

    /**
     * Process sync queue
     */
    async processSyncQueue()
    {
        if (this.syncQueue.length === 0) return;
        if (!this.isOnline) return;

        const queue = [...this.syncQueue];
        this.syncQueue = [];

        try
        {
            for (const operation of queue)
            {
                await this.processSyncOperation(operation);
            }
        } catch (error)
        {
            this.logger.error('Failed to process sync queue:', error);
            // Re-add failed operations to queue
            this.syncQueue.unshift(...queue);
        }
    }

    /**
     * Process individual sync operation
     */
    async processSyncOperation(operation)
    {
        switch (operation.key)
        {
            case CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST:
                await supabaseClient.updateUserBlocklist(operation.newValue);
                break;

            case CONFIG.CACHE.STORAGE_KEYS.SETTINGS:
                // Sync settings to user metadata
                await supabaseClient.client.auth.updateUser({
                    data: {
                        extension_settings: operation.newValue
                    }
                });
                break;

            default:
                this.logger.debug('Unknown sync operation:', operation.key);
        }
    }

    /**
     * Get sync status
     */
    async getStatus()
    {
        const lastSync = await this.storage.get('last_sync_time');
        const pendingStats = await this.storage.get('pending_stats_sync');

        return {
            isRunning: this.syncInterval !== null,
            isSyncing: this.syncInProgress,
            lastSyncTime: lastSync || this.lastSyncTime,
            isOnline: this.isOnline,
            pendingOperations: this.syncQueue.length,
            pendingStats: pendingStats?.length || 0,
            retryCount: this.retryCount
        };
    }

    /**
     * Force reset sync
     */
    async reset()
    {
        this.logger.info('Resetting sync service');

        this.stop();
        this.syncQueue = [];
        this.retryCount = 0;

        await this.storage.remove('last_sync_time');
        await this.storage.remove('pending_stats_sync');

        this.start();
    }

    /**
     * Export sync data for debugging
     */
    async exportSyncData()
    {
        const status = await this.getStatus();
        const localStorage = await this.storage.exportData();

        return {
            status,
            queue: this.syncQueue,
            localStorage,
            timestamp: new Date().toISOString()
        };
    }
}

// Export singleton instance
export const syncService = new SyncService();

export default SyncService;