/**
 * Cryptography Utilities
 * Handles hashing and encryption for privacy
 */

class CryptoUtils
{
    /**
     * Create SHA-256 hash of a string
     */
    static async createHash(text)
    {
        try
        {
            const encoder = new TextEncoder();
            const data = encoder.encode(text);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            return hashHex;
        } catch (error)
        {
            console.error('Hashing error:', error);
            // Fallback to simple hash
            return CryptoUtils.simpleHash(text);
        }
    }

    /**
     * Simple hash fallback
     */
    static simpleHash(text)
    {
        let hash = 0;
        for (let i = 0; i < text.length; i++)
        {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(16);
    }

    /**
     * Generate UUID v4
     */
    static generateUUID()
    {
        if (crypto.randomUUID)
        {
            return crypto.randomUUID();
        }

        // Fallback UUID generation
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c)
        {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Generate random string
     */
    static generateRandomString(length = 32)
    {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const values = crypto.getRandomValues(new Uint8Array(length));
        return Array.from(values)
            .map(x => charset[x % charset.length])
            .join('');
    }

    /**
     * Hash URL for privacy
     */
    static async hashUrl(url)
    {
        try
        {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;
            const path = urlObj.pathname;

            // Hash domain and path separately for better analytics
            const domainHash = await CryptoUtils.createHash(domain);
            const pathHash = await CryptoUtils.createHash(path);

            return {
                full: await CryptoUtils.createHash(url),
                domain: domainHash,
                path: pathHash,
                protocol: urlObj.protocol
            };
        } catch (error)
        {
            // If URL parsing fails, just hash the whole string
            return {
                full: await CryptoUtils.createHash(url),
                domain: null,
                path: null,
                protocol: null
            };
        }
    }

    /**
     * Encrypt sensitive data (for future use)
     */
    static async encrypt(data, password)
    {
        try
        {
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(JSON.stringify(data));

            // Derive key from password
            const keyMaterial = await crypto.subtle.importKey(
                'raw',
                encoder.encode(password),
                'PBKDF2',
                false,
                ['deriveBits', 'deriveKey']
            );

            const salt = crypto.getRandomValues(new Uint8Array(16));

            const key = await crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt,
                    iterations: 100000,
                    hash: 'SHA-256'
                },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt']
            );

            const iv = crypto.getRandomValues(new Uint8Array(12));

            const encryptedData = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                key,
                dataBuffer
            );

            // Combine salt, iv, and encrypted data
            const combined = new Uint8Array(salt.length + iv.length + encryptedData.byteLength);
            combined.set(salt, 0);
            combined.set(iv, salt.length);
            combined.set(new Uint8Array(encryptedData), salt.length + iv.length);

            // Convert to base64
            return btoa(String.fromCharCode(...combined));
        } catch (error)
        {
            console.error('Encryption error:', error);
            throw new Error('Failed to encrypt data');
        }
    }

    /**
     * Decrypt sensitive data (for future use)
     */
    static async decrypt(encryptedData, password)
    {
        try
        {
            const encoder = new TextEncoder();
            const decoder = new TextDecoder();

            // Convert from base64
            const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

            // Extract salt, iv, and encrypted data
            const salt = combined.slice(0, 16);
            const iv = combined.slice(16, 28);
            const data = combined.slice(28);

            // Derive key from password
            const keyMaterial = await crypto.subtle.importKey(
                'raw',
                encoder.encode(password),
                'PBKDF2',
                false,
                ['deriveBits', 'deriveKey']
            );

            const key = await crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt,
                    iterations: 100000,
                    hash: 'SHA-256'
                },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                false,
                ['decrypt']
            );

            const decryptedData = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                data
            );

            const decryptedText = decoder.decode(decryptedData);
            return JSON.parse(decryptedText);
        } catch (error)
        {
            console.error('Decryption error:', error);
            throw new Error('Failed to decrypt data');
        }
    }

    /**
     * Compare hashed values securely
     */
    static async secureCompare(hash1, hash2)
    {
        if (hash1.length !== hash2.length)
        {
            return false;
        }

        let result = 0;
        for (let i = 0; i < hash1.length; i++)
        {
            result |= hash1.charCodeAt(i) ^ hash2.charCodeAt(i);
        }

        return result === 0;
    }

    /**
     * Generate device fingerprint
     */
    static async generateDeviceFingerprint()
    {
        const components = [];

        // Browser info
        components.push(navigator.userAgent);
        components.push(navigator.language);
        components.push(navigator.platform);
        components.push(navigator.hardwareConcurrency || 0);

        // Screen info
        components.push(screen.width);
        components.push(screen.height);
        components.push(screen.colorDepth);

        // Timezone
        components.push(new Date().getTimezoneOffset());

        // Canvas fingerprint (simplified)
        try
        {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillText('Fokus', 2, 2);
            components.push(canvas.toDataURL());
        } catch (e)
        {
            components.push('canvas-not-available');
        }

        const fingerprint = components.join('|');
        return await CryptoUtils.createHash(fingerprint);
    }

    /**
     * Validate data integrity
     */
    static async validateIntegrity(data, expectedHash)
    {
        const dataString = JSON.stringify(data);
        const actualHash = await CryptoUtils.createHash(dataString);
        return await CryptoUtils.secureCompare(actualHash, expectedHash);
    }

    /**
     * Create time-based one-time password (TOTP)
     */
    static generateTOTP(secret, window = 30)
    {
        const time = Math.floor(Date.now() / 1000 / window);
        const hash = CryptoUtils.simpleHash(secret + time);
        const code = parseInt(hash.substring(0, 6), 16) % 1000000;
        return code.toString().padStart(6, '0');
    }
}

// Export for direct access to static methods
const createHash = CryptoUtils.createHash;
const generateUUID = CryptoUtils.generateUUID;
const hashUrl = CryptoUtils.hashUrl;

// Make available globally if in browser context
if (typeof window !== 'undefined')
{
    window.CryptoUtils = CryptoUtils;
    window.createHash = createHash;
    window.generateUUID = generateUUID;
    window.hashUrl = hashUrl;
}