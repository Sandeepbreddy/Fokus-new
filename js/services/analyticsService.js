/**
 * Analytics Service
 * Handles event tracking, metrics collection, and statistics
 */

import CONFIG from '../config.js';
import { Logger } from '../utils/logger.js';
import { StorageManager } from '../utils/storage.js';
import { CryptoUtils } from '../utils/crypto.js';
import { supabaseClient } from '../supabaseClient.js';

export class AnalyticsService
{
    constructor()
    {
        this.logger = new Logger('AnalyticsService');
        this.storage = new StorageManager();
        this.eventQueue = [];
        this.batchTimer = null;
        this.sessionId = null;
        this.sessionStartTime = null;
        this.todayStats = {
            totalBlocks: 0,
            blocksByType: {
                domain: 0,
                keyword: 0,
                github_list: 0
            },
            timeSaved: 0,
            uniqueDomains: new Set(),
            hourlyDistribution: new Array(24).fill(0)
        };
        this.isActive = false;
        this.initializeSession();
    }

    /**
     * Initialize analytics session
     */
    async initializeSession()
    {
        this.sessionId = CryptoUtils.generateUUID();
        this.sessionStartTime = Date.now();

        // Load today's cached stats
        await this.loadTodayStats();

        this.logger.info('Analytics session initialized:', this.sessionId);
    }

    /**
     * Start analytics service
     */
    start()
    {
        if (this.isActive)
        {
            this.logger.warn('Analytics service already active');
            return;
        }

        this.isActive = true;
        this.logger.info('Analytics service started');

        // Set up batch processing
        this.scheduleBatch();
    }

    /**
     * Stop analytics service
     */
    stop()
    {
        if (!this.isActive) return;

        this.isActive = false;

        // Clear batch timer
        if (this.batchTimer)
        {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }

        // Flush remaining events
        this.flush();

        this.logger.info('Analytics service stopped');
    }

    /**
     * Track event
     */
    async track(eventName, properties = {})
    {
        if (!CONFIG.ANALYTICS.ENABLED) return;

        const event = {
            id: CryptoUtils.generateUUID(),
            name: eventName,
            properties,
            sessionId: this.sessionId,
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            url: properties.url ? await CryptoUtils.hashUrl(properties.url) : null
        };

        this.eventQueue.push(event);

        // Update real-time stats if it's a block event
        if (eventName === 'site_blocked')
        {
            this.updateRealtimeStats(properties);
        }

        // Flush if queue is full
        if (this.eventQueue.length >= CONFIG.ANALYTICS.MAX_BATCH_SIZE)
        {
            await this.flush();
        }

        this.logger.debug('Event tracked:', eventName);
    }

