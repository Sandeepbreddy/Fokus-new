/**
 * Blocked Page Controller
 * Handles the blocked site page interactions
 */

class BlockedPageController
{
    constructor()
    {
        this.blockedUrl = null;
        this.blockedReason = null;
        this.breakTimer = null;
        this.stats = {
            timeSaved: 0,
            sitesBlocked: 0,
            focusStreak: 0
        };
        this.init();
    }

    /**
     * Initialize the blocked page
     */
    async init()
    {
        try
        {
            // Parse URL parameters
            this.parseUrlParams();

            // Display blocked site info
            this.displayBlockedInfo();

            // Load and display quote
            this.displayMotivationalQuote();

            // Load and display stats
            await this.loadStats();

            // Set up event listeners
            this.setupEventListeners();

            // Log block event
            await this.logBlockEvent();

            // Start animation
            this.startAnimations();
        } catch (error)
        {
            console.error('Failed to initialize blocked page:', error);
        }
    }

    /**
     * Parse URL parameters
     */
    parseUrlParams()
    {
        const params = new URLSearchParams(window.location.search);
        this.blockedUrl = params.get('url') || 'Unknown site';
        this.blockedReason = params.get('reason') || 'This site is blocked';

        // Decode URLs
        try
        {
            this.blockedUrl = decodeURIComponent(this.blockedUrl);
            this.blockedReason = decodeURIComponent(this.blockedReason);
        } catch (e)
        {
            console.error('Failed to decode URL params:', e);
        }
    }

    /**
     * Display blocked site information
     */
    displayBlockedInfo()
    {
        // Display the blocked URL
        const urlElement = document.getElementById('blocked-url');
        if (urlElement)
        {
            try
            {
                const url = new URL(this.blockedUrl);
                urlElement.textContent = url.hostname;
            } catch
            {
                urlElement.textContent = this.blockedUrl;
            }
        }

        // Display the reason
        const reasonElement = document.getElementById('blocked-reason');
        if (reasonElement)
        {
            reasonElement.textContent = this.blockedReason;
        }
    }

    /**
     * Display motivational quote
     */
    displayMotivationalQuote()
    {
        const quotes = MOTIVATIONAL_QUOTES || [
            {
                text: "The secret of getting ahead is getting started.",
                author: "Mark Twain"
            }
        ];

        // Get random quote
        const quote = quotes[Math.floor(Math.random() * quotes.length)];

        // Display quote
        const quoteText = document.querySelector('.quote-text');
        const quoteAuthor = document.querySelector('.quote-author');

        if (quoteText)
        {
            quoteText.textContent = quote.text;
        }

        if (quoteAuthor)
        {
            quoteAuthor.textContent = quote.author;
        }
    }

    /**
     * Load statistics
     */
    async loadStats()
    {
        try
        {
            // Send message to background script to get stats
            const response = await this.sendMessage('STATS_GET_TODAY');

            if (response)
            {
                this.stats = {
                    timeSaved: response.timeSaved || 0,
                    sitesBlocked: response.totalBlocks || 0,
                    focusStreak: response.streak || 0
                };
            }
        } catch (error)
        {
            console.error('Failed to load stats:', error);
            // Use default values
        }

        // Display stats
        this.displayStats();
    }

    /**
     * Display statistics
     */
    displayStats()
    {
        // Time saved
        const timeSavedElement = document.getElementById('time-saved');
        if (timeSavedElement)
        {
            // Add 5 minutes for this block
            const totalMinutes = this.stats.timeSaved + 5;
            timeSavedElement.textContent = totalMinutes;

            // Animate the number
            this.animateNumber(timeSavedElement, this.stats.timeSaved, totalMinutes);
        }

        // Sites blocked
        const sitesBlockedElement = document.getElementById('sites-blocked');
        if (sitesBlockedElement)
        {
            const total = this.stats.sitesBlocked + 1;
            sitesBlockedElement.textContent = total;
            this.animateNumber(sitesBlockedElement, this.stats.sitesBlocked, total);
        }

        // Focus streak
        const streakElement = document.getElementById('focus-streak');
        if (streakElement)
        {
            streakElement.textContent = this.stats.focusStreak;
            this.animateNumber(streakElement, 0, this.stats.focusStreak);
        }
    }

    /**
     * Animate number counting
     */
    animateNumber(element, start, end)
    {
        const duration = 1000;
        const steps = 30;
        const increment = (end - start) / steps;
        const stepDuration = duration / steps;
        let current = start;
        let step = 0;

        const timer = setInterval(() =>
        {
            step++;
            current = Math.round(start + (increment * step));
            element.textContent = current;

            if (step >= steps)
            {
                clearInterval(timer);
                element.textContent = end;
            }
        }, stepDuration);
    }

