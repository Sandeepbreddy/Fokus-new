/**
 * Supabase Client Module - Fixed Version
 * Properly creates all related records on signup
 */

(function (global)
{
    'use strict';

    class SupabaseClient
    {
        constructor()
        {
            // Detect environment
            this.isServiceWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
            this.isWindow = typeof window !== 'undefined';

            // Use appropriate global context
            this.global = this.isServiceWorker ? self : (this.isWindow ? window : global);

            // Configuration
            this.supabaseUrl = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE.URL : null;
            this.supabaseKey = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE.ANON_KEY : null;
            this.session = null;
            this.currentDevice = null;

            // Logger
            this.logger = this.setupLogger();

            // Storage abstraction
            this.storage = this.setupStorage();

            // Auth listeners
            this.authListeners = new Set();

            // Initialize
            this.initialize();
        }

        /**
         * Setup logger based on environment
         */
        setupLogger()
        {
            if (typeof Logger !== 'undefined')
            {
                return new Logger('SupabaseClient');
            }
            return console;
        }

        /**
         * Setup storage based on environment
         */
        setupStorage()
        {
            // Chrome extension storage API (works in both contexts)
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
            {
                return {
                    get: (key) => chrome.storage.local.get(key).then(r => r[key]),
                    set: (key, value) => chrome.storage.local.set({ [key]: value }),
                    remove: (key) => chrome.storage.local.remove(key),
                    clear: () => chrome.storage.local.clear()
                };
            }

            // Fallback for testing
            return {
                get: async (key) => null,
                set: async (key, value) => { },
                remove: async (key) => { },
                clear: async () => { }
            };
        }

        /**
         * Initialize client
         */
        async initialize()
        {
            try
            {
                await this.checkExistingSession();
            } catch (error)
            {
                this.logger.error('Initialization error:', error);
            }
        }

        /**
         * Make authenticated API request to Supabase
         */
        async makeRequest(endpoint, options = {})
        {
            if (!this.supabaseUrl || !this.supabaseKey)
            {
                throw new Error('Supabase configuration missing');
            }

            const url = `${this.supabaseUrl}${endpoint}`;
            const headers = {
                'apikey': this.supabaseKey,
                'Content-Type': 'application/json',
                ...options.headers
            };

            // Add authorization header if we have a session
            const session = await this.getSession();
            if (session?.access_token)
            {
                headers['Authorization'] = `Bearer ${session.access_token}`;
            }

            try
            {
                const response = await fetch(url, {
                    ...options,
                    headers
                });

                const data = await response.json();

                if (!response.ok)
                {
                    throw new Error(data.error_description || data.message || data.msg || 'Request failed');
                }

                return data;
            } catch (error)
            {
                this.logger.error('API request failed:', error);
                throw error;
            }
        }

        /**
         * Check for existing session in storage
         */
        async checkExistingSession()
        {
            try
            {
                const storedSession = await this.storage.get(this.getStorageKey('AUTH'));
                if (storedSession && storedSession.access_token)
                {
                    // Verify the session is still valid
                    const user = await this.getUser(storedSession.access_token);
                    if (user)
                    {
                        this.session = storedSession;
                        this.handleAuthStateChange('SIGNED_IN', this.session);
                        // Load current device
                        await this.loadCurrentDevice();
                    } else
                    {
                        // Session expired, clear it
                        await this.storage.remove(this.getStorageKey('AUTH'));
                    }
                }
            } catch (error)
            {
                this.logger.error('Error checking session:', error);
            }
        }

        /**
         * Get storage key
         */
        getStorageKey(key)
        {
            if (typeof CONFIG !== 'undefined')
            {
                switch (key)
                {
                    case 'AUTH':
                        return CONFIG.SUPABASE.AUTH.STORAGE_KEY;
                    case 'USER':
                        return CONFIG.CACHE.STORAGE_KEYS.USER;
                    case 'BLOCKLIST':
                        return CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST;
                    case 'DEVICE':
                        return CONFIG.CACHE.STORAGE_KEYS.DEVICE;
                    case 'SETTINGS':
                        return CONFIG.CACHE.STORAGE_KEYS.SETTINGS;
                    default:
                        return key;
                }
            }
            return `fokus_${key.toLowerCase()}`;
        }

        /**
         * Get user with access token
         */
        async getUser(accessToken)
        {
            try
            {
                const data = await this.makeRequest('/auth/v1/user', {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                });
                return data;
            } catch (error)
            {
                return null;
            }
        }

        /**
         * Sign up new user
         */
        async signUp(email, password)
        {
            try
            {
                this.logger.info('Attempting to sign up user:', email);

                // Prepare signup data
                const signupData = {
                    email,
                    password
                };

                // Add redirect URL only if we're in a window context
                if (this.isWindow && typeof window !== 'undefined')
                {
                    signupData.options = {
                        emailRedirectTo: `${window.location.origin}/auth/callback`
                    };
                }

                // Step 1: Create auth user
                const authResponse = await this.makeRequest('/auth/v1/signup', {
                    method: 'POST',
                    body: JSON.stringify(signupData)
                });

                this.logger.info('Auth user created', authResponse);

                // Check if email confirmation is required
                const requiresConfirmation = authResponse.user && !authResponse.access_token;

                if (requiresConfirmation)
                {
                    this.logger.info('Email confirmation required for user:', email);

                    // Store user data temporarily for after confirmation
                    await this.storage.set('pending_user', {
                        id: authResponse.user.id,
                        email: authResponse.user.email,
                        created_at: Date.now()
                    });

                    return {
                        success: true,
                        data: authResponse,
                        requiresEmailConfirmation: true,
                        message: 'Please check your email to confirm your account'
                    };
                }

                // Auto-confirmed (email confirmation disabled)
                if (authResponse.access_token)
                {
                    this.session = authResponse;
                    await this.storage.set(this.getStorageKey('AUTH'), authResponse);
                    await this.storage.set(this.getStorageKey('USER'), authResponse.user);

                    // Step 2: Create user record in users table
                    await this.createUserRecord(authResponse.user, authResponse.access_token);

                    // Step 3: Create default blocklist
                    await this.createDefaultBlocklist(authResponse.user.id, authResponse.access_token);

                    // Step 4: Register current device
                    await this.registerCurrentDevice(authResponse.user.id, authResponse.access_token);

                    this.handleAuthStateChange('SIGNED_IN', this.session);

                    return {
                        success: true,
                        data: authResponse,
                        requiresEmailConfirmation: false
                    };
                }

                // Shouldn't reach here, but handle gracefully
                return {
                    success: true,
                    data: authResponse,
                    requiresEmailConfirmation: true
                };
            } catch (error)
            {
                this.logger.error('Sign up error:', error);
                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

        /**
         * Create user record in users table
         */
        async createUserRecord(authUser, accessToken)
        {
            try
            {
                const userData = {
                    id: authUser.id,
                    email: authUser.email,
                    subscription_tier: 'free',
                    device_limit: 1,
                    stripe_customer_id: null,
                    subscription_end_date: null
                };

                this.logger.info('Creating user record with data:', userData);

                const response = await fetch(`${this.supabaseUrl}/rest/v1/users`, {
                    method: 'POST',
                    headers: {
                        'apikey': this.supabaseKey,
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=representation'
                    },
                    body: JSON.stringify(userData)
                });

                const data = await response.json();

                if (!response.ok)
                {
                    // Check if user already exists (this is okay, might happen on retry)
                    if (data.message && data.message.includes('duplicate'))
                    {
                        this.logger.info('User record already exists');
                        return;
                    }
                    throw new Error(data.message || 'Failed to create user record');
                }

                this.logger.info('User record created successfully:', data);
            } catch (error)
            {
                this.logger.error('Failed to create user record:', error);
                // Don't throw - continue with the flow even if this fails
            }
        }

        /**
         * Create default blocklist for new user
         */
        async createDefaultBlocklist(userId, accessToken)
        {
            try
            {
                const blocklist = {
                    user_id: userId,
                    keywords: [],
                    domains: [],
                    github_urls: [],
                    is_active: true,
                    priority: 0,
                    notes: null
                };

                this.logger.info('Creating default blocklist for user:', userId);

                const response = await fetch(`${this.supabaseUrl}/rest/v1/user_blocklists`, {
                    method: 'POST',
                    headers: {
                        'apikey': this.supabaseKey,
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=representation'
                    },
                    body: JSON.stringify(blocklist)
                });

                const data = await response.json();

                if (!response.ok)
                {
                    // Check if blocklist already exists
                    if (data.message && data.message.includes('duplicate'))
                    {
                        this.logger.info('Blocklist already exists');
                        return;
                    }
                    throw new Error(data.message || 'Failed to create blocklist');
                }

                this.logger.info('Default blocklist created:', data);
            } catch (error)
            {
                this.logger.error('Failed to create blocklist:', error);
                // Don't throw - continue with the flow
            }
        }

        /**
         * Register current device
         */
        async registerCurrentDevice(userId, accessToken)
        {
            try
            {
                // Generate device UUID if not exists
                let deviceUuid = await this.storage.get('device_uuid');
                if (!deviceUuid)
                {
                    deviceUuid = this.generateUUID();
                    await this.storage.set('device_uuid', deviceUuid);
                }

                const deviceInfo = this.getDeviceInfo();
                const deviceData = {
                    user_id: userId,
                    device_uuid: deviceUuid,
                    browser_name: deviceInfo.browserName,
                    browser_version: deviceInfo.browserVersion || 'Unknown',
                    operating_system: deviceInfo.os,
                    device_name: `${deviceInfo.browserName} on ${deviceInfo.os}`,
                    is_active: true,
                    last_activity: new Date().toISOString()
                };

                this.logger.info('Registering device with data:', deviceData);

                const response = await fetch(`${this.supabaseUrl}/rest/v1/devices`, {
                    method: 'POST',
                    headers: {
                        'apikey': this.supabaseKey,
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=representation'
                    },
                    body: JSON.stringify(deviceData)
                });

                const data = await response.json();

                if (!response.ok)
                {
                    // Check if device already exists
                    if (data.message && data.message.includes('duplicate'))
                    {
                        this.logger.info('Device already exists, updating it');
                        // Try to update the existing device
                        await this.updateExistingDevice(userId, deviceUuid, accessToken);
                        return;
                    }
                    throw new Error(data.message || 'Failed to register device');
                }

                if (data && data.length > 0)
                {
                    this.currentDevice = data[0];
                    await this.storage.set('current_device', this.currentDevice);
                    this.logger.info('Device registered successfully:', data[0]);
                }
            } catch (error)
            {
                this.logger.error('Failed to register device:', error);
                // Don't throw - device registration is not critical for signup
            }
        }

        /**
         * Update existing device
         */
        async updateExistingDevice(userId, deviceUuid, accessToken)
        {
            try
            {
                const response = await fetch(
                    `${this.supabaseUrl}/rest/v1/devices?user_id=eq.${userId}&device_uuid=eq.${deviceUuid}`,
                    {
                        method: 'PATCH',
                        headers: {
                            'apikey': this.supabaseKey,
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=representation'
                        },
                        body: JSON.stringify({
                            is_active: true,
                            last_activity: new Date().toISOString()
                        })
                    }
                );

                const data = await response.json();
                if (data && data.length > 0)
                {
                    this.currentDevice = data[0];
                    await this.storage.set('current_device', this.currentDevice);
                    this.logger.info('Device updated successfully');
                }
            } catch (error)
            {
                this.logger.error('Failed to update device:', error);
            }
        }

        /**
         * Load current device
         */
        async loadCurrentDevice()
        {
            try
            {
                const deviceUuid = await this.storage.get('device_uuid');
                if (!deviceUuid) return;

                const user = await this.getCurrentUser();
                if (!user) return;

                const response = await this.makeRequest(
                    `/rest/v1/devices?user_id=eq.${user.id}&device_uuid=eq.${deviceUuid}`,
                    { method: 'GET' }
                );

                if (response && response.length > 0)
                {
                    this.currentDevice = response[0];
                    await this.storage.set('current_device', this.currentDevice);
                }
            } catch (error)
            {
                this.logger.error('Failed to load device:', error);
            }
        }

        /**
         * Get device info
         */
        getDeviceInfo()
        {
            const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';

            // Detect browser
            let browserName = 'Unknown';
            let browserVersion = 'Unknown';

            if (userAgent.includes('Edg'))
            {
                browserName = 'Edge';
                const match = userAgent.match(/Edg\/(\d+\.\d+)/);
                if (match) browserVersion = match[1];
            } else if (userAgent.includes('Chrome'))
            {
                browserName = 'Chrome';
                const match = userAgent.match(/Chrome\/(\d+\.\d+)/);
                if (match) browserVersion = match[1];
            } else if (userAgent.includes('Firefox'))
            {
                browserName = 'Firefox';
                const match = userAgent.match(/Firefox\/(\d+\.\d+)/);
                if (match) browserVersion = match[1];
            } else if (userAgent.includes('Safari'))
            {
                browserName = 'Safari';
                const match = userAgent.match(/Version\/(\d+\.\d+)/);
                if (match) browserVersion = match[1];
            }

            // Detect OS
            let os = 'Unknown';
            if (userAgent.includes('Windows')) os = 'Windows';
            else if (userAgent.includes('Mac')) os = 'macOS';
            else if (userAgent.includes('Linux')) os = 'Linux';
            else if (userAgent.includes('Android')) os = 'Android';
            else if (userAgent.includes('iOS')) os = 'iOS';

            return {
                browserName,
                browserVersion,
                os
            };
        }

        /**
         * Generate UUID v4
         */
        generateUUID()
        {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c)
            {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }

        /**
         * Sign in existing user
         */
        async signIn(email, password)
        {
            try
            {
                this.logger.info('Attempting to sign in user:', email);

                const response = await this.makeRequest('/auth/v1/token?grant_type=password', {
                    method: 'POST',
                    body: JSON.stringify({
                        email,
                        password
                    })
                });

                this.logger.info('Sign in successful');

                // Store session
                this.session = response;
                await this.storage.set(this.getStorageKey('AUTH'), response);
                await this.storage.set(this.getStorageKey('USER'), response.user);

                // Make sure all related records exist
                await this.ensureUserRecordsExist(response.user, response.access_token);

                this.handleAuthStateChange('SIGNED_IN', this.session);

                return {
                    success: true,
                    data: response
                };
            } catch (error)
            {
                this.logger.error('Sign in error:', error);

                // Check if it's an email confirmation error
                if (error.message && error.message.includes('Email not confirmed'))
                {
                    return {
                        success: false,
                        error: 'Please check your email and confirm your account before signing in',
                        needsEmailConfirmation: true
                    };
                }

                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

        /**
         * Ensure all user-related records exist
         */
        async ensureUserRecordsExist(user, accessToken)
        {
            try
            {
                // Check if user record exists in users table
                const userResponse = await fetch(
                    `${this.supabaseUrl}/rest/v1/users?id=eq.${user.id}`,
                    {
                        method: 'GET',
                        headers: {
                            'apikey': this.supabaseKey,
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                const userData = await userResponse.json();

                if (!userData || userData.length === 0)
                {
                    // Create user record
                    await this.createUserRecord(user, accessToken);
                }

                // Check if blocklist exists
                const blocklistResponse = await fetch(
                    `${this.supabaseUrl}/rest/v1/user_blocklists?user_id=eq.${user.id}`,
                    {
                        method: 'GET',
                        headers: {
                            'apikey': this.supabaseKey,
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                const blocklistData = await blocklistResponse.json();

                if (!blocklistData || blocklistData.length === 0)
                {
                    // Create default blocklist
                    await this.createDefaultBlocklist(user.id, accessToken);
                }

                // Register/update device
                await this.registerCurrentDevice(user.id, accessToken);

            } catch (error)
            {
                this.logger.error('Error ensuring user records exist:', error);
            }
        }

        /**
         * Sign out current user
         */
        async signOut()
        {
            try
            {
                // Call Supabase signout endpoint if we have a session
                if (this.session?.access_token)
                {
                    await this.makeRequest('/auth/v1/logout', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.session.access_token}`
                        }
                    }).catch(err =>
                    {
                        this.logger.debug('Signout API call failed:', err);
                    });
                }

                // Clear local storage
                await this.storage.clear();

                this.session = null;
                this.currentDevice = null;
                this.handleAuthStateChange('SIGNED_OUT', null);

                this.logger.info('User signed out successfully');
                return { success: true };
            } catch (error)
            {
                this.logger.error('Sign out error:', error);
                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

        /**
         * Handle email confirmation callback
         */
        async handleEmailConfirmation(accessToken, refreshToken)
        {
            try
            {
                this.logger.info('Handling email confirmation');

                // Exchange tokens for session
                const response = await this.makeRequest('/auth/v1/user', {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                });

                if (response)
                {
                    // Create session object
                    this.session = {
                        access_token: accessToken,
                        refresh_token: refreshToken,
                        user: response,
                        expires_at: Math.floor(Date.now() / 1000) + 3600 // 1 hour
                    };

                    // Store session
                    await this.storage.set(this.getStorageKey('AUTH'), this.session);
                    await this.storage.set(this.getStorageKey('USER'), response);

                    // Create user records
                    await this.ensureUserRecordsExist(response, accessToken);

                    this.handleAuthStateChange('SIGNED_IN', this.session);

                    return {
                        success: true,
                        data: this.session
                    };
                }

                throw new Error('Failed to get user after email confirmation');
            } catch (error)
            {
                this.logger.error('Email confirmation error:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        }

        /**
         * Resend confirmation email
         */
        async resendConfirmationEmail(email)
        {
            try
            {
                await this.makeRequest('/auth/v1/resend', {
                    method: 'POST',
                    body: JSON.stringify({
                        type: 'signup',
                        email: email
                    })
                });

                return {
                    success: true,
                    message: 'Confirmation email sent'
                };
            } catch (error)
            {
                this.logger.error('Resend confirmation error:', error);
                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

        /**
         * Reset password
         */
        async resetPassword(email)
        {
            try
            {
                await this.makeRequest('/auth/v1/recover', {
                    method: 'POST',
                    body: JSON.stringify({
                        email
                    })
                });

                this.logger.info('Password reset email sent:', email);
                return {
                    success: true,
                    message: 'Password reset email sent'
                };
            } catch (error)
            {
                this.logger.error('Password reset error:', error);
                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

        /**
         * Get current session
         */
        async getSession()
        {
            try
            {
                if (this.session)
                {
                    // Check if session is expired
                    if (this.session.expires_at)
                    {
                        const expiresAt = new Date(this.session.expires_at * 1000);
                        if (expiresAt < new Date())
                        {
                            this.session = null;
                            await this.storage.remove(this.getStorageKey('AUTH'));
                            return null;
                        }
                    }
                    return this.session;
                }

                const storedSession = await this.storage.get(this.getStorageKey('AUTH'));
                if (storedSession)
                {
                    this.session = storedSession;
                    return this.session;
                }

                return null;
            } catch (error)
            {
                this.logger.error('Get session error:', error);
                return null;
            }
        }

        /**
         * Get current user
         */
        async getCurrentUser()
        {
            try
            {
                const session = await this.getSession();
                return session ? session.user : null;
            } catch (error)
            {
                this.logger.error('Get user error:', error);
                return null;
            }
        }

        /**
         * Get user blocklist from database
         */
        async getUserBlocklist()
        {
            try
            {
                const user = await this.getCurrentUser();
                if (!user)
                {
                    return { success: false, error: 'Not authenticated' };
                }

                const data = await this.makeRequest(
                    `/rest/v1/user_blocklists?user_id=eq.${user.id}&select=*`,
                    { method: 'GET' }
                );

                let blocklist = data && data.length > 0 ? data[0] : null;

                if (!blocklist)
                {
                    // Create default blocklist if none exists
                    const session = await this.getSession();
                    if (session)
                    {
                        await this.createDefaultBlocklist(user.id, session.access_token);
                    }
                    blocklist = {
                        keywords: [],
                        domains: [],
                        github_urls: [],
                        is_active: true
                    };
                }

                // Cache locally
                await this.storage.set(this.getStorageKey('BLOCKLIST'), blocklist);

                return { success: true, data: blocklist };
            } catch (error)
            {
                this.logger.error('Get blocklist error:', error);

                // Fallback to cached version
                const cached = await this.storage.get(this.getStorageKey('BLOCKLIST'));
                if (cached)
                {
                    return { success: true, data: cached };
                }

                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

        /**
         * Update user blocklist in database
         */
        async updateUserBlocklist(updates)
        {
            try
            {
                const user = await this.getCurrentUser();
                if (!user)
                {
                    return { success: false, error: 'Not authenticated' };
                }

                // Ensure arrays are properly formatted
                const formattedUpdates = {
                    keywords: updates.keywords || [],
                    domains: updates.domains || [],
                    github_urls: updates.github_urls || [],
                    updated_at: new Date().toISOString()
                };

                // Update existing blocklist
                const response = await this.makeRequest(
                    `/rest/v1/user_blocklists?user_id=eq.${user.id}`,
                    {
                        method: 'PATCH',
                        body: JSON.stringify(formattedUpdates),
                        headers: {
                            'Prefer': 'return=representation'
                        }
                    }
                );

                if (response && response.length > 0)
                {
                    // Cache locally
                    await this.storage.set(this.getStorageKey('BLOCKLIST'), response[0]);
                    this.logger.info('Blocklist updated successfully');
                    return { success: true, data: response[0] };
                }

                return { success: false, error: 'Failed to update blocklist' };
            } catch (error)
            {
                this.logger.error('Update blocklist error:', error);
                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

        /**
         * Log block event to database
         */
        async logBlockEvent(eventData)
        {
            try
            {
                const user = await this.getCurrentUser();
                const device = await this.storage.get('current_device');

                if (!user || !device)
                {
                    return { success: false, error: 'Not authenticated or device not registered' };
                }

                // Hash the URL for privacy
                const urlHash = await this.hashString(eventData.url);

                await this.makeRequest('/rest/v1/block_events', {
                    method: 'POST',
                    body: JSON.stringify({
                        user_id: user.id,
                        device_id: device.id,
                        blocked_url_hash: urlHash,
                        block_type: eventData.blockType,
                        block_source: eventData.blockSource
                    }),
                    headers: {
                        'Prefer': 'return=minimal'
                    }
                });

                // Update daily stats
                await this.updateDailyStats(eventData.blockType);

                return { success: true };
            } catch (error)
            {
                this.logger.error('Log block event error:', error);
                return { success: false, error: error.message };
            }
        }

        /**
         * Update daily statistics
         */
        async updateDailyStats(blockType)
        {
            try
            {
                const user = await this.getCurrentUser();
                if (!user) return;

                const today = new Date().toISOString().split('T')[0];

                // First, try to get existing stats for today
                const existingStats = await this.makeRequest(
                    `/rest/v1/daily_stats?user_id=eq.${user.id}&date=eq.${today}`,
                    { method: 'GET' }
                );

                if (existingStats && existingStats.length > 0)
                {
                    // Update existing stats
                    const current = existingStats[0];
                    const blocksByType = current.blocks_by_type || {};
                    blocksByType[blockType] = (blocksByType[blockType] || 0) + 1;

                    await this.makeRequest(
                        `/rest/v1/daily_stats?id=eq.${current.id}`,
                        {
                            method: 'PATCH',
                            body: JSON.stringify({
                                total_blocks: current.total_blocks + 1,
                                blocks_by_type: blocksByType
                            })
                        }
                    );
                } else
                {
                    // Create new stats entry
                    const blocksByType = { keyword: 0, domain: 0, github_list: 0 };
                    blocksByType[blockType] = 1;

                    await this.makeRequest('/rest/v1/daily_stats', {
                        method: 'POST',
                        body: JSON.stringify({
                            user_id: user.id,
                            date: today,
                            total_blocks: 1,
                            blocks_by_type: blocksByType,
                            top_blocked_domains: [],
                            active_devices_count: 1
                        })
                    });
                }
            } catch (error)
            {
                this.logger.error('Failed to update daily stats:', error);
            }
        }

        /**
         * Get user statistics
         */
        async getUserStats(dateRange = 7)
        {
            try
            {
                const user = await this.getCurrentUser();
                if (!user)
                {
                    return { success: false, error: 'Not authenticated' };
                }

                const startDate = new Date();
                startDate.setDate(startDate.getDate() - dateRange);

                const data = await this.makeRequest(
                    `/rest/v1/daily_stats?user_id=eq.${user.id}&date=gte.${startDate.toISOString().split('T')[0]}&select=*&order=date.desc`,
                    { method: 'GET' }
                );

                // Calculate totals
                const stats = {
                    totalBlocks: 0,
                    timeSaved: 0,
                    blocksByType: {
                        domain: 0,
                        keyword: 0,
                        github_list: 0
                    },
                    streak: 0
                };

                if (data && data.length > 0)
                {
                    data.forEach(day =>
                    {
                        stats.totalBlocks += day.total_blocks || 0;
                        if (day.blocks_by_type)
                        {
                            Object.entries(day.blocks_by_type).forEach(([type, count]) =>
                            {
                                if (stats.blocksByType[type] !== undefined)
                                {
                                    stats.blocksByType[type] += count;
                                }
                            });
                        }
                    });

                    // Calculate streak (consecutive days with blocks)
                    stats.streak = this.calculateStreak(data);
                }

                stats.timeSaved = stats.totalBlocks * 5; // 5 minutes per block estimate

                return { success: true, data: stats };
            } catch (error)
            {
                this.logger.error('Get stats error:', error);

                return {
                    success: true,
                    data: {
                        totalBlocks: 0,
                        timeSaved: 0,
                        streak: 0,
                        blocksByType: {
                            domain: 0,
                            keyword: 0,
                            github_list: 0
                        }
                    }
                };
            }
        }

        /**
         * Calculate streak from daily stats
         */
        calculateStreak(dailyStats)
        {
            if (!dailyStats || dailyStats.length === 0) return 0;

            let streak = 0;
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            for (let i = 0; i < dailyStats.length; i++)
            {
                const statDate = new Date(dailyStats[i].date);
                statDate.setHours(0, 0, 0, 0);

                const expectedDate = new Date(today);
                expectedDate.setDate(expectedDate.getDate() - i);

                if (statDate.getTime() === expectedDate.getTime() && dailyStats[i].total_blocks > 0)
                {
                    streak++;
                } else if (i === 0 && statDate.getTime() === expectedDate.getTime() - 86400000)
                {
                    // Allow for yesterday if today has no blocks yet
                    streak++;
                } else
                {
                    break;
                }
            }

            return streak;
        }

        /**
         * Hash string for privacy
         */
        async hashString(str)
        {
            const encoder = new TextEncoder();
            const data = encoder.encode(str);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        /**
         * Handle auth state changes
         */
        handleAuthStateChange(event, session)
        {
            this.logger.debug('Auth state changed:', event);
            this.session = session;

            // Notify all listeners
            this.authListeners.forEach(listener =>
            {
                try
                {
                    listener(event, session);
                } catch (error)
                {
                    this.logger.error('Auth listener error:', error);
                }
            });

            // Handle specific events
            switch (event)
            {
                case 'SIGNED_IN':
                    this.handleSignIn(session);
                    break;
                case 'SIGNED_OUT':
                    this.handleSignOut();
                    break;
            }
        }

        /**
         * Handle sign in event
         */
        async handleSignIn(session)
        {
            try
            {
                if (session?.user)
                {
                    await this.storage.set(this.getStorageKey('USER'), session.user);
                    await this.syncUserData();
                    this.logger.info('User signed in:', session.user.email);
                }
            } catch (error)
            {
                this.logger.error('Sign in handler error:', error);
            }
        }

        /**
         * Handle sign out event
         */
        async handleSignOut()
        {
            try
            {
                this.logger.info('User signed out');
            } catch (error)
            {
                this.logger.error('Sign out handler error:', error);
            }
        }

        /**
         * Register auth state listener
         */
        onAuthStateChange(listener)
        {
            this.authListeners.add(listener);
            return () => this.authListeners.delete(listener);
        }

        /**
         * Sync user data
         */
        async syncUserData()
        {
            try
            {
                const [blocklist, stats] = await Promise.all([
                    this.getUserBlocklist(),
                    this.getUserStats()
                ]);

                this.logger.info('User data synced successfully');
                return { success: true, blocklist, stats };
            } catch (error)
            {
                this.logger.error('Sync error:', error);
                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

        /**
         * Format error for user display
         */
        formatError(error)
        {
            if (typeof error === 'string') return error;

            const message = error.message || error.error_description || 'An unexpected error occurred';

            // Handle common Supabase errors
            const errorMessages = {
                'Invalid login credentials': 'Invalid email or password',
                'Email not confirmed': 'Please check your email to confirm your account',
                'User already registered': 'An account with this email already exists',
                'Password should be at least 6 characters': 'Password must be at least 6 characters',
                'Invalid email': 'Please enter a valid email address',
                'Email rate limit exceeded': 'Too many attempts. Please try again later.',
                'Invalid Refresh Token': 'Your session has expired. Please sign in again.',
                'Email link is invalid or has expired': 'The confirmation link has expired. Please request a new one.',
                'Token has expired or is invalid': 'Your session has expired. Please sign in again.'
            };

            for (const [key, value] of Object.entries(errorMessages))
            {
                if (message.includes(key))
                {
                    return value;
                }
            }

            return message;
        }

        /**
         * Register device (for external calls)
         */
        async registerDevice(deviceInfo)
        {
            try
            {
                const user = await this.getCurrentUser();
                if (!user)
                {
                    return { success: false, error: 'Not authenticated' };
                }

                const session = await this.getSession();
                if (session)
                {
                    await this.registerCurrentDevice(user.id, session.access_token);
                }
                return { success: true, data: this.currentDevice };
            } catch (error)
            {
                this.logger.error('Register device error:', error);
                return { success: false, error: error.message };
            }
        }
    }

    // Export for different environments
    if (typeof module !== 'undefined' && module.exports)
    {
        // Node.js
        module.exports = SupabaseClient;
    } else if (typeof define === 'function' && define.amd)
    {
        // AMD
        define([], function ()
        {
            return SupabaseClient;
        });
    } else
    {
        // Browser/Service Worker
        global.SupabaseClient = SupabaseClient;

        // Create singleton instance
        global.supabaseClient = new SupabaseClient();
    }

})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);