/**
 * Application Configuration
 * Production-ready configuration for Fokus extension
 */

const CONFIG = {
    // Supabase Configuration - UPDATE THESE VALUES
    SUPABASE: {
        URL: 'https://llefxcwqdhrmvestoqvh.supabase.co', // Replace with your Supabase URL
        ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsZWZ4Y3dxZGhybXZlc3RvcXZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU5OTA3MTQsImV4cCI6MjA3MTU2NjcxNH0.TxuNrzg4SqHwdA9LMI7x-5_Ufmqz2axBYw8ZX2lZrPQ', // Replace with your Supabase anon key
        AUTH: {
            REDIRECT_URL: 'https://llefxcwqdhrmvestoqvh.supabase.co/auth/v1/callback',
            STORAGE_KEY: 'fokus_auth_token',
            SESSION_DURATION: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
        }
    },

    // Stripe Configuration - Optional (works without it)
    STRIPE: {
        PUBLIC_KEY: '', // Add when ready: 'pk_live_xxx'
        PRICE_ID_MONTHLY: '', // Add when ready
        PRICE_ID_YEARLY: '' // Add when ready
    },

    // API Configuration - Optional (for Stripe backend)
    API: {
        BASE_URL: '' // Add when ready: 'https://api.fokus.app'
    },

    // Application Settings
    APP: {
        NAME: 'Fokus',
        VERSION: '1.0.0',
        SUPPORT_EMAIL: 'support@fokus.app',
        WEBSITE_URL: 'https://fokus.app',
        PRIVACY_URL: 'https://fokus.app/privacy',
        TERMS_URL: 'https://fokus.app/terms'
    },

    // Feature Flags
    FEATURES: {
        KEYWORD_BLOCKING: true,
        DOMAIN_BLOCKING: true,
        GITHUB_LISTS: true,
        ANALYTICS: true,
        MOTIVATIONAL_QUOTES: true,
        SYNC_ENABLED: true
    },

    // Subscription Tiers
    SUBSCRIPTION: {
        FREE: {
            NAME: 'free',
            DEVICE_LIMIT: 1,
            KEYWORD_LIMIT: 15,
            DOMAIN_LIMIT: 20,
            GITHUB_LISTS_LIMIT: 1,
            ANALYTICS_DAYS: 7
        },
        PREMIUM: {
            NAME: 'premium',
            DEVICE_LIMIT: 10,
            KEYWORD_LIMIT: -1, // unlimited
            DOMAIN_LIMIT: -1,
            GITHUB_LISTS_LIMIT: -1,
            ANALYTICS_DAYS: 365,
            PRICE_MONTHLY: 4.99,
            PRICE_YEARLY: 49.99,
            STRIPE_PRICE_ID_MONTHLY: 'price_monthly_id',
            STRIPE_PRICE_ID_YEARLY: 'price_yearly_id'
        }
    },

    // Sync Configuration
    SYNC: {
        INTERVAL: 5 * 60 * 1000, // 5 minutes
        RETRY_ATTEMPTS: 3,
        RETRY_DELAY: 1000, // 1 second
        BATCH_SIZE: 100,
        CONFLICT_RESOLUTION: 'server_wins' // or 'client_wins', 'merge'
    },

    // Cache Configuration
    CACHE: {
        TTL: 60 * 60 * 1000, // 1 hour
        STORAGE_KEYS: {
            USER: 'fokus_user',
            BLOCKLIST: 'fokus_blocklist',
            STATS: 'fokus_stats',
            SETTINGS: 'fokus_settings',
            DEVICE: 'fokus_device'
        }
    },

    // Analytics Configuration
    ANALYTICS: {
        ENABLED: true,
        BATCH_INTERVAL: 30 * 1000, // 30 seconds
        MAX_BATCH_SIZE: 50,
        RETENTION_DAYS: 90
    },

    // Blocking Configuration
    BLOCKING: {
        UPDATE_INTERVAL: 1000, // 1 second
        MAX_RULES: 30000, // Chrome's limit for declarativeNetRequest
        SEARCH_ENGINES: [
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
        ]
    },

    // Error Tracking
    ERROR: {
        MAX_RETRIES: 3,
        REPORT_TO_SERVER: true,
        LOG_LEVEL: process.env.NODE_ENV === 'production' ? 'error' : 'debug'
    },

    // Rate Limiting
    RATE_LIMIT: {
        API_CALLS: {
            WINDOW: 60 * 1000, // 1 minute
            MAX_REQUESTS: 60
        },
        SYNC: {
            WINDOW: 60 * 1000,
            MAX_REQUESTS: 10
        }
    },

    // Development Settings
    DEV: {
        DEBUG_MODE: false, // Set to true for development
        LOG_API_CALLS: false,
        MOCK_AUTH: false,
        BYPASS_SUBSCRIPTION: false
    }
};

