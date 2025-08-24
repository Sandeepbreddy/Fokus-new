/**
 * Background Service Worker for Fokus Extension
 * Production-ready code using shared SupabaseClient
 */

// Import shared modules
importScripts('config.js', 'supabaseClient.js');

class BackgroundService
{
    constructor()
    {
        this.logger = console;
        this.supabaseClient = self.supabaseClient; // Access the global supabaseClient instance
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

            // Set up message listeners
            this.setupMessageListeners();

            // Set up alarm listeners for periodic tasks
            this.setupAlarms();

            // Set up web navigation listeners
            this.setupNavigationListeners();

            // Check for existing session
            const session = await this.supabaseClient.getSession();
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
                    sendResponse(response);
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

        this.logger.log('Handling message:', type);

        switch (type)
        {
            // Authentication - delegate to supabaseClient
            case 'AUTH_SIGN_IN':
                const signInResult = await this.supabaseClient.signIn(payload.email, payload.password);
                if (signInResult.success)
                {
                    await this.handleUserAuthenticated(signInResult.data);
                }
                return signInResult;

            case 'AUTH_SIGN_UP':
                const signUpResult = await this.supabaseClient.signUp(payload.email, payload.password);
                if (signUpResult.success && !signUpResult.requiresEmailConfirmation)
                {
                    await this.handleUserAuthenticated(signUpResult.data);
                }
                return signUpResult;

            case 'AUTH_SIGN_OUT':
                const signOutResult = await this.supabaseClient.signOut();
                if (signOutResult.success)
                {
                    await this.handleUserSignedOut();
                }
                return signOutResult;

            case 'AUTH_GET_SESSION':
                const session = await this.supabaseClient.getSession();
                return session ? { success: true, data: session } : { success: false };

            case 'AUTH_RESET_PASSWORD':
                return await this.supabaseClient.resetPassword(payload.email);

            // Blocklist management
            case 'BLOCKLIST_GET':
                return await this.supabaseClient.getUserBlocklist();

            case 'BLOCKLIST_UPDATE':
                const updateResult = await this.supabaseClient.updateUserBlocklist(payload);
                if (updateResult.success)
                {
                    await this.applyBlockingRules(updateResult.data);
                }
                return updateResult;

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
                return await this.supabaseClient.getUserStats(payload?.days || 7);

            case 'STATS_GET_TODAY':
                const todayStats = await this.supabaseClient.getUserStats(1);
                return todayStats;

            // Settings
            case 'SETTINGS_GET':
                return await this.getSettings();

            case 'SETTINGS_UPDATE':
                return await this.updateSettings(payload);

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
     * Handle user authenticated
     */
    async handleUserAuthenticated(session)
    {
        try
        {
            this.logger.info('User authenticated, initializing services...');

            // Load blocklist and apply blocking rules
            const blocklistResult = await this.supabaseClient.getUserBlocklist();
            if (blocklistResult.success)
            {
                await this.applyBlockingRules(blocklistResult.data);
            }

            // Update extension badge
            this.updateBadge('ON', '#10B981');

            this.logger.info('Services initialized for authenticated user');
        } catch (error)
        {
            this.logger.error('Failed to initialize services for user:', error);
        }
    }

    /**
     * Handle user signed out
     */
    async handleUserSignedOut()
    {
        try
        {
            // Clear extension badge
            this.updateBadge('', '#666666');

            // Clear blocking rules
            await this.clearBlockingRules();

            this.logger.info('User signed out, services cleaned up');
        } catch (error)
        {
            this.logger.error('Failed to clean up after sign out:', error);
        }
    }

    /**
     * Add keyword to blocklist
     */
    async addKeyword(keyword)
    {
        try
        {
            const blocklistResult = await this.supabaseClient.getUserBlocklist();
            if (!blocklistResult.success)
            {
                return blocklistResult;
            }

            const blocklist = blocklistResult.data;

            // Check if keyword already exists
            if (blocklist.keywords.includes(keyword))
            {
                return { success: true, message: 'Keyword already in blocklist' };
            }

            // Check subscription limits
            const user = await this.supabaseClient.getCurrentUser();
            if (user)
            {
                // For now, we'll skip limit checking - this should be done server-side
                // or by fetching user data from the users table
            }

            // Add keyword
            blocklist.keywords.push(keyword);
            const updateResult = await this.supabaseClient.updateUserBlocklist(blocklist);

            if (updateResult.success)
            {
                await this.applyBlockingRules(updateResult.data);
            }

            return updateResult;
        } catch (error)
        {
            this.logger.error('Add keyword error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove keyword from blocklist
     */
    async removeKeyword(keyword)
    {
        try
        {
            const blocklistResult = await this.supabaseClient.getUserBlocklist();
            if (!blocklistResult.success)
            {
                return blocklistResult;
            }

            const blocklist = blocklistResult.data;
            blocklist.keywords = blocklist.keywords.filter(k => k !== keyword);

            const updateResult = await this.supabaseClient.updateUserBlocklist(blocklist);

            if (updateResult.success)
            {
                await this.applyBlockingRules(updateResult.data);
            }

            return updateResult;
        } catch (error)
        {
            this.logger.error('Remove keyword error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Add domain to blocklist
     */
    async addDomain(domain)
    {
        try
        {
            const blocklistResult = await this.supabaseClient.getUserBlocklist();
            if (!blocklistResult.success)
            {
                return blocklistResult;
            }

            const blocklist = blocklistResult.data;

            // Normalize domain
            domain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase();

            // Check if domain already exists
            if (blocklist.domains.includes(domain))
            {
                return { success: true, message: 'Domain already in blocklist' };
            }

            // Add domain
            blocklist.domains.push(domain);
            const updateResult = await this.supabaseClient.updateUserBlocklist(blocklist);

            if (updateResult.success)
            {
                await this.applyBlockingRules(updateResult.data);
            }

            return updateResult;
        } catch (error)
        {
            this.logger.error('Add domain error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove domain from blocklist
     */
    async removeDomain(domain)
    {
        try
        {
            const blocklistResult = await this.supabaseClient.getUserBlocklist();
            if (!blocklistResult.success)
            {
                return blocklistResult;
            }

            const blocklist = blocklistResult.data;
            blocklist.domains = blocklist.domains.filter(d => d !== domain);

            const updateResult = await this.supabaseClient.updateUserBlocklist(blocklist);

            if (updateResult.success)
            {
                await this.applyBlockingRules(updateResult.data);
            }

            return updateResult;
        } catch (error)
        {
            this.logger.error('Remove domain error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Import GitHub blocklist
     */
    async importGithubList(url)
    {
        try
        {
            if (!url.includes('github.com'))
            {
                throw new Error('Invalid GitHub URL');
            }

            const blocklistResult = await this.supabaseClient.getUserBlocklist();
            if (!blocklistResult.success)
            {
                return blocklistResult;
            }

            const blocklist = blocklistResult.data;

            // Fetch and parse the list
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch GitHub list');

            const content = await response.text();
            const lines = content.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));

            // Add to GitHub URLs
            if (!blocklist.github_urls.includes(url))
            {
                blocklist.github_urls.push(url);
            }

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
            const updateResult = await this.supabaseClient.updateUserBlocklist(blocklist);

            if (updateResult.success)
            {
                await this.applyBlockingRules(updateResult.data);
            }

            return updateResult;
        } catch (error)
        {
            this.logger.error('Import GitHub list error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Apply blocking rules using declarativeNetRequest
     */
    async applyBlockingRules(blocklist)
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

            // Notify content scripts about blocklist update
            chrome.tabs.query({}, (tabs) =>
            {
                tabs.forEach(tab =>
                {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'BLOCKLIST_UPDATED',
                        payload: blocklist
                    }).catch(() =>
                    {
                        // Ignore errors for tabs that don't have content script
                    });
                });
            });
        } catch (error)
        {
            this.logger.error('Failed to apply blocking rules:', error);
        }
    }

    /**
     * Clear all blocking rules
     */
    async clearBlockingRules()
    {
        try
        {
            const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
            const ruleIds = existingRules.map(rule => rule.id);

            if (ruleIds.length > 0)
            {
                await chrome.declarativeNetRequest.updateDynamicRules({
                    removeRuleIds: ruleIds
                });
            }

            this.logger.info('Cleared all blocking rules');
        } catch (error)
        {
            this.logger.error('Failed to clear blocking rules:', error);
        }
    }

    /**
     * Check if URL is blocked
     */
    async checkUrlBlocked(url)
    {
        try
        {
            const blocklistResult = await this.supabaseClient.getUserBlocklist();
            if (!blocklistResult.success) return null;

            const blocklist = blocklistResult.data;

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
     * Log block event
     */
    async logBlockEvent(payload)
    {
        try
        {
            // Determine block type
            let blockType = 'domain';
            if (payload.blockType)
            {
                blockType = payload.blockType;
            } else if (payload.reason?.includes('keyword'))
            {
                blockType = 'keyword';
            } else if (payload.reason?.includes('GitHub'))
            {
                blockType = 'github_list';
            }

            const eventData = {
                url: payload.url,
                blockType,
                blockSource: payload.blockSource || payload.reason
            };

            return await this.supabaseClient.logBlockEvent(eventData);
        } catch (error)
        {
            this.logger.error('Log block event error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Setup alarms for periodic tasks
     */
    setupAlarms()
    {
        // Create sync alarm
        chrome.alarms.create('sync', {
            periodInMinutes: CONFIG.SYNC.INTERVAL / 60000
        });

        // Handle alarms
        chrome.alarms.onAlarm.addListener(async (alarm) =>
        {
            this.logger.log('Alarm triggered:', alarm.name);

            switch (alarm.name)
            {
                case 'sync':
                    await this.performSync();
                    break;
            }
        });
    }

    /**
     * Perform sync
     */
    async performSync()
    {
        try
        {
            const session = await this.supabaseClient.getSession();
            if (!session) return;

            // Sync blocklist
            await this.supabaseClient.getUserBlocklist();

            this.logger.info('Sync completed');
        } catch (error)
        {
            this.logger.error('Sync error:', error);
        }
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
                // Log the block event
                await this.logBlockEvent({
                    url: details.url,
                    blockType: isBlocked.type,
                    blockSource: isBlocked.source,
                    reason: isBlocked.reason
                });

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
                    const result = await this.addDomain(url.hostname);
                    if (result.success)
                    {
                        this.sendNotification('Site Blocked', `${url.hostname} has been added to your blocklist`);
                    }
                    break;

                case 'block-keyword':
                    if (info.selectionText)
                    {
                        const keywordResult = await this.addKeyword(info.selectionText.toLowerCase());
                        if (keywordResult.success)
                        {
                            this.sendNotification('Keyword Blocked', `"${info.selectionText}" has been added to your blocklist`);
                        }
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
        chrome.runtime.onInstalled.addListener(async (details) =>
        {
            if (details.reason === 'install')
            {
                // Open welcome page on first install
                chrome.tabs.create({
                    url: 'https://fokus.app/welcome'
                });
            }
        });
    }

    /**
     * Get settings
     */
    async getSettings()
    {
        const storage = chrome.storage.local;
        const result = await storage.get(CONFIG.CACHE.STORAGE_KEYS.SETTINGS);
        return result[CONFIG.CACHE.STORAGE_KEYS.SETTINGS] || {
            notifications: true,
            soundEnabled: false,
            strictMode: false,
            whitelistMode: false,
            customBlockPage: false,
            syncEnabled: true
        };
    }

    /**
     * Update settings
     */
    async updateSettings(updates)
    {
        const current = await this.getSettings();
        const updated = { ...current, ...updates };
        const storage = chrome.storage.local;
        await storage.set({ [CONFIG.CACHE.STORAGE_KEYS.SETTINGS]: updated });
        return updated;
    }

    /**
     * Get random motivational quote
     */
    getRandomQuote()
    {
        const quotes = MOTIVATIONAL_QUOTES || [
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
        // TODO: Implement temporary unblock functionality
        return { success: true };
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
}

// Initialize background service
const backgroundService = new BackgroundService();
backgroundService.initialize().catch(error =>
{
    console.error('Failed to initialize background service:', error);
});