    /**
     * Setup event listeners
     */
    setupEventListeners()
    {
        // Go back button
        document.getElementById('go-back-btn')?.addEventListener('click', () =>
        {
            this.goBack();
        });

        // Take break button
        document.getElementById('take-break-btn')?.addEventListener('click', () =>
        {
            this.startBreak();
        });

        // Temporary unblock button
        document.getElementById('temp-unblock-btn')?.addEventListener('click', () =>
        {
            this.requestTemporaryAccess();
        });

        // Settings link
        document.getElementById('settings-link')?.addEventListener('click', (e) =>
        {
            e.preventDefault();
            this.openExtensionPopup('settings');
        });

        // Stats link
        document.getElementById('stats-link')?.addEventListener('click', (e) =>
        {
            e.preventDefault();
            this.openExtensionPopup('stats');
        });

        // Help link
        document.getElementById('help-link')?.addEventListener('click', (e) =>
        {
            e.preventDefault();
            this.openHelp();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) =>
        {
            if (e.key === 'Escape')
            {
                this.goBack();
            }
        });
    }

    /**
     * Go back to previous page or new tab
     */
    goBack()
    {
        if (window.history.length > 1)
        {
            window.history.back();
        } else
        {
            // Open new tab page
            chrome.tabs.create({ url: 'chrome://newtab' });
            window.close();
        }
    }

    /**
     * Start break timer
     */
    startBreak()
    {
        const breakButton = document.getElementById('take-break-btn');
        if (!breakButton) return;

        // Disable button
        breakButton.disabled = true;

        // Start 5-minute countdown
        let timeLeft = 5 * 60; // 5 minutes in seconds

        const updateTimer = () =>
        {
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            breakButton.textContent = `Break Time: ${minutes}:${seconds.toString().padStart(2, '0')}`;

            if (timeLeft <= 0)
            {
                clearInterval(this.breakTimer);
                breakButton.textContent = 'Break Over - Back to Work!';
                setTimeout(() =>
                {
                    this.goBack();
                }, 2000);
            }

            timeLeft--;
        };

        updateTimer();
        this.breakTimer = setInterval(updateTimer, 1000);

        // Allow access for 5 minutes
        this.sendMessage('TEMP_UNBLOCK', {
            url: this.blockedUrl,
            duration: 5 * 60 * 1000
        });

        // Redirect after brief delay
        setTimeout(() =>
        {
            window.location.href = this.blockedUrl;
        }, 1000);
    }

    /**
     * Request temporary access
     */
    async requestTemporaryAccess()
    {
        const button = document.getElementById('temp-unblock-btn');
        if (!button) return;

        // Confirm action
        const confirmed = confirm(
            'Are you sure you want to temporarily unblock this site?\n\n' +
            'This will break your focus streak and allow access for 5 minutes.'
        );

        if (!confirmed) return;

        try
        {
            button.disabled = true;
            button.textContent = 'Requesting access...';

            // Send unblock request
            await this.sendMessage('TEMP_UNBLOCK', {
                url: this.blockedUrl,
                duration: 5 * 60 * 1000
            });

            button.textContent = 'Access granted for 5 minutes';

            // Redirect after brief delay
            setTimeout(() =>
            {
                window.location.href = this.blockedUrl;
            }, 1000);
        } catch (error)
        {
            console.error('Failed to request temporary access:', error);
            button.textContent = 'Request failed';
            button.disabled = false;
        }
    }

    /**
     * Open extension popup
     */
    openExtensionPopup(view)
    {
        // Send message to open popup with specific view
        this.sendMessage('OPEN_POPUP', { view });
    }

    /**
     * Open help page
     */
    openHelp()
    {
        chrome.tabs.create({
            url: 'https://fokus.app/help'
        });
    }

    /**
     * Log block event
     */
    async logBlockEvent()
    {
        try
        {
            // Extract block type from reason
            let blockType = 'domain';
            if (this.blockedReason.includes('keyword'))
            {
                blockType = 'keyword';
            } else if (this.blockedReason.includes('GitHub'))
            {
                blockType = 'github_list';
            }

            await this.sendMessage('LOG_BLOCK_EVENT', {
                url: this.blockedUrl,
                blockType,
                blockSource: this.blockedReason
            });
        } catch (error)
        {
            console.error('Failed to log block event:', error);
        }
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
     * Start page animations
     */
    startAnimations()
    {
        // Add entrance animations to elements
        const elements = [
            '.logo-section',
            '.message-section',
            '.quote-section',
            '.stats-section',
            '.action-section'
        ];

        elements.forEach((selector, index) =>
        {
            const element = document.querySelector(selector);
            if (element)
            {
                element.style.opacity = '0';
                element.style.transform = 'translateY(20px)';

                setTimeout(() =>
                {
                    element.style.transition = 'all 0.5s ease-out';
                    element.style.opacity = '1';
                    element.style.transform = 'translateY(0)';
                }, index * 100);
            }
        });

        // Rotate quotes every 30 seconds
        setInterval(() =>
        {
            this.displayMotivationalQuote();
        }, 30000);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading')
{
    document.addEventListener('DOMContentLoaded', () =>
    {
        new BlockedPageController();
    });
} else
{
    new BlockedPageController();
}