importScripts('config.js');
importScripts('utils/logger.js');
importScripts('utils/storage.js');
importScripts('utils/crypto.js');
importScripts('services/blockingEngine.js');

class BackgroundService
{
    constructor()
    {
        this.logger = typeof Logger !== 'undefined' ? new Logger('BackgroundService') : console;
        this.storage = typeof StorageManager !== 'undefined' ? new StorageManager() : {
            get: async (key) =>
            {
                const result = await chrome.storage.local.get(key);
                return result[key];
            },
            set: async (key, value) =>
            {
                const data = {};
                data[key] = value;
                return chrome.storage.local.set(data);
            },
            remove: (key) => chrome.storage.local.remove(key),
            clear: () => chrome.storage.local.clear()
        };
        this.blockingEngine = null;
        this.syncService = null;
        this.analyticsService = null;
        this.deviceManager = null;
        this.isInitialized = false;
        this.initializationPromise = null;
    }

    /**
     * Initialize background service
     */
    async initialize()
    {
        if (this.isInitialized) return;
        if (this.initializationPromise) return this.initializationPromise;

        this.initializationPromise = this._initialize();
        return this.initializationPromise;
    }

    async _initialize()
    {
        try
        {
            this.logger.info('Initializing background service...');

            // Load services if available
            if (typeof BlockingEngine !== 'undefined')
            {
                this.blockingEngine = new BlockingEngine();
            }
            if (typeof SyncService !== 'undefined')
            {
                this.syncService = new SyncService();
            }
            if (typeof AnalyticsService !== 'undefined')
            {
                this.analyticsService = new AnalyticsService();
            }
            if (typeof DeviceManager !== 'undefined')
            {
                this.deviceManager = new DeviceManager();
            }

            // Set up message listeners
            this.setupMessageListeners();

            // Set up alarm listeners for periodic tasks
            this.setupAlarms();

            // Set up web navigation listeners
            this.setupNavigationListeners();

            // Set up auth state listener
            this.setupAuthListener();

            // Check for existing session
            const session = await this.getSession();
            if (session)
            {
                await this.handleUserAuthenticated(session);
            }

            // Set up context menus
            this.setupContextMenus();

            // Set up extension lifecycle events
            this.setupLifecycleEvents();

            this.isInitialized = true;
            this.logger.info('Background service initialized successfully');
        } catch (error)
        {
            this.logger.error('Failed to initialize background service:', error);
            throw error;
        }
    }