// Motivational Quotes for Blocked Pages
const MOTIVATIONAL_QUOTES = [
    {
        text: "The secret of getting ahead is getting started.",
        author: "Mark Twain"
    },
    {
        text: "Focus on being productive instead of busy.",
        author: "Tim Ferriss"
    },
    {
        text: "You don't have to be great to start, but you have to start to be great.",
        author: "Zig Ziglar"
    },
    {
        text: "Success is not final, failure is not fatal: it is the courage to continue that counts.",
        author: "Winston Churchill"
    },
    {
        text: "The way to get started is to quit talking and begin doing.",
        author: "Walt Disney"
    },
    {
        text: "Don't watch the clock; do what it does. Keep going.",
        author: "Sam Levenson"
    },
    {
        text: "A year from now you may wish you had started today.",
        author: "Karen Lamb"
    },
    {
        text: "The future depends on what you do today.",
        author: "Mahatma Gandhi"
    },
    {
        text: "Believe you can and you're halfway there.",
        author: "Theodore Roosevelt"
    },
    {
        text: "The only way to do great work is to love what you do.",
        author: "Steve Jobs"
    },
    {
        text: "Quality is not an act, it is a habit.",
        author: "Aristotle"
    },
    {
        text: "The mind is everything. What you think you become.",
        author: "Buddha"
    },
    {
        text: "Your limitation—it's only your imagination.",
        author: "Unknown"
    },
    {
        text: "Push yourself, because no one else is going to do it for you.",
        author: "Unknown"
    },
    {
        text: "Great things never come from comfort zones.",
        author: "Unknown"
    },
    {
        text: "Dream it. Wish it. Do it.",
        author: "Unknown"
    },
    {
        text: "Success doesn't just find you. You have to go out and get it.",
        author: "Unknown"
    },
    {
        text: "The harder you work for something, the greater you'll feel when you achieve it.",
        author: "Unknown"
    },
    {
        text: "Don't stop when you're tired. Stop when you're done.",
        author: "Unknown"
    },
    {
        text: "Work hard in silence, let your success be your noise.",
        author: "Frank Ocean"
    }
];

// Validate Configuration
function validateConfig()
{
    const errors = [];

    if (!CONFIG.SUPABASE.URL || CONFIG.SUPABASE.URL.includes('YOUR_'))
    {
        errors.push('Supabase URL is not configured');
    }

    if (!CONFIG.SUPABASE.ANON_KEY || CONFIG.SUPABASE.ANON_KEY.includes('YOUR_'))
    {
        errors.push('Supabase Anon Key is not configured');
    }

    if (errors.length > 0 && CONFIG.DEV.DEBUG_MODE)
    {
        console.warn('[Config Validation] Issues found:', errors);
    }

    return errors.length === 0;
}

// Environment Detection
function getEnvironment()
{
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id)
    {
        return 'extension';
    }
    if (typeof window !== 'undefined')
    {
        return 'web';
    }
    return 'unknown';
}

// Get Current Configuration based on environment
function getCurrentConfig()
{
    const env = getEnvironment();

    // Override certain settings based on environment
    if (env === 'web')
    {
        CONFIG.SYNC.ENABLED = false;
        CONFIG.ANALYTICS.ENABLED = false;
    }

    return CONFIG;
}