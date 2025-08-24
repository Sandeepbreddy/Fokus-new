/**
 * Content Script
 * Runs on all web pages to check for keyword blocking
 */

class FokusContentScript
{
    constructor()
    {
        this.blocklist = null;
        this.isActive = false;
        this.observer = null;
        this.checkInterval = null;
        this.init();
    }

    /**
     * Initialize content script
     */
    async init()
    {
        try
        {
            // Load blocklist from storage
            await this.loadBlocklist();

            // Check if current page should be blocked
            await this.checkCurrentPage();

            // Set up mutation observer for dynamic content
            this.setupObserver();

            // Listen for blocklist updates
            this.setupMessageListener();

            // Set up periodic checks for dynamic pages
            this.setupPeriodicCheck();

            console.log('[Fokus] Content script initialized');
        } catch (error)
        {
            console.error('[Fokus] Failed to initialize content script:', error);
        }
    }

    /**
     * Load blocklist from storage
     */
    async loadBlocklist()
    {
        try
        {
            const response = await this.sendMessage('BLOCKLIST_GET');
            if (response)
            {
                this.blocklist = response;
                this.isActive = true;
            }
        } catch (error)
        {
            console.error('[Fokus] Failed to load blocklist:', error);
            this.isActive = false;
        }
    }

    /**
     * Check if current page should be blocked
     */
    async checkCurrentPage()
    {
        if (!this.isActive || !this.blocklist) return;

        const url = window.location.href;
        const hostname = window.location.hostname;

        // Check for keyword blocking in search engines
        if (this.isSearchEngine(hostname))
        {
            this.checkSearchKeywords();
        }

        // Check for keywords in page content (for non-search engines)
        this.checkPageContent();
    }

    /**
     * Check if site is a search engine
     */
    isSearchEngine(hostname)
    {
        const searchEngines = [
            'google.com',
            'bing.com',
            'yahoo.com',
            'duckduckgo.com',
            'baidu.com',
            'yandex.com',
            'ask.com',
            'aol.com',
            'ecosia.org',
            'startpage.com'
        ];

        return searchEngines.some(engine => hostname.includes(engine));
    }

    /**
     * Check search keywords
     */
    checkSearchKeywords()
    {
        if (!this.blocklist?.keywords || this.blocklist.keywords.length === 0) return;

        const searchQuery = this.extractSearchQuery();
        if (!searchQuery) return;

        const lowercaseQuery = searchQuery.toLowerCase();

        for (const keyword of this.blocklist.keywords)
        {
            if (lowercaseQuery.includes(keyword.toLowerCase()))
            {
                this.blockPage('keyword', keyword);
                return;
            }
        }

        // Also check search result links
        this.checkSearchResults();
    }

    /**
     * Extract search query from URL
     */
    extractSearchQuery()
    {
        const params = new URLSearchParams(window.location.search);
        const queryParams = ['q', 'query', 'search', 'p', 's', 'text'];

        for (const param of queryParams)
        {
            const value = params.get(param);
            if (value) return value;
        }

        // Special handling for Google
        if (window.location.hostname.includes('google.'))
        {
            const hashMatch = window.location.hash.match(/[?&]q=([^&]+)/);
            if (hashMatch)
            {
                return decodeURIComponent(hashMatch[1]);
            }
        }

        return null;
    }

    /**
     * Check search results for blocked keywords
     */
    checkSearchResults()
    {
        if (!this.blocklist?.keywords || this.blocklist.keywords.length === 0) return;

        // Find search result links
        const selectors = [
            'a h3', // Google
            '.b_algo h2 a', // Bing
            '.algo-sr h3 a', // Yahoo
            '.result__title a', // DuckDuckGo
        ];

        const results = document.querySelectorAll(selectors.join(', '));

        results.forEach(result =>
        {
            const text = result.textContent.toLowerCase();
            const link = result.closest('a');

            for (const keyword of this.blocklist.keywords)
            {
                if (text.includes(keyword.toLowerCase()))
                {
                    // Hide or mark the result
                    this.hideSearchResult(link);
                }
            }
        });
    }