    /**
     * Setup message listeners for communication with popup and content scripts
     */
    setupMessageListeners()
    {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) =>
        {
            // Handle async responses
            (async () =>
            {
                try
                {
                    const response = await this.handleMessage(request, sender);
                    sendResponse({ success: true, data: response });
                } catch (error)
                {
                    this.logger.error('Message handler error:', error);
                    sendResponse({
                        success: false,
                        error: error.message || 'An error occurred'
                    });
                }
            })();

            // Return true to indicate async response
            return true;
        });
    }

    /**
     * Handle incoming messages
     */
    async handleMessage(request, sender)
    {
        const { type, payload } = request;

        this.logger.debug('Handling message:', type);

        switch (type)
        {
            // Authentication
            case 'AUTH_SIGN_IN':
                return await this.handleSignIn(payload);
            case 'AUTH_SIGN_UP':
                return await this.handleSignUp(payload);
            case 'AUTH_SIGN_OUT':
                return await this.handleSignOut();
            case 'AUTH_GET_SESSION':
                return await this.getSession();
            case 'AUTH_RESET_PASSWORD':
                return await this.handlePasswordReset(payload.email);

            // Blocklist management
            case 'BLOCKLIST_GET':
                return await this.getBlocklist();
            case 'BLOCKLIST_UPDATE':
                return await this.updateBlocklist(payload);
            case 'BLOCKLIST_ADD_KEYWORD':
                return await this.addKeyword(payload.keyword);
            case 'BLOCKLIST_REMOVE_KEYWORD':
                return await this.removeKeyword(payload.keyword);
            case 'BLOCKLIST_ADD_DOMAIN':
                return await this.addDomain(payload.domain);
            case 'BLOCKLIST_REMOVE_DOMAIN':
                return await this.removeDomain(payload.domain);
            case 'BLOCKLIST_IMPORT_GITHUB':
                return await this.importGithubList(payload.url);

            // Statistics
            case 'STATS_GET':
                return await this.getStatistics(payload.days);
            case 'STATS_GET_TODAY':
                return await this.getTodayStats();

            // Settings
            case 'SETTINGS_GET':
                return await this.getSettings();
            case 'SETTINGS_UPDATE':
                return await this.updateSettings(payload);

            // Sync
            case 'SYNC_NOW':
                return await this.syncNow();
            case 'SYNC_STATUS':
                return await this.getSyncStatus();

            // Device management
            case 'DEVICE_REGISTER':
                return await this.registerDevice();
            case 'DEVICE_GET_INFO':
                return await this.getDeviceInfo();

            // Utility
            case 'CHECK_URL_BLOCKED':
                return await this.checkUrlBlocked(payload.url);
            case 'GET_MOTIVATIONAL_QUOTE':
                return this.getRandomQuote();
            case 'BLOCK_PAGE':
                return await this.handleBlockPage(payload);
            case 'TEMP_UNBLOCK':
                return await this.handleTempUnblock(payload);
            case 'LOG_BLOCK_EVENT':
                return await this.logBlockEvent(payload);

            default:
                throw new Error(`Unknown message type: ${type}`);
        }
    }

    /**
     * Handle user sign in
     */
    async handleSignIn(credentials)
    {
        try
        {
            if (typeof window !== 'undefined' && window.supabaseClient)
            {
                const result = await window.supabaseClient.signIn(credentials.email, credentials.password);
                if (result.success)
                {
                    await this.handleUserAuthenticated(result.data.session);
                }
                return result;
            } else
            {
                // Fallback for testing without Supabase
                const mockUser = {
                    id: 'test-user',
                    email: credentials.email,
                    user_metadata: { subscription_tier: 'free' }
                };
                await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.USER, mockUser);
                return { success: true, data: { user: mockUser } };
            }
        } catch (error)
        {
            this.logger.error('Sign in error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Handle user sign up
     */
    async handleSignUp(credentials)
    {
        try
        {
            if (typeof window !== 'undefined' && window.supabaseClient)
            {
                const result = await window.supabaseClient.signUp(credentials.email, credentials.password);
                if (result.success)
                {
                    this.sendNotification(
                        'Welcome to Fokus!',
                        'Please check your email to confirm your account.'
                    );
                }
                return result;
            } else
            {
                // Fallback for testing
                return { success: true, data: { user: { email: credentials.email } } };
            }
        } catch (error)
        {
            this.logger.error('Sign up error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Handle user sign out
     */
    async handleSignOut()
    {
        try
        {
            if (typeof window !== 'undefined' && window.supabaseClient)
            {
                await window.supabaseClient.signOut();
            }

            // Clear all local data
            await this.storage.clear();

            // Stop all services
            if (this.syncService) this.syncService.stop();
            if (this.analyticsService) this.analyticsService.stop();
            if (this.blockingEngine) await this.blockingEngine.clearRules();

            // Update extension badge
            this.updateBadge('', '#666666');

            return { success: true };
        } catch (error)
        {
            this.logger.error('Sign out error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Handle password reset
     */
    async handlePasswordReset(email)
    {
        try
        {
            if (typeof window !== 'undefined' && window.supabaseClient)
            {
                return await window.supabaseClient.resetPassword(email);
            }
            return { success: true, message: 'Password reset email sent' };
        } catch (error)
        {
            this.logger.error('Password reset error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get current session
     */
    async getSession()
    {
        try
        {
            if (typeof window !== 'undefined' && window.supabaseClient)
            {
                return await window.supabaseClient.getSession();
            }

            // Fallback to local storage
            const user = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.USER);
            if (user)
            {
                return { user };
            }

            return null;
        } catch (error)
        {
            this.logger.error('Get session error:', error);
            return null;
        }
    }

    /**
     * Handle user authenticated
     */
    async handleUserAuthenticated(session)
    {
        try
        {
            this.logger.info('User authenticated, initializing services...');

            // Register device
            if (this.deviceManager)
            {
                await this.deviceManager.registerDevice();
            }

            // Sync user data
            if (this.syncService)
            {
                await this.syncService.syncNow();
            }

            // Load blocklist into blocking engine
            const blocklist = await this.getBlocklist();
            if (blocklist && this.blockingEngine)
            {
                await this.blockingEngine.updateRules(blocklist);
            }

            // Start services
            if (this.syncService) this.syncService.start();
            if (this.analyticsService) this.analyticsService.start();

            // Update extension badge
            this.updateBadge('ON', '#10B981');

            this.logger.info('Services initialized for authenticated user');
        } catch (error)
        {
            this.logger.error('Failed to initialize services for user:', error);
        }
    }

    /**
     * Setup auth state listener
     */
    setupAuthListener()
    {
        if (typeof window !== 'undefined' && window.supabaseClient)
        {
            window.supabaseClient.onAuthStateChange(async (event, session) =>
            {
                if (event === 'SIGNED_IN' && session)
                {
                    await this.handleUserAuthenticated(session);
                } else if (event === 'SIGNED_OUT')
                {
                    await this.handleSignOut();
                }
            });
        }
    }

    /**
     * Setup alarms for periodic tasks
     */
    setupAlarms()
    {
        // Create alarms
        chrome.alarms.create('sync', {
            periodInMinutes: CONFIG.SYNC.INTERVAL / 60000
        });

        chrome.alarms.create('analytics', {
            periodInMinutes: CONFIG.ANALYTICS.BATCH_INTERVAL / 60000
        });

        chrome.alarms.create('cleanup', {
            periodInMinutes: 60 // Clean up old data every hour
        });

        // Handle alarms
        chrome.alarms.onAlarm.addListener(async (alarm) =>
        {
            this.logger.debug('Alarm triggered:', alarm.name);

            switch (alarm.name)
            {
                case 'sync':
                    await this.syncNow();
                    break;
                case 'analytics':
                    if (this.analyticsService)
                    {
                        await this.analyticsService.flush();
                    }
                    break;
                case 'cleanup':
                    await this.performCleanup();
                    break;
            }
        });
    }

    /**
     * Setup web navigation listeners
     */
    setupNavigationListeners()
    {
        chrome.webNavigation.onBeforeNavigate.addListener(async (details) =>
        {
            if (details.frameId !== 0) return; // Only check main frame

            const isBlocked = await this.checkUrlBlocked(details.url);

            if (isBlocked)
            {
                // Log block event
                if (this.analyticsService)
                {
                    await this.analyticsService.logBlockEvent({
                        url: details.url,
                        blockType: isBlocked.type,
                        blockSource: isBlocked.source
                    });
                }

                // Redirect to blocked page
                chrome.tabs.update(details.tabId, {
                    url: chrome.runtime.getURL('blocked.html') +
                        `?url=${encodeURIComponent(details.url)}` +
                        `&reason=${encodeURIComponent(isBlocked.reason)}`
                });
            }
        });
    }

    /**
     * Setup context menus
     */
    setupContextMenus()
    {
        chrome.runtime.onInstalled.addListener(() =>
        {
            // Add context menu for blocking current site
            chrome.contextMenus.create({
                id: 'block-site',
                title: 'Block this site with Fokus',
                contexts: ['page']
            });

            // Add context menu for blocking selected text as keyword
            chrome.contextMenus.create({
                id: 'block-keyword',
                title: 'Block "%s" as keyword',
                contexts: ['selection']
            });
        });

        // Handle context menu clicks
        chrome.contextMenus.onClicked.addListener(async (info, tab) =>
        {
            switch (info.menuItemId)
            {
                case 'block-site':
                    const url = new URL(tab.url);
                    await this.addDomain(url.hostname);
                    this.sendNotification('Site Blocked', `${url.hostname} has been added to your blocklist`);
                    break;

                case 'block-keyword':
                    if (info.selectionText)
                    {
                        await this.addKeyword(info.selectionText.toLowerCase());
                        this.sendNotification('Keyword Blocked', `"${info.selectionText}" has been added to your blocklist`);
                    }
                    break;
            }
        });
    }

    /**
     * Setup extension lifecycle events
     */
    setupLifecycleEvents()
    {
        // Handle extension installation/update
        chrome.runtime.onInstalled.addListener(async (details) =>
        {
            if (details.reason === 'install')
            {
                // Open welcome page on first install
                chrome.tabs.create({
                    url: CONFIG.APP.WEBSITE_URL + '/welcome'
                });
            } else if (details.reason === 'update')
            {
                const previousVersion = details.previousVersion;
                const currentVersion = chrome.runtime.getManifest().version;

                if (previousVersion !== currentVersion)
                {
                    this.logger.info(`Extension updated from ${previousVersion} to ${currentVersion}`);
                }
            }
        });
    }

    /**
     * Get blocklist
     */
    async getBlocklist()
    {
        // Try cache first
        const cached = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST);
        if (cached)
        {
            return cached;
        }

        // Initialize default blocklist
        const defaultBlocklist = {
            keywords: [],
            domains: [],
            github_urls: []
        };

        await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST, defaultBlocklist);
        return defaultBlocklist;
    }

    /**
     * Update blocklist
     */
    async updateBlocklist(updates)
    {
        try
        {
            await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST, updates);

            // Update blocking engine if available
            if (this.blockingEngine)
            {
                await this.blockingEngine.updateRules(updates);
            } else
            {
                // Fallback to simple declarativeNetRequest rules
                await this.applySimpleBlockingRules(updates);
            }

            return { success: true, data: updates };
        } catch (error)
        {
            this.logger.error('Update blocklist error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Apply simple blocking rules without BlockingEngine
     */
    async applySimpleBlockingRules(blocklist)
    {
        try
        {
            const rules = [];
            let ruleId = 1;

            // Create rules for domain blocking
            if (blocklist.domains && blocklist.domains.length > 0)
            {
                for (const domain of blocklist.domains)
                {
                    rules.push({
                        id: ruleId++,
                        priority: 1,
                        action: {
                            type: 'redirect',
                            redirect: {
                                url: chrome.runtime.getURL('blocked.html') +
                                    `?reason=${encodeURIComponent('Domain blocked: ' + domain)}`
                            }
                        },
                        condition: {
                            urlFilter: `||${domain}^`,
                            resourceTypes: ['main_frame']
                        }
                    });
                }
            }

            // Clear existing rules and add new ones
            const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
            const ruleIds = existingRules.map(rule => rule.id);

            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: ruleIds,
                addRules: rules
            });

            this.logger.info(`Applied ${rules.length} blocking rules`);
        } catch (error)
        {
            this.logger.error('Failed to apply blocking rules:', error);
        }
    }

    /**
     * Add keyword to blocklist
     */
    async addKeyword(keyword)
    {
        const blocklist = await this.getBlocklist();

        // Check if keyword already exists
        if (blocklist.keywords.includes(keyword))
        {
            return { success: true, message: 'Keyword already in blocklist' };
        }

        // Check subscription limits
        const user = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.USER);
        const limit = user?.user_metadata?.subscription_tier === 'premium'
            ? -1
            : CONFIG.SUBSCRIPTION.FREE.KEYWORD_LIMIT;

        if (limit > 0 && blocklist.keywords.length >= limit)
        {
            throw new Error(`Free tier limited to ${limit} keywords. Upgrade to Premium for unlimited keywords.`);
        }

        blocklist.keywords.push(keyword);
        return await this.updateBlocklist(blocklist);
    }

    /**
     * Remove keyword from blocklist
     */
    async removeKeyword(keyword)
    {
        const blocklist = await this.getBlocklist();
        blocklist.keywords = blocklist.keywords.filter(k => k !== keyword);
        return await this.updateBlocklist(blocklist);
    }

    /**
     * Add domain to blocklist
     */
    async addDomain(domain)
    {
        const blocklist = await this.getBlocklist();

        // Normalize domain
        domain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase();

        // Check if domain already exists
        if (blocklist.domains.includes(domain))
        {
            return { success: true, message: 'Domain already in blocklist' };
        }

        // Check subscription limits
        const user = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.USER);
        const limit = user?.user_metadata?.subscription_tier === 'premium'
            ? -1
            : CONFIG.SUBSCRIPTION.FREE.DOMAIN_LIMIT;

        if (limit > 0 && blocklist.domains.length >= limit)
        {
            throw new Error(`Free tier limited to ${limit} domains. Upgrade to Premium for unlimited domains.`);
        }

        blocklist.domains.push(domain);
        return await this.updateBlocklist(blocklist);
    }

    /**
     * Remove domain from blocklist
     */
    async removeDomain(domain)
    {
        const blocklist = await this.getBlocklist();
        blocklist.domains = blocklist.domains.filter(d => d !== domain);
        return await this.updateBlocklist(blocklist);
    }

    /**
     * Import GitHub blocklist
     */
    async importGithubList(url)
    {
        try
        {
            // Validate GitHub URL
            if (!url.includes('github.com'))
            {
                throw new Error('Invalid GitHub URL');
            }

            // Check subscription limits
            const user = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.USER);
            const blocklist = await this.getBlocklist();

            const limit = user?.user_metadata?.subscription_tier === 'premium'
                ? -1
                : CONFIG.SUBSCRIPTION.FREE.GITHUB_LISTS_LIMIT;

            if (limit > 0 && blocklist.github_urls.length >= limit)
            {
                throw new Error(`Free tier limited to ${limit} GitHub lists. Upgrade to Premium for unlimited lists.`);
            }

            // Fetch and parse the list
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch GitHub list');

            const content = await response.text();
            const lines = content.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));

            // Add to GitHub URLs
            blocklist.github_urls.push(url);

            // Parse and add domains
            const domains = new Set(blocklist.domains);
            lines.forEach(line =>
            {
                if (line.includes('.'))
                {
                    domains.add(line.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase());
                }
            });

            blocklist.domains = Array.from(domains);
            return await this.updateBlocklist(blocklist);
        } catch (error)
        {
            this.logger.error('Failed to import GitHub list:', error);
            throw error;
        }
    }

    /**
     * Check if URL is blocked
     */
    async checkUrlBlocked(url)
    {
        try
        {
            if (this.blockingEngine)
            {
                return await this.blockingEngine.isUrlBlocked(url);
            }

            // Fallback to simple check
            const blocklist = await this.getBlocklist();
            const urlObj = new URL(url);
            const domain = urlObj.hostname.replace(/^www\./, '').toLowerCase();

            // Check domain blocking
            if (blocklist.domains.includes(domain))
            {
                return {
                    blocked: true,
                    type: 'domain',
                    source: domain,
                    reason: `The domain "${domain}" is blocked`
                };
            }

            // Check keywords
            const urlLower = url.toLowerCase();
            for (const keyword of blocklist.keywords)
            {
                if (urlLower.includes(keyword.toLowerCase()))
                {
                    return {
                        blocked: true,
                        type: 'keyword',
                        source: keyword,
                        reason: `URL contains blocked keyword: "${keyword}"`
                    };
                }
            }

            return null;
        } catch (error)
        {
            this.logger.error('Error checking URL:', error);
            return null;
        }
    }

    /**
     * Get statistics
     */
    async getStatistics(days = 7)
    {
        if (this.analyticsService)
        {
            return await this.analyticsService.getSummary(days);
        }

        // Fallback mock data
        return {
            totalBlocks: 42,
            timeSaved: 210,
            streak: 5
        };
    }

    /**
     * Get today's stats
     */
    async getTodayStats()
    {
        if (this.analyticsService)
        {
            return await this.analyticsService.getTodayStats();
        }

        // Fallback mock data
        return {
            totalBlocks: 12,
            timeSaved: 60,
            streak: 5
        };
    }

    /**
     * Get settings
     */
    async getSettings()
    {
        const settings = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.SETTINGS);
        return settings || {
            notifications: true,
            soundEnabled: false,
            strictMode: false,
            whitelistMode: false,
            customBlockPage: false,
            syncEnabled: CONFIG.FEATURES.SYNC
        };
    }

    /**
     * Update settings
     */
    async updateSettings(updates)
    {
        const current = await this.getSettings();
        const updated = { ...current, ...updates };
        await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.SETTINGS, updated);
        return updated;
    }

    /**
     * Get random motivational quote
     */
    getRandomQuote()
    {
        const quotes = typeof MOTIVATIONAL_QUOTES !== 'undefined' ? MOTIVATIONAL_QUOTES : [
            {
                text: "The secret of getting ahead is getting started.",
                author: "Mark Twain"
            }
        ];
        return quotes[Math.floor(Math.random() * quotes.length)];
    }

    /**
     * Handle block page request
     */
    async handleBlockPage(payload)
    {
        const currentTab = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab[0])
        {
            chrome.tabs.update(currentTab[0].id, {
                url: chrome.runtime.getURL('blocked.html') +
                    `?url=${encodeURIComponent(payload.url)}&reason=${encodeURIComponent(payload.reason)}`
            });
        }
        return { success: true };
    }

    /**
     * Handle temporary unblock
     */
    async handleTempUnblock(payload)
    {
        // Implement temporary unblock logic
        this.logger.info('Temporary unblock requested:', payload);
        // This would temporarily disable blocking for the specified URL
        return { success: true };
    }

    /**
     * Log block event
     */
    async logBlockEvent(payload)
    {
        if (this.analyticsService)
        {
            return await this.analyticsService.logBlockEvent(payload);
        }
        return { success: true };
    }

    /**
     * Sync now
     */
    async syncNow()
    {
        if (this.syncService)
        {
            return await this.syncService.syncNow();
        }
        return { success: true, message: 'Sync service not available' };
    }

    /**
     * Get sync status
     */
    async getSyncStatus()
    {
        if (this.syncService)
        {
            return await this.syncService.getStatus();
        }
        return { isRunning: false, lastSyncTime: null };
    }

    /**
     * Register device
     */
    async registerDevice()
    {
        if (this.deviceManager)
        {
            return await this.deviceManager.registerDevice();
        }
        return { success: true, message: 'Device manager not available' };
    }

    /**
     * Get device info
     */
    async getDeviceInfo()
    {
        if (this.deviceManager)
        {
            return await this.deviceManager.getDeviceInfo();
        }
        return null;
    }

    /**
     * Send notification
     */
    sendNotification(title, message, options = {})
    {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('assets/icon-128.png'),
            title,
            message,
            ...options
        });
    }

    /**
     * Update extension badge
     */
    updateBadge(text, color)
    {
        chrome.action.setBadgeText({ text });
        chrome.action.setBadgeBackgroundColor({ color });
    }

    /**
     * Perform cleanup tasks
     */
    async performCleanup()
    {
        try
        {
            // Clean up old cache entries
            const cacheKeys = Object.values(CONFIG.CACHE.STORAGE_KEYS);
            for (const key of cacheKeys)
            {
                const data = await this.storage.get(key);
                if (data && data._timestamp)
                {
                    const age = Date.now() - data._timestamp;
                    if (age > CONFIG.CACHE.TTL)
                    {
                        await this.storage.remove(key);
                    }
                }
            }

            // Clean up old analytics data
            if (this.analyticsService)
            {
                await this.analyticsService.cleanup();
            }

            this.logger.info('Cleanup completed');
        } catch (error)
        {
            this.logger.error('Cleanup error:', error);
        }
    }
}

// Initialize background service
const backgroundService = new BackgroundService();
backgroundService.initialize().catch(error =>
{
    console.error('Failed to initialize background service:', error);
});