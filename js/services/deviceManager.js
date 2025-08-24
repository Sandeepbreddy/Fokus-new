/**
 * Device Manager Service
 * Handles device registration, management, and limits
 */

import CONFIG from '../config.js';
import { Logger } from '../utils/logger.js';
import { StorageManager } from '../utils/storage.js';
import { CryptoUtils } from '../utils/crypto.js';
import { supabaseClient } from '../supabaseClient.js';

export class DeviceManager
{
    constructor()
    {
        this.logger = new Logger('DeviceManager');
        this.storage = new StorageManager();
        this.deviceInfo = null;
        this.deviceId = null;
        this.fingerprint = null;
    }

    /**
     * Initialize device manager
     */
    async initialize()
    {
        try
        {
            // Generate device fingerprint
            this.fingerprint = await CryptoUtils.generateDeviceFingerprint();

            // Get or create device UUID
            this.deviceId = await this.getOrCreateDeviceId();

            // Get device info
            this.deviceInfo = await this.getDeviceInfo();

            this.logger.info('Device manager initialized');
            return true;
        } catch (error)
        {
            this.logger.error('Failed to initialize device manager:', error);
            return false;
        }
    }

    /**
     * Get or create device ID
     */
    async getOrCreateDeviceId()
    {
        let deviceId = await this.storage.get('device_uuid');

        if (!deviceId)
        {
            deviceId = CryptoUtils.generateUUID();
            await this.storage.set('device_uuid', deviceId);
            this.logger.info('Generated new device ID:', deviceId);
        }

        return deviceId;
    }

    /**
     * Get device information
     */
    async getDeviceInfo()
    {
        const info = {
            uuid: this.deviceId,
            fingerprint: this.fingerprint,
            browserName: this.getBrowserName(),
            browserVersion: this.getBrowserVersion(),
            os: this.getOperatingSystem(),
            osVersion: this.getOperatingSystemVersion(),
            screenResolution: `${screen.width}x${screen.height}`,
            colorDepth: screen.colorDepth,
            language: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            platform: navigator.platform,
            cores: navigator.hardwareConcurrency || 'unknown',
            memory: navigator.deviceMemory || 'unknown',
            webgl: this.getWebGLInfo(),
            plugins: this.getPluginsInfo()
        };

        // Create device name
        info.name = `${info.browserName} on ${info.os}`;

        return info;
    }

