/**
 * Supabase Client Module (Simplified for Chrome Extension)
 * Works without external Supabase library for basic functionality
 */

class SupabaseClient
{
    constructor()
    {
        this.client = null;
        this.session = null;
        this.logger = typeof Logger !== 'undefined' ? new Logger('SupabaseClient') : console;
        this.storage = {
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
            // For now, we'll work without the Supabase library
            // This is a simplified implementation for testing
            this.logger.info('Initializing client (simplified mode)');

            // Check for existing session
            this.checkExistingSession();
        } catch (error)
        {
            this.logger.error('Failed to initialize client:', error);
        }
    }

    /**
     * Check for existing session in storage
     */
    async checkExistingSession()
    {
        try
        {
            const user = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.USER);
            if (user)
            {
                this.session = { user };
                this.handleAuthStateChange('SIGNED_IN', this.session);
            }
        } catch (error)
        {
            this.logger.error('Error checking session:', error);
        }
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
    async handleSignIn(session)
    {
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
    async handleSignOut()
    {
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
    async handleUserUpdate(session)
    {
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
    onAuthStateChange(listener)
    {
        this.authListeners.add(listener);
        return () => this.authListeners.delete(listener);
    }

    /**
     * Sign up new user (simplified for testing)
     */
    async signUp(email, password)
    {
        try
        {
            // For testing, create a mock user
            const mockUser = {
                id: 'user-' + Date.now(),
                email: email,
                user_metadata: {
                    subscription_tier: 'free'
                },
                created_at: new Date().toISOString()
            };

            await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.USER, mockUser);
            this.session = { user: mockUser };

            this.logger.info('User signed up successfully:', email);
            return { success: true, data: { user: mockUser } };
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
     * Sign in existing user (simplified for testing)
     */
    async signIn(email, password)
    {
        try
        {
            // For testing, create a mock user session
            const mockUser = {
                id: 'user-' + Date.now(),
                email: email,
                user_metadata: {
                    subscription_tier: 'free'
                },
                last_sign_in_at: new Date().toISOString()
            };

            await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.USER, mockUser);
            this.session = { user: mockUser };

            this.handleAuthStateChange('SIGNED_IN', this.session);

            this.logger.info('User signed in successfully:', email);
            return { success: true, data: { user: mockUser } };
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
    async signOut()
    {
        try
        {
            await this.storage.clear();
            this.session = null;
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
     * Reset password
     */
    async resetPassword(email)
    {
        try
        {
            // Mock implementation for testing
            this.logger.info('Password reset email sent:', email);
            return { success: true, message: 'Password reset email sent (mock)' };
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
                return this.session;
            }

            const user = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.USER);
            if (user)
            {
                this.session = { user };
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
     * Get user blocklist (mock implementation)
     */
    async getUserBlocklist()
    {
        try
        {
            const blocklist = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST);

            if (blocklist)
            {
                return { success: true, data: blocklist };
            }

            // Return default blocklist
            const defaultBlocklist = {
                keywords: [],
                domains: [],
                github_urls: [],
                is_active: true,
                created_at: new Date().toISOString()
            };

            await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST, defaultBlocklist);
            return { success: true, data: defaultBlocklist };
        } catch (error)
        {
            this.logger.error('Get blocklist error:', error);
            return {
                success: false,
                error: this.formatError(error)
            };
        }
    }

    /**
     * Update user blocklist
     */
    async updateUserBlocklist(updates)
    {
        try
        {
            const current = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST) || {};
            const updated = {
                ...current,
                ...updates,
                updated_at: new Date().toISOString()
            };

            await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.BLOCKLIST, updated);

            this.logger.info('Blocklist updated successfully');
            return { success: true, data: updated };
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
     * Get user statistics (mock implementation)
     */
    async getUserStats(dateRange = 7)
    {
        try
        {
            // Return mock stats for testing
            const mockStats = {
                totalBlocks: Math.floor(Math.random() * 100),
                timeSaved: Math.floor(Math.random() * 500),
                streak: Math.floor(Math.random() * 30),
                blocksByType: {
                    domain: Math.floor(Math.random() * 50),
                    keyword: Math.floor(Math.random() * 30),
                    github_list: Math.floor(Math.random() * 20)
                }
            };

            return { success: true, data: mockStats };
        } catch (error)
        {
            this.logger.error('Get stats error:', error);
            return {
                success: false,
                error: this.formatError(error)
            };
        }
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

        // Handle common errors
        const errorMessages = {
            'Invalid login credentials': 'Invalid email or password',
            'Email not confirmed': 'Please check your email to confirm your account',
            'User already registered': 'An account with this email already exists',
            'Password should be at least 6 characters': 'Password must be at least 6 characters',
            'Invalid email': 'Please enter a valid email address'
        };

        return errorMessages[message] || message;
    }
}

// Export singleton instance
if (typeof window !== 'undefined')
{
    window.supabaseClient = new SupabaseClient();
}