    /**
     * Log block event
     */
    async logBlockEvent(data)
    {
        try
        {
            const urlHash = await CryptoUtils.hashUrl(data.url);

            const eventData = {
                urlHash: urlHash.full,
                domainHash: urlHash.domain,
                blockType: data.blockType,
                blockSource: data.blockSource,
                timestamp: Date.now()
            };

            // Track in analytics
            await this.track('site_blocked', {
                ...eventData,
                url: data.url // Will be hashed in track()
            });

            // Store for sync
            const result = await supabaseClient.logBlockEvent(eventData);

            if (!result.success)
            {
                // Queue for later sync if failed
                await this.queueForSync(eventData);
            }

            // Update daily stats
            await this.updateDailyStats(eventData);

            return { success: true };
        } catch (error)
        {
            this.logger.error('Failed to log block event:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update real-time stats
     */
    updateRealtimeStats(properties)
    {
        const hour = new Date().getHours();

        this.todayStats.totalBlocks++;
        this.todayStats.hourlyDistribution[hour]++;

        if (properties.blockType)
        {
            this.todayStats.blocksByType[properties.blockType]++;
        }

        if (properties.domainHash)
        {
            this.todayStats.uniqueDomains.add(properties.domainHash);
        }

        // Estimate time saved (5 minutes per block)
        this.todayStats.timeSaved += 5;

        // Save to storage
        this.saveTodayStats();
    }

    /**
     * Load today's stats from storage
     */
    async loadTodayStats()
    {
        try
        {
            const cached = await this.storage.get('today_stats');
            const today = new Date().toDateString();

            if (cached && cached.date === today)
            {
                this.todayStats = {
                    ...cached,
                    uniqueDomains: new Set(cached.uniqueDomains || [])
                };
            } else
            {
                // Reset stats for new day
                await this.resetDailyStats();
            }
        } catch (error)
        {
            this.logger.error('Failed to load today stats:', error);
        }
    }

    /**
     * Save today's stats to storage
     */
    async saveTodayStats()
    {
        try
        {
            await this.storage.set('today_stats', {
                ...this.todayStats,
                uniqueDomains: Array.from(this.todayStats.uniqueDomains),
                date: new Date().toDateString()
            });
        } catch (error)
        {
            this.logger.error('Failed to save today stats:', error);
        }
    }

    /**
     * Reset daily stats
     */
    async resetDailyStats()
    {
        this.todayStats = {
            totalBlocks: 0,
            blocksByType: {
                domain: 0,
                keyword: 0,
                github_list: 0
            },
            timeSaved: 0,
            uniqueDomains: new Set(),
            hourlyDistribution: new Array(24).fill(0)
        };

        await this.saveTodayStats();
    }

    /**
     * Update daily stats in database
     */
    async updateDailyStats(eventData)
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user) return;

            const today = new Date().toISOString().split('T')[0];

            // Get existing stats for today
            const { data: existing } = await supabaseClient.client
                .from('daily_stats')
                .select('*')
                .eq('user_id', user.id)
                .eq('date', today)
                .single();

            if (existing)
            {
                // Update existing record
                const blocksByType = existing.blocks_by_type || {};
                blocksByType[eventData.blockType] = (blocksByType[eventData.blockType] || 0) + 1;

                const topDomains = existing.top_blocked_domains || [];
                if (eventData.domainHash && !topDomains.includes(eventData.domainHash))
                {
                    topDomains.push(eventData.domainHash);
                }

                await supabaseClient.client
                    .from('daily_stats')
                    .update({
                        total_blocks: existing.total_blocks + 1,
                        blocks_by_type: blocksByType,
                        top_blocked_domains: topDomains.slice(-100), // Keep last 100
                        active_devices_count: 1 // Will be aggregated server-side
                    })
                    .eq('id', existing.id);
            } else
            {
                // Create new record
                await supabaseClient.client
                    .from('daily_stats')
                    .insert({
                        user_id: user.id,
                        date: today,
                        total_blocks: 1,
                        blocks_by_type: {
                            [eventData.blockType]: 1
                        },
                        top_blocked_domains: eventData.domainHash ? [eventData.domainHash] : [],
                        active_devices_count: 1
                    });
            }
        } catch (error)
        {
            this.logger.error('Failed to update daily stats:', error);
        }
    }

    /**
     * Get today's stats
     */
    async getTodayStats()
    {
        await this.loadTodayStats();

        return {
            totalBlocks: this.todayStats.totalBlocks,
            timeSaved: this.todayStats.timeSaved,
            blocksByType: this.todayStats.blocksByType,
            uniqueSites: this.todayStats.uniqueDomains.size,
            hourlyDistribution: this.todayStats.hourlyDistribution,
            streak: await this.calculateStreak()
        };
    }