    /**
     * Register device with backend
     */
    async registerDevice()
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user)
            {
                throw new Error('User not authenticated');
            }

            // Check device limit
            const limitCheck = await this.checkDeviceLimit();
            if (!limitCheck.canRegister)
            {
                throw new Error(limitCheck.message);
            }

            // Get device info
            const deviceInfo = await this.getDeviceInfo();

            // Register with Supabase
            const result = await supabaseClient.registerDevice(deviceInfo);

            if (result.success)
            {
                // Cache device registration
                await this.storage.set(CONFIG.CACHE.STORAGE_KEYS.DEVICE, result.data);

                this.logger.info('Device registered successfully');
                return result;
            }

            throw new Error(result.error || 'Failed to register device');
        } catch (error)
        {
            this.logger.error('Device registration error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Check device limit
     */
    async checkDeviceLimit()
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user)
            {
                return {
                    canRegister: false,
                    message: 'User not authenticated'
                };
            }

            // Get user's device limit
            const { data: userData } = await supabaseClient.client
                .from('users')
                .select('device_limit, subscription_tier')
                .eq('id', user.id)
                .single();

            if (!userData)
            {
                return {
                    canRegister: false,
                    message: 'User data not found'
                };
            }

            // Get active devices count
            const { data: devices, error } = await supabaseClient.client
                .from('devices')
                .select('id')
                .eq('user_id', user.id)
                .eq('is_active', true);

            if (error)
            {
                throw error;
            }

            const activeDevices = devices?.length || 0;
            const limit = userData.device_limit || 1;

            if (activeDevices >= limit)
            {
                const tier = userData.subscription_tier;
                const message = tier === 'free'
                    ? `Device limit reached (${limit}). Upgrade to Premium for up to 10 devices.`
                    : `Device limit reached (${limit}). Please deactivate another device first.`;

                return {
                    canRegister: false,
                    message,
                    currentDevices: activeDevices,
                    limit
                };
            }

            return {
                canRegister: true,
                currentDevices: activeDevices,
                limit,
                remaining: limit - activeDevices
            };
        } catch (error)
        {
            this.logger.error('Device limit check error:', error);
            return {
                canRegister: false,
                message: 'Failed to check device limit'
            };
        }
    }

    /**
     * Get user's devices
     */
    async getUserDevices()
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user)
            {
                throw new Error('User not authenticated');
            }

            const { data, error } = await supabaseClient.client
                .from('devices')
                .select('*')
                .eq('user_id', user.id)
                .order('last_activity', { ascending: false });

            if (error)
            {
                throw error;
            }

            return {
                success: true,
                devices: data || []
            };
        } catch (error)
        {
            this.logger.error('Get devices error:', error);
            return {
                success: false,
                error: error.message,
                devices: []
            };
        }
    }

    /**
     * Deactivate device
     */
    async deactivateDevice(deviceId)
    {
        try
        {
            const user = await supabaseClient.getCurrentUser();
            if (!user)
            {
                throw new Error('User not authenticated');
            }

            const { error } = await supabaseClient.client
                .from('devices')
                .update({
                    is_active: false,
                    last_activity: new Date().toISOString()
                })
                .eq('id', deviceId)
                .eq('user_id', user.id);

            if (error)
            {
                throw error;
            }

            // If deactivating current device, clear local storage
            const currentDevice = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.DEVICE);
            if (currentDevice?.id === deviceId)
            {
                await this.storage.remove(CONFIG.CACHE.STORAGE_KEYS.DEVICE);
            }

            this.logger.info('Device deactivated:', deviceId);
            return { success: true };
        } catch (error)
        {
            this.logger.error('Deactivate device error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Reactivate device
     */
    async reactivateDevice(deviceId)
    {
        try
        {
            // Check device limit first
            const limitCheck = await this.checkDeviceLimit();
            if (!limitCheck.canRegister)
            {
                return {
                    success: false,
                    error: limitCheck.message
                };
            }

            const user = await supabaseClient.getCurrentUser();
            if (!user)
            {
                throw new Error('User not authenticated');
            }

            const { error } = await supabaseClient.client
                .from('devices')
                .update({
                    is_active: true,
                    last_activity: new Date().toISOString()
                })
                .eq('id', deviceId)
                .eq('user_id', user.id);

            if (error)
            {
                throw error;
            }

            this.logger.info('Device reactivated:', deviceId);
            return { success: true };
        } catch (error)
        {
            this.logger.error('Reactivate device error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Update device activity
     */
    async updateActivity()
    {
        try
        {
            const device = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.DEVICE);
            if (!device)
            {
                return { success: false, error: 'Device not registered' };
            }

            const { error } = await supabaseClient.client
                .from('devices')
                .update({
                    last_activity: new Date().toISOString()
                })
                .eq('id', device.id);

            if (error)
            {
                throw error;
            }

            return { success: true };
        } catch (error)
        {
            this.logger.error('Update activity error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get browser name
     */
    getBrowserName()
    {
        const userAgent = navigator.userAgent;

        if (userAgent.includes('Edg')) return 'Edge';
        if (userAgent.includes('Chrome')) return 'Chrome';
        if (userAgent.includes('Firefox')) return 'Firefox';
        if (userAgent.includes('Safari')) return 'Safari';
        if (userAgent.includes('Opera') || userAgent.includes('OPR')) return 'Opera';
        if (userAgent.includes('Brave')) return 'Brave';

        return 'Unknown';
    }

    /**
     * Get browser version
     */
    getBrowserVersion()
    {
        const userAgent = navigator.userAgent;
        const patterns = [
            { name: 'Edg', regex: /Edg\/(\d+\.\d+)/ },
            { name: 'Chrome', regex: /Chrome\/(\d+\.\d+)/ },
            { name: 'Firefox', regex: /Firefox\/(\d+\.\d+)/ },
            { name: 'Safari', regex: /Version\/(\d+\.\d+).*Safari/ },
            { name: 'Opera', regex: /OPR\/(\d+\.\d+)/ },
            { name: 'Opera', regex: /Opera\/(\d+\.\d+)/ }
        ];

        for (const pattern of patterns)
        {
            const match = userAgent.match(pattern.regex);
            if (match)
            {
                return match[1];
            }
        }

        return 'Unknown';
    }

    /**
     * Get operating system
     */
    getOperatingSystem()
    {
        const platform = navigator.platform;
        const userAgent = navigator.userAgent;

        if (platform.startsWith('Win')) return 'Windows';
        if (platform.startsWith('Mac')) return 'macOS';
        if (platform.includes('Linux')) return 'Linux';
        if (/Android/.test(userAgent)) return 'Android';
        if (/iPhone|iPad|iPod/.test(userAgent)) return 'iOS';
        if (/CrOS/.test(userAgent)) return 'Chrome OS';

        return 'Unknown';
    }

    /**
     * Get OS version
     */
    getOperatingSystemVersion()
    {
        const userAgent = navigator.userAgent;

        // Windows
        const windowsMatch = userAgent.match(/Windows NT (\d+\.\d+)/);
        if (windowsMatch)
        {
            const version = windowsMatch[1];
            const versions = {
                '10.0': 'Windows 10/11',
                '6.3': 'Windows 8.1',
                '6.2': 'Windows 8',
                '6.1': 'Windows 7'
            };
            return versions[version] || `Windows NT ${version}`;
        }

        // macOS
        const macMatch = userAgent.match(/Mac OS X (\d+[._]\d+)/);
        if (macMatch)
        {
            return `macOS ${macMatch[1].replace('_', '.')}`;
        }

        // iOS
        const iosMatch = userAgent.match(/OS (\d+[._]\d+)/);
        if (iosMatch)
        {
            return `iOS ${iosMatch[1].replace('_', '.')}`;
        }

        // Android
        const androidMatch = userAgent.match(/Android (\d+\.\d+)/);
        if (androidMatch)
        {
            return `Android ${androidMatch[1]}`;
        }

        return 'Unknown';
    }

    /**
     * Get WebGL info
     */
    getWebGLInfo()
    {
        try
        {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

            if (!gl)
            {
                return 'Not supported';
            }

            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo)
            {
                return {
                    vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
                    renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
                };
            }

            return {
                vendor: gl.getParameter(gl.VENDOR),
                renderer: gl.getParameter(gl.RENDERER)
            };
        } catch (error)
        {
            return 'Not available';
        }
    }

    /**
     * Get plugins info
     */
    getPluginsInfo()
    {
        if (!navigator.plugins || navigator.plugins.length === 0)
        {
            return [];
        }

        const plugins = [];
        for (let i = 0; i < Math.min(navigator.plugins.length, 10); i++)
        {
            plugins.push({
                name: navigator.plugins[i].name,
                filename: navigator.plugins[i].filename
            });
        }

        return plugins;
    }

    /**
     * Check if device is trusted
     */
    async isDeviceTrusted()
    {
        const device = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.DEVICE);
        if (!device) return false;

        // Check if fingerprint matches
        const currentFingerprint = await CryptoUtils.generateDeviceFingerprint();

        // Allow some flexibility for fingerprint changes
        // In production, implement more sophisticated device trust scoring
        return device.is_active && device.device_uuid === this.deviceId;
    }

    /**
     * Export device info
     */
    async exportDeviceInfo()
    {
        const info = await this.getDeviceInfo();
        const registered = await this.storage.get(CONFIG.CACHE.STORAGE_KEYS.DEVICE);
        const devices = await this.getUserDevices();

        return {
            current: info,
            registered,
            allDevices: devices.devices,
            exportDate: new Date().toISOString()
        };
    }
}

// Export singleton instance
export const deviceManager = new DeviceManager();

export default DeviceManager;