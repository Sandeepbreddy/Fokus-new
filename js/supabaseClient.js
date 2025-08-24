/**
 * Supabase Client Module
 * Handles all Supabase interactions with proper error handling
 * Note: Include Supabase JS library in popup.html and blocked.html via CDN
 */

class SupabaseClient
{
    constructor()
    {
        this.client = null;
        this.session = null;
        this.logger = typeof Logger !== 'undefined' ? new Logger('SupabaseClient') : console;
        this.storage = typeof StorageManager !== 'undefined' ? new StorageManager() : {
            get: (key) => chrome.storage.local.get(key).then(r => r[key]),
            set: (key, value) => chrome.storage.local.set({ [key]: value }),
            remove: (key) => chrome.storage.local.remove(key),
            clear: () => chrome.storage.local.clear()
        };
        this.authListeners = new Set();
        this.initializeClient();
    }

    /**
     * Initialize Supabase client
     */
    initializeClient()
    {
        try
        {
            // Check if Supabase is available
            if (typeof window !== 'undefined' && window.supabase)
            {
                this.client = window.supabase.createClient(
                    CONFIG.SUPABASE.URL,
                    CONFIG.SUPABASE.ANON_KEY,
                    {
                        auth: {
                            storage: {
                                getItem: async (key) =>
                                {
                                    const data = await this.storage.get(key);
                                    return data ? JSON.stringify(data) : null;
                                },
                                setItem: async (key, value) =>
                                {
                                    await this.storage.set(key, JSON.parse(value));
                                },
                                removeItem: async (key) =>
                                {
                                    await this.storage.remove(key);
                                }
                            },
                            autoRefreshToken: true,
                            persistSession: true,
                            detectSessionInUrl: false
                        }
                    }
                );

                // Set up auth state listener
                this.client.auth.onAuthStateChange((event, session) =>
                {
                    this.handleAuthStateChange(event, session);
                });

                this.logger.info('Supabase client initialized');
            } catch (error)
            {
                this.logger.error('Failed to initialize Supabase client:', error);
                throw new Error('Failed to initialize authentication service');
            }
        }

  /**
   * Handle auth state changes
   */
  handleAuthStateChange(event, session) {
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
                case 'TOKEN_REFRESHED':
                    this.logger.info('Token refreshed successfully');
                    break;
                case 'USER_UPDATED':
                    this.handleUserUpdate(session);
                    break;
            }
        }

