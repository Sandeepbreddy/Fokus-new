/**
 * Stripe Service
 * Handles all payment and subscription management
 */

import CONFIG from '../config.js';
import { Logger } from '../utils/logger.js';
import { supabaseClient } from '../supabaseClient.js';

export class StripeService
{
    constructor()
    {
        this.logger = new Logger('StripeService');
        this.stripePublicKey = CONFIG.STRIPE?.PUBLIC_KEY || null;
        this.apiBaseUrl = CONFIG.API?.BASE_URL || 'https://api.fokus.app';
        this.initialized = false;
    }

    /**
     * Initialize Stripe
     */
    async initialize()
    {
        try
        {
            if (!this.stripePublicKey)
            {
                this.logger.warn('Stripe public key not configured');
                return false;
            }

            // In a Chrome extension, we'll handle Stripe through our backend API
            // Direct Stripe.js integration isn't available in extension context
            this.initialized = true;
            this.logger.info('Stripe service initialized');
            return true;
        } catch (error)
        {
            this.logger.error('Failed to initialize Stripe:', error);
            return false;
        }
    }

    /**
     * Create checkout session for subscription
     */
    async createCheckoutSession(priceId, successUrl, cancelUrl)
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            const response = await this.makeApiRequest('/stripe/create-checkout-session', {
                method: 'POST',
                body: JSON.stringify({
                    priceId,
                    successUrl: successUrl || `${CONFIG.APP.WEBSITE_URL}/success`,
                    cancelUrl: cancelUrl || `${CONFIG.APP.WEBSITE_URL}/pricing`,
                    userId: user.id,
                    email: user.email,
                    metadata: {
                        userId: user.id,
                        email: user.email,
                        source: 'chrome_extension'
                    }
                })
            });

            if (!response.success)
            {
                throw new Error(response.error || 'Failed to create checkout session');
            }

