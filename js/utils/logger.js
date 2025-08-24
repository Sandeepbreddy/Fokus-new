/**
 * Logger Utility
 * Centralized logging with different levels and optional remote logging
 */

class Logger
{
    constructor(context = 'General')
    {
        this.context = context;
        this.levels = {
            DEBUG: 0,
            INFO: 1,
            WARN: 2,
            ERROR: 3,
            FATAL: 4
        };

        // Get log level from config or default to INFO
        this.currentLevel = this.levels[this.getLogLevel()] || this.levels.INFO;
        this.remoteLoggingEnabled = this.shouldEnableRemoteLogging();
        this.logBuffer = [];
        this.maxBufferSize = 100;
    }

    /**
     * Get current log level from environment
     */
    getLogLevel()
    {
        try
        {
            // In production, this would come from CONFIG
            if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production')
            {
                return 'ERROR';
            }
            return localStorage.getItem('fokus_log_level') || 'INFO';
        } catch
        {
            return 'INFO';
        }
    }

    /**
     * Check if remote logging should be enabled
     */
    shouldEnableRemoteLogging()
    {
        try
        {
            return localStorage.getItem('fokus_remote_logging') === 'true';
        } catch
        {
            return false;
        }
    }

    /**
     * Format log message
     */
    formatMessage(level, message, data)
    {
        const timestamp = new Date().toISOString();
        const formattedMessage = {
            timestamp,
            level,
            context: this.context,
            message,
            data: data || undefined
        };

        return formattedMessage;
    }

    /**
     * Log to console
     */
    logToConsole(level, message, data)
    {
        const formatted = this.formatMessage(level, message, data);
        const prefix = `[${formatted.timestamp}] [${this.context}] ${level}:`;

        switch (level)
        {
            case 'DEBUG':
                console.debug(prefix, message, data || '');
                break;
            case 'INFO':
                console.info(prefix, message, data || '');
                break;
            case 'WARN':
                console.warn(prefix, message, data || '');
                break;
            case 'ERROR':
            case 'FATAL':
                console.error(prefix, message, data || '');
                break;
            default:
                console.log(prefix, message, data || '');
        }
    }

    /**
     * Send logs to remote server
     */
    async sendToRemote(logEntry)
    {
        if (!this.remoteLoggingEnabled) return;

        try
        {
            // Buffer logs to send in batches
            this.logBuffer.push(logEntry);

            if (this.logBuffer.length >= 10)
            {
                await this.flushLogs();
            }
        } catch (error)
        {
            console.error('Failed to send logs to remote:', error);
        }
    }

    /**
     * Flush buffered logs to remote
     */
    async flushLogs()
    {
        if (this.logBuffer.length === 0) return;

        const logsToSend = [...this.logBuffer];
        this.logBuffer = [];

        try
        {
            // In production, this would send to your logging service
            // Example: await fetch('https://api.fokus.app/logs', {
            //   method: 'POST',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify({ logs: logsToSend })
            // });

            // For now, just store in localStorage for debugging
            const existingLogs = JSON.parse(localStorage.getItem('fokus_debug_logs') || '[]');
            const updatedLogs = [...existingLogs, ...logsToSend].slice(-this.maxBufferSize);
            localStorage.setItem('fokus_debug_logs', JSON.stringify(updatedLogs));
        } catch (error)
        {
            console.error('Failed to flush logs:', error);
        }
    }

    /**
     * Main logging method
     */
    log(level, message, data)
    {
        const levelValue = this.levels[level];

        if (levelValue >= this.currentLevel)
        {
            this.logToConsole(level, message, data);

            const logEntry = this.formatMessage(level, message, data);

            // Send to remote for warnings and above
            if (levelValue >= this.levels.WARN)
            {
                this.sendToRemote(logEntry);
            }

            // Store critical errors
            if (levelValue >= this.levels.ERROR)
            {
                this.storeError(logEntry);
            }
        }
    }

    /**
     * Store critical errors for later analysis
     */
    storeError(logEntry)
    {
        try
        {
            const errors = JSON.parse(localStorage.getItem('fokus_errors') || '[]');
            errors.push(logEntry);

            // Keep only last 50 errors
            if (errors.length > 50)
            {
                errors.shift();
            }

            localStorage.setItem('fokus_errors', JSON.stringify(errors));
        } catch (error)
        {
            console.error('Failed to store error:', error);
        }
    }

    /**
     * Convenience methods
     */
    debug(message, data)
    {
        this.log('DEBUG', message, data);
    }

    info(message, data)
    {
        this.log('INFO', message, data);
    }

    warn(message, data)
    {
        this.log('WARN', message, data);
    }

    error(message, data)
    {
        this.log('ERROR', message, data);
    }

    fatal(message, data)
    {
        this.log('FATAL', message, data);
    }

    /**
     * Track performance
     */
    time(label)
    {
        if (this.currentLevel <= this.levels.DEBUG)
        {
            console.time(`[${this.context}] ${label}`);
        }
    }

    timeEnd(label)
    {
        if (this.currentLevel <= this.levels.DEBUG)
        {
            console.timeEnd(`[${this.context}] ${label}`);
        }
    }

    /**
     * Track metrics
     */
    metric(name, value, tags = {})
    {
        const metric = {
            name,
            value,
            tags,
            timestamp: Date.now(),
            context: this.context
        };

        this.debug('Metric recorded', metric);

        // In production, send to metrics service
        if (this.remoteLoggingEnabled)
        {
            this.sendMetric(metric);
        }
    }

    /**
     * Send metric to remote service
     */
    async sendMetric(metric)
    {
        try
        {
            // In production, send to metrics service like DataDog, New Relic, etc.
            // await fetch('https://api.fokus.app/metrics', {
            //   method: 'POST',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify(metric)
            // });
        } catch (error)
        {
            this.error('Failed to send metric:', error);
        }
    }

    /**
     * Clear all stored logs
     */
    clearLogs()
    {
        try
        {
            localStorage.removeItem('fokus_debug_logs');
            localStorage.removeItem('fokus_errors');
            this.logBuffer = [];
            this.info('Logs cleared');
        } catch (error)
        {
            this.error('Failed to clear logs:', error);
        }
    }

    /**
     * Get stored errors
     */
    getStoredErrors()
    {
        try
        {
            return JSON.parse(localStorage.getItem('fokus_errors') || '[]');
        } catch
        {
            return [];
        }
    }

    /**
     * Export logs for debugging
     */
    exportLogs()
    {
        const logs = {
            debugLogs: JSON.parse(localStorage.getItem('fokus_debug_logs') || '[]'),
            errors: this.getStoredErrors(),
            currentBuffer: this.logBuffer,
            metadata: {
                context: this.context,
                logLevel: this.getLogLevel(),
                remoteLogging: this.remoteLoggingEnabled,
                exportTime: new Date().toISOString()
            }
        };

        return logs;
    }
}

// Create singleton instance for global logging
const globalLogger = new Logger('Global');

// Make available globally if in browser context
if (typeof window !== 'undefined')
{
    window.Logger = Logger;
    window.globalLogger = globalLogger;
}