  /**
   * Handle sign in event
   */
  async handleSignIn(session) {
            try
            {
                await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.USER, session.user);
                await this.syncUserData();
                this.logger.info('User signed in:', session.user.email);
            } catch (error)
            {
                this.logger.error('Sign in handler error:', error);
            }
        }

  /**
   * Handle sign out event
   */
  async handleSignOut() {
            try
            {
                await this.storage.clear();
                this.logger.info('User signed out');
            } catch (error)
            {
                this.logger.error('Sign out handler error:', error);
            }
        }

  /**
   * Handle user update event
   */
  async handleUserUpdate(session) {
            try
            {
                await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.USER, session.user);
                this.logger.info('User data updated');
            } catch (error)
            {
                this.logger.error('User update handler error:', error);
            }
        }

        /**
         * Register auth state listener
         */
        onAuthStateChange(listener) {
            this.authListeners.add(listener);
            return () => this.authListeners.delete(listener);
        }

  /**
   * Sign up new user
   */
  async signUp(email, password) {
            try
            {
                const { data, error } = await this.client.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: CONFIG.SUPABASE.AUTH.REDIRECT_URL,
                        data: {
                            app_name: CONFIG.APP.NAME,
                            signup_timestamp: new Date().toISOString()
                        }
                    }
                });

                if (error) throw error;

                // Create user profile
                if (data.user)
                {
                    await this.createUserProfile(data.user);
                }

                this.logger.info('User signed up successfully:', email);
                return { success: true, data };
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
   * Sign in existing user
   */
  async signIn(email, password) {
            try
            {
                const { data, error } = await this.client.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) throw error;

                this.logger.info('User signed in successfully:', email);
                return { success: true, data };
            } catch (error)
            {
                this.logger.error('Sign in error:', error);
                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

  /**
   * Sign out current user
   */
  async signOut() {
            try
            {
                const { error } = await this.client.auth.signOut();
                if (error) throw error;

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
   * Reset password
   */
  async resetPassword(email) {
            try
            {
                const { error } = await this.client.auth.resetPasswordForEmail(email, {
                    redirectTo: CONFIG.SUPABASE.AUTH.REDIRECT_URL
                });

                if (error) throw error;

                this.logger.info('Password reset email sent:', email);
                return { success: true };
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
  async getSession() {
            try
            {
                const { data: { session }, error } = await this.client.auth.getSession();
                if (error) throw error;

                this.session = session;
                return session;
            } catch (error)
            {
                this.logger.error('Get session error:', error);
                return null;
            }
        }

  /**
   * Get current user
   */
  async getCurrentUser() {
            try
            {
                const { data: { user }, error } = await this.client.auth.getUser();
                if (error) throw error;

                return user;
            } catch (error)
            {
                this.logger.error('Get user error:', error);
                return null;
            }
        }

  /**
   * Create user profile in database
   */
  async createUserProfile(user) {
            try
            {
                const { error } = await this.client
                    .from('users')
                    .insert({
                        id: user.id,
                        email: user.email,
                        subscription_tier: 'free',
                        device_limit: CONFIG.SUBSCRIPTION.FREE.DEVICE_LIMIT,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });

                if (error && error.code !== '23505')
                { // Ignore duplicate key error
                    throw error;
                }

                // Initialize user blocklist
                await this.initializeUserBlocklist(user.id);

                this.logger.info('User profile created');
                return { success: true };
            } catch (error)
            {
                this.logger.error('Create profile error:', error);
                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

  /**
   * Initialize user blocklist
   */
  async initializeUserBlocklist(userId) {
            try
            {
                const { error } = await this.client
                    .from('user_blocklists')
                    .insert({
                        user_id: userId,
                        keywords: [],
                        domains: [],
                        github_urls: [],
                        is_active: true,
                        priority: 0,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });

                if (error && error.code !== '23505')
                { // Ignore duplicate key error
                    throw error;
                }

                this.logger.info('User blocklist initialized');
                return { success: true };
            } catch (error)
            {
                this.logger.error('Initialize blocklist error:', error);
                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

  /**
   * Get user blocklist
   */
  async getUserBlocklist() {
            try
            {
                const user = await this.getCurrentUser();
                if (!user) throw new Error('User not authenticated');

                const { data, error } = await this.client
                    .from('user_blocklists')
                    .select('*')
                    .eq('user_id', user.id)
                    .eq('is_active', true)
                    .single();

                if (error) throw error;

                // Cache the blocklist
                await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST, data);

                return { success: true, data };
            } catch (error)
            {
                this.logger.error('Get blocklist error:', error);

                // Try to return cached data
                const cached = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST);
                if (cached)
                {
                    return { success: true, data: cached, fromCache: true };
                }

                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

  /**
   * Update user blocklist
   */
  async updateUserBlocklist(updates) {
            try
            {
                const user = await this.getCurrentUser();
                if (!user) throw new Error('User not authenticated');

                const { data, error } = await this.client
                    .from('user_blocklists')
                    .update({
                        ...updates,
                        updated_at: new Date().toISOString()
                    })
                    .eq('user_id', user.id)
                    .select()
                    .single();

                if (error) throw error;

                // Update cache
                await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST, data);

                this.logger.info('Blocklist updated successfully');
                return { success: true, data };
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
   * Register device
   */
  async registerDevice(deviceInfo) {
            try
            {
                const user = await this.getCurrentUser();
                if (!user) throw new Error('User not authenticated');

                const deviceData = {
                    user_id: user.id,
                    device_uuid: deviceInfo.uuid,
                    browser_name: deviceInfo.browserName,
                    browser_version: deviceInfo.browserVersion,
                    operating_system: deviceInfo.os,
                    device_name: deviceInfo.name || `${deviceInfo.browserName} on ${deviceInfo.os}`,
                    is_active: true,
                    last_activity: new Date().toISOString(),
                    created_at: new Date().toISOString()
                };

                const { data, error } = await this.client
                    .from('devices')
                    .upsert(deviceData, {
                        onConflict: 'user_id,device_uuid'
                    })
                    .select()
                    .single();

                if (error) throw error;

                // Cache device info
                await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.DEVICE, data);

                this.logger.info('Device registered successfully');
                return { success: true, data };
            } catch (error)
            {
                this.logger.error('Register device error:', error);
                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

  /**
   * Log block event
   */
  async logBlockEvent(eventData) {
            try
            {
                const user = await this.getCurrentUser();
                if (!user) return { success: false, error: 'User not authenticated' };

                const device = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.DEVICE);
                if (!device) return { success: false, error: 'Device not registered' };

                const { error } = await this.client
                    .from('block_events')
                    .insert({
                        user_id: user.id,
                        device_id: device.id,
                        blocked_url_hash: eventData.urlHash,
                        block_type: eventData.blockType,
                        block_source: eventData.blockSource,
                        created_at: new Date().toISOString()
                    });

                if (error) throw error;

                return { success: true };
            } catch (error)
            {
                this.logger.error('Log block event error:', error);
                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

  /**
   * Get user statistics
   */
  async getUserStats(dateRange = 7) {
            try
            {
                const user = await this.getCurrentUser();
                if (!user) throw new Error('User not authenticated');

                const startDate = new Date();
                startDate.setDate(startDate.getDate() - dateRange);

                const { data, error } = await this.client
                    .from('daily_stats')
                    .select('*')
                    .eq('user_id', user.id)
                    .gte('date', startDate.toISOString().split('T')[0])
                    .order('date', { ascending: false });

                if (error) throw error;

                // Cache stats
                await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.STATS, data);

                return { success: true, data };
            } catch (error)
            {
                this.logger.error('Get stats error:', error);

                // Try to return cached data
                const cached = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.STATS);
                if (cached)
                {
                    return { success: true, data: cached, fromCache: true };
                }

                return {
                    success: false,
                    error: this.formatError(error)
                };
            }
        }

  /**
   * Sync user data
   */
  async syncUserData() {
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
        formatError(error) {
            if (typeof error === 'string') return error;

            // Handle common Supabase errors
            const errorMessages = {
                'Invalid login credentials': 'Invalid email or password',
                'Email not confirmed': 'Please check your email to confirm your account',
                'User already registered': 'An account with this email already exists',
                'Password should be at least 6 characters': 'Password must be at least 6 characters',
                'Invalid email': 'Please enter a valid email address'
            };

            const message = error.message || error.error_description || 'An unexpected error occurred';
            return errorMessages[message] || message;
        }
    }

    // Export singleton instance - for use in other scripts
    if(typeof window !== 'undefined') {
    window.supabaseClient = new SupabaseClient();
}