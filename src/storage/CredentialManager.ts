import axios from 'axios';
import type Keyv from 'keyv';
import type pino from 'pino';
import type { CredentialConfig, CredentialManager, StoredToken } from '../types';
import { calculateTokenTTL, isValidTokenStructure, shortHash } from '../utils';

export class DefaultCredentialManager implements CredentialManager {
    constructor(
        protected store: Keyv<StoredToken>,
        protected logger: pino.Logger
    ) {}

    buildKey(cfg: CredentialConfig): string {
        switch (cfg.kind) {
            case 'app':
                return `reddit:token:app:${cfg.clientId}`;
            case 'userTokens': {
                const id = cfg.usernameHint ?? shortHash(cfg.refreshToken);
                return `reddit:token:user:${cfg.clientId}:${id}`;
            }
            case 'password':
                return `reddit:token:pwd:${cfg.clientId}:${cfg.username}`;
        }
    }

    protected extractCredentialTypeFromKey(key: string): CredentialConfig['kind'] | undefined {
        if (key.includes(':app:')) return 'app';
        if (key.includes(':user:')) return 'userTokens';
        if (key.includes(':pwd:')) return 'password';
        return undefined;
    }

    async get(key: string): Promise<StoredToken | null> {
        try {
            const token = await this.store.get(key);

            if (!token) {
                this.logger.debug({ key }, 'No token found in storage');
                return null;
            }

            const credentialType = this.extractCredentialTypeFromKey(key);
            if (!(await this.validateToken(token, credentialType))) {
                this.logger.warn({ key }, 'Found invalid token, clearing');
                await this.clear(key);
                return null;
            }

            this.logger.debug({ key, expiresIn: token.expires_in }, 'Retrieved valid token');
            return token;
        } catch (error) {
            this.logger.error({ error: (error as Error).message, key }, 'Failed to retrieve token');
            return null;
        }
    }

    async set(key: string, token: StoredToken): Promise<void> {
        try {
            // Validate token structure before storing
            if (!isValidTokenStructure(token)) {
                throw new Error('Invalid token structure');
            }

            // Calculate TTL with safety buffer
            const ttl = calculateTokenTTL(token.expires_in);

            this.logger.debug(
                {
                    key,
                    ttl,
                    expires_in: token.expires_in,
                    scope: token.scope,
                },
                'Storing token'
            );

            await this.store.set(key, token, ttl);
        } catch (error) {
            this.logger.error({ error: (error as Error).message, key }, 'Failed to store token');
            throw error;
        }
    }

    async clear(key: string): Promise<void> {
        try {
            await this.store.delete(key);
            this.logger.debug({ key }, 'Cleared token');
        } catch (error) {
            this.logger.error({ error: (error as Error).message, key }, 'Failed to clear token');
            throw error;
        }
    }

    async cleanup(): Promise<void> {
        // Keyv handles TTL automatically, but we can add manual cleanup if needed
        this.logger.debug('Token cleanup completed (TTL handled by Keyv)');
    }

    async validateToken(token: StoredToken, credentialType?: CredentialConfig['kind']): Promise<boolean> {
        // First check structure
        if (!isValidTokenStructure(token)) {
            this.logger.debug('Token failed structure validation');
            return false;
        }

        // For app-only tokens, skip live API validation as /api/v1/me requires user tokens
        if (credentialType === 'app') {
            this.logger.debug('Skipping live API validation for app-only token (structure validation passed)');
            return true;
        }

        // For user tokens, verify with Reddit API
        try {
            const response = await axios.get('https://oauth.reddit.com/api/v1/me', {
                headers: {
                    Authorization: `Bearer ${token.access_token}`,
                    'User-Agent': 'reddit-api-client-token-validator/1.0',
                },
                timeout: 5000,
            });

            const isValid = response.status === 200;
            this.logger.debug({ isValid, credentialType }, 'Token API validation result');
            return isValid;
        } catch (error) {
            this.logger.debug({ error: (error as Error).message, credentialType }, 'Token validation API call failed');
            return false;
        }
    }
}