    /**
     * Calculate streak days
     */
    async calculateStreak()
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user) return 0;

            const { data } = await supabaseClient.client
                .from('daily_stats')
                .select('date, total_blocks')
                .eq('user_id', user.id)
                .gt('total_blocks', 0)
                .order('date', { ascending: false })
                .limit(365);

            if (!data || data.length === 0) return 0;

            let streak = 0;
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            for (let i = 0; i < data.length; i++)
            {
                const statDate = new Date(data[i].date);
                statDate.setHours(0, 0, 0, 0);

                const expectedDate = new Date(today);
                expectedDate.setDate(expectedDate.getDate() - i);

                if (statDate.getTime() === expectedDate.getTime())
                {
                    streak++;
                } else
                {
                    break;
                }
            }

            return streak;
        } catch (error)
        {
            this.logger.error('Failed to calculate streak:', error);
            return 0;
        }
    }

    /**
     * Schedule batch processing
     */
    scheduleBatch()
    {
        if (!this.isActive) return;

        this.batchTimer = setTimeout(() =>
        {
            this.flush();
            this.scheduleBatch();
        }, CONFIG.ANALYTICS.BATCH_INTERVAL);
    }

    /**
     * Flush event queue
     */
    async flush()
    {
        if (this.eventQueue.length === 0) return;

        const events = [...this.eventQueue];
        this.eventQueue = [];

        try
        {
            // In production, send to analytics service
            if (CONFIG.ANALYTICS.ENABLED && navigator.onLine)
            {
                await this.sendEvents(events);
            }

            // Store locally for backup
            await this.storeEventsLocally(events);

            this.logger.debug(`Flushed ${events.length} events`);
        } catch (error)
        {
            this.logger.error('Failed to flush events:', error);

            // Re-queue events
            this.eventQueue.unshift(...events);
        }
    }

    /**
     * Send events to analytics service
     */
    async sendEvents(events)
    {
        // In production, this would send to your analytics service
        // For now, we'll store them locally
        const analyticsData = {
            sessionId: this.sessionId,
            events,
            timestamp: Date.now(),
            metadata: {
                version: CONFIG.APP.VERSION,
                browser: navigator.userAgent
            }
        };

        // Store for later processing
        const existing = await this.storage.get('analytics_events') || [];
        existing.push(analyticsData);

        // Keep only last 1000 events
        if (existing.length > 1000)
        {
            existing.splice(0, existing.length - 1000);
        }

        await this.storage.set('analytics_events', existing);
    }

    /**
     * Store events locally
     */
    async storeEventsLocally(events)
    {
        const stored = await this.storage.get('local_analytics') || [];
        stored.push({
            events,
            timestamp: Date.now()
        });

        // Keep only last 7 days
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const filtered = stored.filter(batch => batch.timestamp > sevenDaysAgo);

        await this.storage.set('local_analytics', filtered);
    }

    /**
     * Queue event for sync
     */
    async queueForSync(eventData)
    {
        const pending = await this.storage.get('pending_stats_sync') || [];
        pending.push(eventData);
        await this.storage.set('pending_stats_sync', pending);
    }

    /**
     * Get analytics summary
     */
    async getSummary(days = 30)
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user) return null;

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const { data } = await supabaseClient.client
                .from('daily_stats')
                .select('*')
                .eq('user_id', user.id)
                .gte('date', startDate.toISOString().split('T')[0])
                .order('date', { ascending: false });

            if (!data) return null;

            // Calculate summary metrics
            const summary = {
                totalBlocks: 0,
                totalTimeSaved: 0,
                averageBlocksPerDay: 0,
                mostBlockedDay: null,
                mostBlockedDayCount: 0,
                blocksByType: {
                    domain: 0,
                    keyword: 0,
                    github_list: 0
                },
                topBlockedDomains: {},
                dailyTrend: []
            };

            data.forEach(day =>
            {
                summary.totalBlocks += day.total_blocks;

                if (day.total_blocks > summary.mostBlockedDayCount)
                {
                    summary.mostBlockedDay = day.date;
                    summary.mostBlockedDayCount = day.total_blocks;
                }

                if (day.blocks_by_type)
                {
                    Object.entries(day.blocks_by_type).forEach(([type, count]) =>
                    {
                        summary.blocksByType[type] += count;
                    });
                }

                if (day.top_blocked_domains)
                {
                    day.top_blocked_domains.forEach(domain =>
                    {
                        summary.topBlockedDomains[domain] = (summary.topBlockedDomains[domain] || 0) + 1;
                    });
                }

                summary.dailyTrend.push({
                    date: day.date,
                    blocks: day.total_blocks
                });
            });

            summary.averageBlocksPerDay = Math.round(summary.totalBlocks / days);
            summary.totalTimeSaved = summary.totalBlocks * 5; // 5 minutes per block

            // Get top 10 domains
            summary.topBlockedDomains = Object.entries(summary.topBlockedDomains)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([domain, count]) => ({ domain, count }));

            return summary;
        } catch (error)
        {
            this.logger.error('Failed to get analytics summary:', error);
            return null;
        }
    }

    /**
     * Track performance metric
     */
    trackPerformance(name, duration, metadata = {})
    {
        if (!CONFIG.ANALYTICS.ENABLED) return;

        this.track('performance_metric', {
            name,
            duration,
            ...metadata
        });
    }

    /**
     * Track error
     */
    trackError(error, context = {})
    {
        if (!CONFIG.ANALYTICS.ENABLED) return;

        this.track('error_occurred', {
            message: error.message,
            stack: error.stack,
            ...context
        });
    }

    /**
     * Clean up old analytics data
     */
    async cleanup()
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user) return;

            const retentionDate = new Date();
            retentionDate.setDate(retentionDate.getDate() - CONFIG.ANALYTICS.RETENTION_DAYS);

            // Clean up old daily stats
            await supabaseClient.client
                .from('daily_stats')
                .delete()
                .eq('user_id', user.id)
                .lt('date', retentionDate.toISOString().split('T')[0]);

            // Clean up old block events (handled by partition management)

            // Clean up local storage
            const localAnalytics = await this.storage.get('local_analytics') || [];
            const filtered = localAnalytics.filter(batch =>
                batch.timestamp > retentionDate.getTime()
            );
            await this.storage.set('local_analytics', filtered);

            this.logger.info('Analytics cleanup completed');
        } catch (error)
        {
            this.logger.error('Analytics cleanup error:', error);
        }
    }

    /**
     * Export analytics data
     */
    async exportAnalytics()
    {
        const summary = await this.getSummary(365);
        const todayStats = await this.getTodayStats();
        const localData = await this.storage.get('local_analytics');

        return {
            summary,
            todayStats,
            localData,
            sessionId: this.sessionId,
            exportDate: new Date().toISOString()
        };
    }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();

export default AnalyticsService;