    /**
     * Hide search result
     */
    hideSearchResult(element)
    {
        const container = element.closest('.g, .b_algo, .algo-sr, .result');
        if (container)
        {
            container.style.opacity = '0.3';
            container.style.filter = 'blur(2px)';
            container.style.pointerEvents = 'none';
            container.style.position = 'relative';

            // Add blocked overlay
            const overlay = document.createElement('div');
            overlay.className = 'fokus-blocked-overlay';
            overlay.innerHTML = `
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #EF4444;
          color: white;
          padding: 5px 10px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: bold;
          z-index: 1000;
        ">
          BLOCKED BY FOKUS
        </div>
      `;
            container.appendChild(overlay);
        }
    }

    /**
     * Check page content for keywords
     */
    checkPageContent()
    {
        if (!this.blocklist?.keywords || this.blocklist.keywords.length === 0) return;

        // Don't check on search engines (already handled)
        if (this.isSearchEngine(window.location.hostname)) return;

        // Check page title
        const title = document.title.toLowerCase();
        for (const keyword of this.blocklist.keywords)
        {
            if (title.includes(keyword.toLowerCase()))
            {
                this.blockPage('keyword', keyword);
                return;
            }
        }

        // Check meta description
        const metaDescription = document.querySelector('meta[name="description"]');
        if (metaDescription)
        {
            const description = metaDescription.content.toLowerCase();
            for (const keyword of this.blocklist.keywords)
            {
                if (description.includes(keyword.toLowerCase()))
                {
                    this.blockPage('keyword', keyword);
                    return;
                }
            }
        }

        // Check main headings
        const headings = document.querySelectorAll('h1, h2');
        for (const heading of headings)
        {
            const text = heading.textContent.toLowerCase();
            for (const keyword of this.blocklist.keywords)
            {
                if (text.includes(keyword.toLowerCase()))
                {
                    this.blockPage('keyword', keyword);
                    return;
                }
            }
        }
    }

    /**
     * Block the current page
     */
    blockPage(blockType, blockSource)
    {
        // Send message to background to redirect
        this.sendMessage('BLOCK_PAGE', {
            url: window.location.href,
            blockType,
            blockSource,
            reason: `Blocked ${blockType}: ${blockSource}`
        });
    }

    /**
     * Setup mutation observer for dynamic content
     */
    setupObserver()
    {
        // Only observe on search engines
        if (!this.isSearchEngine(window.location.hostname)) return;

        this.observer = new MutationObserver((mutations) =>
        {
            // Debounce checks
            if (this.observerTimeout)
            {
                clearTimeout(this.observerTimeout);
            }

            this.observerTimeout = setTimeout(() =>
            {
                this.checkSearchResults();
            }, 500);
        });

        // Start observing
        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Setup periodic check for dynamic pages
     */
    setupPeriodicCheck()
    {
        // Check every 5 seconds for dynamic content changes
        this.checkInterval = setInterval(() =>
        {
            if (this.isSearchEngine(window.location.hostname))
            {
                this.checkSearchKeywords();
            }
        }, 5000);
    }

    /**
     * Setup message listener for blocklist updates
     */
    setupMessageListener()
    {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) =>
        {
            if (request.type === 'BLOCKLIST_UPDATED')
            {
                this.blocklist = request.payload;
                this.checkCurrentPage();
                sendResponse({ success: true });
            } else if (request.type === 'CHECK_PAGE')
            {
                this.checkCurrentPage();
                sendResponse({ success: true });
            }
            return true;
        });
    }

    /**
     * Send message to background script
     */
    sendMessage(type, payload = {})
    {
        return new Promise((resolve, reject) =>
        {
            chrome.runtime.sendMessage({ type, payload }, (response) =>
            {
                if (chrome.runtime.lastError)
                {
                    reject(chrome.runtime.lastError);
                } else if (response && response.success)
                {
                    resolve(response.data);
                } else
                {
                    reject(response?.error || 'Unknown error');
                }
            });
        });
    }

    /**
     * Cleanup
     */
    destroy()
    {
        if (this.observer)
        {
            this.observer.disconnect();
        }

        if (this.checkInterval)
        {
            clearInterval(this.checkInterval);
        }

        if (this.observerTimeout)
        {
            clearTimeout(this.observerTimeout);
        }
    }
}

// Initialize content script
const fokusContentScript = new FokusContentScript();

// Cleanup on page unload
window.addEventListener('unload', () =>
{
    fokusContentScript.destroy();
});