            return {
                success: true,
                checkoutUrl: response.checkoutUrl,
                sessionId: response.sessionId
            };
        } catch (error)
        {
            this.logger.error('Create checkout session error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Create customer portal session
     */
    async createPortalSession(returnUrl)
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            const response = await this.makeApiRequest('/stripe/create-portal-session', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id,
                    returnUrl: returnUrl || CONFIG.APP.WEBSITE_URL
                })
            });

            if (!response.success)
            {
                throw new Error(response.error || 'Failed to create portal session');
            }

            return {
                success: true,
                portalUrl: response.portalUrl
            };
        } catch (error)
        {
            this.logger.error('Create portal session error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get subscription status
     */
    async getSubscriptionStatus()
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            // First check local database
            const { data: subscription, error } = await supabaseClient.client
                .from('subscriptions')
                .select('*')
                .eq('user_id', user.id)
                .single();

            if (error && error.code !== 'PGRST116')
            { // Not found error
                throw error;
            }

            if (!subscription)
            {
                return {
                    success: true,
                    subscription: null,
                    status: 'free',
                    isActive: false
                };
            }

            // Check if subscription is active
            const isActive = subscription.status === 'active' ||
                subscription.status === 'trialing';

            return {
                success: true,
                subscription,
                status: subscription.status,
                isActive,
                currentPeriodEnd: subscription.current_period_end,
                cancelAtPeriodEnd: subscription.cancel_at_period_end
            };
        } catch (error)
        {
            this.logger.error('Get subscription status error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Cancel subscription
     */
    async cancelSubscription()
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            const response = await this.makeApiRequest('/stripe/cancel-subscription', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id
                })
            });

            if (!response.success)
            {
                throw new Error(response.error || 'Failed to cancel subscription');
            }

            // Update local database
            await supabaseClient.client
                .from('subscriptions')
                .update({
                    cancel_at_period_end: true,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', user.id);

            return {
                success: true,
                message: 'Subscription will be cancelled at the end of the billing period'
            };
        } catch (error)
        {
            this.logger.error('Cancel subscription error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Resume cancelled subscription
     */
    async resumeSubscription()
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            const response = await this.makeApiRequest('/stripe/resume-subscription', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id
                })
            });

            if (!response.success)
            {
                throw new Error(response.error || 'Failed to resume subscription');
            }

            // Update local database
            await supabaseClient.client
                .from('subscriptions')
                .update({
                    cancel_at_period_end: false,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', user.id);

            return {
                success: true,
                message: 'Subscription resumed successfully'
            };
        } catch (error)
        {
            this.logger.error('Resume subscription error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Update payment method
     */
    async updatePaymentMethod()
    {
        try
        {
            // Redirect to customer portal for payment method update
            const result = await this.createPortalSession();

            if (result.success)
            {
                // Open portal in new tab
                chrome.tabs.create({ url: result.portalUrl });
                return {
                    success: true,
                    message: 'Opening customer portal...'
                };
            }

            return result;
        } catch (error)
        {
            this.logger.error('Update payment method error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get payment history
     */
    async getPaymentHistory(limit = 10)
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            const response = await this.makeApiRequest('/stripe/payment-history', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id,
                    limit
                })
            });

            if (!response.success)
            {
                throw new Error(response.error || 'Failed to get payment history');
            }

            return {
                success: true,
                payments: response.payments || []
            };
        } catch (error)
        {
            this.logger.error('Get payment history error:', error);
            return {
                success: false,
                error: error.message,
                payments: []
            };
        }
    }

    /**
     * Get available plans
     */
    async getAvailablePlans()
    {
        try
        {
            const response = await this.makeApiRequest('/stripe/plans', {
                method: 'GET'
            });

            if (!response.success)
            {
                throw new Error(response.error || 'Failed to get plans');
            }

            return {
                success: true,
                plans: response.plans || []
            };
        } catch (error)
        {
            this.logger.error('Get plans error:', error);

            // Return default plans as fallback
            return {
                success: true,
                plans: [
                    {
                        id: 'free',
                        name: 'Free',
                        price: 0,
                        interval: null,
                        features: [
                            '10 keyword blocks',
                            '20 domain blocks',
                            '1 device',
                            '7 days of statistics',
                            'Basic support'
                        ]
                    },
                    {
                        id: CONFIG.SUBSCRIPTION.PREMIUM.STRIPE_PRICE_ID_MONTHLY,
                        name: 'Premium Monthly',
                        price: CONFIG.SUBSCRIPTION.PREMIUM.PRICE_MONTHLY,
                        interval: 'month',
                        features: [
                            'Unlimited keyword blocks',
                            'Unlimited domain blocks',
                            'Up to 10 devices',
                            '365 days of statistics',
                            'GitHub blocklist import',
                            'Priority support',
                            'Advanced analytics',
                            'Custom block pages'
                        ]
                    },
                    {
                        id: CONFIG.SUBSCRIPTION.PREMIUM.STRIPE_PRICE_ID_YEARLY,
                        name: 'Premium Yearly',
                        price: CONFIG.SUBSCRIPTION.PREMIUM.PRICE_YEARLY,
                        interval: 'year',
                        features: [
                            'Everything in Premium Monthly',
                            '2 months free',
                            'Early access to new features'
                        ],
                        popular: true
                    }
                ]
            };
        }
    }

    /**
     * Apply coupon code
     */
    async applyCoupon(couponCode)
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            const response = await this.makeApiRequest('/stripe/apply-coupon', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id,
                    couponCode
                })
            });

            if (!response.success)
            {
                throw new Error(response.error || 'Failed to apply coupon');
            }

            return {
                success: true,
                discount: response.discount,
                message: response.message || 'Coupon applied successfully'
            };
        } catch (error)
        {
            this.logger.error('Apply coupon error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Check trial eligibility
     */
    async checkTrialEligibility()
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            const response = await this.makeApiRequest('/stripe/check-trial', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id,
                    email: user.email
                })
            });

            return {
                success: true,
                eligible: response.eligible || false,
                reason: response.reason,
                trialDays: response.trialDays || 7
            };
        } catch (error)
        {
            this.logger.error('Check trial eligibility error:', error);
            return {
                success: false,
                eligible: false,
                error: error.message
            };
        }
    }

    /**
     * Start free trial
     */
    async startFreeTrial()
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            const response = await this.makeApiRequest('/stripe/start-trial', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id,
                    email: user.email
                })
            });

            if (!response.success)
            {
                throw new Error(response.error || 'Failed to start trial');
            }

            // Update user metadata
            await supabaseClient.client
                .from('users')
                .update({
                    subscription_tier: 'premium',
                    subscription_end_date: response.trialEndDate,
                    updated_at: new Date().toISOString()
                })
                .eq('id', user.id);

            return {
                success: true,
                trialEndDate: response.trialEndDate,
                message: 'Free trial started successfully'
            };
        } catch (error)
        {
            this.logger.error('Start trial error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Handle webhook event (called from backend)
     */
    async handleWebhookEvent(event)
    {
        try
        {
            this.logger.info('Processing webhook event:', event.type);

            switch (event.type)
            {
                case 'checkout.session.completed':
                    await this.handleCheckoutComplete(event.data.object);
                    break;

                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                    await this.handleSubscriptionUpdate(event.data.object);
                    break;

                case 'customer.subscription.deleted':
                    await this.handleSubscriptionDeleted(event.data.object);
                    break;

                case 'invoice.payment_succeeded':
                    await this.handlePaymentSucceeded(event.data.object);
                    break;

                case 'invoice.payment_failed':
                    await this.handlePaymentFailed(event.data.object);
                    break;

                default:
                    this.logger.debug('Unhandled webhook event type:', event.type);
            }

            return { success: true };
        } catch (error)
        {
            this.logger.error('Webhook handling error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Handle checkout completion
     */
    async handleCheckoutComplete(session)
    {
        try
        {
            const userId = session.metadata?.userId;
            if (!userId)
            {
                throw new Error('User ID not found in session metadata');
            }

            // Update user subscription tier
            await supabaseClient.client
                .from('users')
                .update({
                    subscription_tier: 'premium',
                    stripe_customer_id: session.customer,
                    updated_at: new Date().toISOString()
                })
                .eq('id', userId);

            this.logger.info('Checkout completed for user:', userId);
        } catch (error)
        {
            this.logger.error('Handle checkout complete error:', error);
            throw error;
        }
    }

    /**
     * Handle subscription update
     */
    async handleSubscriptionUpdate(subscription)
    {
        try
        {
            const userId = subscription.metadata?.userId;
            if (!userId)
            {
                this.logger.warn('User ID not found in subscription metadata');
                return;
            }

            // Upsert subscription record
            await supabaseClient.client
                .from('subscriptions')
                .upsert({
                    user_id: userId,
                    stripe_subscription_id: subscription.id,
                    stripe_customer_id: subscription.customer,
                    status: subscription.status,
                    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                    cancel_at_period_end: subscription.cancel_at_period_end,
                    amount_cents: subscription.items.data[0]?.price.unit_amount || 0,
                    currency: subscription.currency,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'stripe_subscription_id'
                });

            // Update user tier
            const tier = subscription.status === 'active' || subscription.status === 'trialing'
                ? 'premium'
                : 'free';

            await supabaseClient.client
                .from('users')
                .update({
                    subscription_tier: tier,
                    subscription_end_date: new Date(subscription.current_period_end * 1000).toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', userId);

            this.logger.info('Subscription updated for user:', userId);
        } catch (error)
        {
            this.logger.error('Handle subscription update error:', error);
            throw error;
        }
    }

    /**
     * Handle subscription deletion
     */
    async handleSubscriptionDeleted(subscription)
    {
        try
        {
            const userId = subscription.metadata?.userId;
            if (!userId)
            {
                this.logger.warn('User ID not found in subscription metadata');
                return;
            }

            // Update subscription status
            await supabaseClient.client
                .from('subscriptions')
                .update({
                    status: 'cancelled',
                    updated_at: new Date().toISOString()
                })
                .eq('stripe_subscription_id', subscription.id);

            // Downgrade user to free tier
            await supabaseClient.client
                .from('users')
                .update({
                    subscription_tier: 'free',
                    subscription_end_date: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', userId);

            this.logger.info('Subscription cancelled for user:', userId);
        } catch (error)
        {
            this.logger.error('Handle subscription deleted error:', error);
            throw error;
        }
    }

    /**
     * Handle payment success
     */
    async handlePaymentSucceeded(invoice)
    {
        try
        {
            this.logger.info('Payment succeeded:', invoice.id);

            // Could add logic to send thank you email, update stats, etc.
        } catch (error)
        {
            this.logger.error('Handle payment succeeded error:', error);
        }
    }

    /**
     * Handle payment failure
     */
    async handlePaymentFailed(invoice)
    {
        try
        {
            this.logger.warn('Payment failed:', invoice.id);

            // Could add logic to send payment failure notification
        } catch (error)
        {
            this.logger.error('Handle payment failed error:', error);
        }
    }

    /**
     * Make API request to backend
     */
    async makeApiRequest(endpoint, options = {})
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            const session = await supabaseClient.getSession();

            const response = await fetch(`${this.apiBaseUrl}${endpoint}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': session ? `Bearer ${session.access_token}` : '',
                    'X-User-Id': user?.id || '',
                    ...options.headers
                }
            });

            const data = await response.json();

            if (!response.ok)
            {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            return data;
        } catch (error)
        {
            this.logger.error('API request error:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const stripeService = new StripeService();

export default StripeService;