import axios from 'axios';
import type pino from 'pino';
import { AuthErrors } from '../errors';
import type {
    AppOnlyConfig,
    AuthProvider,
    CredentialConfig,
    CredentialManager,
    PasswordGrantConfig,
    StoredToken,
    UserTokensConfig,
} from '../types';
import { isTokenExpiringSoon } from '../utils';

export class DefaultAuthProvider implements AuthProvider {
    protected refreshPromise?: Promise<StoredToken>;

    constructor(
        protected cfg: CredentialConfig,
        protected cm: CredentialManager,
        protected logger: pino.Logger
    ) {}

    async ensureValidToken(): Promise<StoredToken> {
        // Return existing refresh promise if one is in progress
        if (this.refreshPromise) {
            this.logger.debug('Waiting for existing refresh operation');
            return this.refreshPromise;
        }

        const key = this.cm.buildKey(this.cfg);
        let token = await this.cm.get(key);

        if (!token || isTokenExpiringSoon(token)) {
            this.logger.debug({ key, hasToken: !!token }, 'Token refresh needed');
            this.refreshPromise = this.refreshToken();

            try {
                token = await this.refreshPromise;
            } finally {
                this.refreshPromise = undefined;
            }
        }

        return token;
    }

    getUserAgent(): string {
        return this.cfg.userAgent;
    }

    getConfig(): CredentialConfig {
        return this.cfg;
    }

    getStorageKey(): string {
        return this.cm.buildKey(this.cfg);
    }

    async checkScopes(required: string[]): Promise<boolean> {
        try {
            const token = await this.ensureValidToken();
            if (!token?.scope) {
                this.logger.warn('Token has no scope information');
                return false;
            }

            const available = token.scope.split(' ');
            const missing = required.filter((scope) => !available.includes(scope));

            if (missing.length > 0) {
                this.logger.warn({ required, available, missing }, 'Scope check failed');
                throw AuthErrors.scopeInsufficient(required, available);
            }

            return true;
        } catch (error) {
            if ((error as { kind?: string }).kind === 'scope_insufficient') {
                throw error;
            }
            this.logger.error({ error: (error as Error).message }, 'Scope check failed');
            return false;
        }
    }

    protected async refreshToken(): Promise<StoredToken> {
        const key = this.cm.buildKey(this.cfg);

        try {
            let token: StoredToken;

            switch (this.cfg.kind) {
                case 'app':
                    token = await this.fetchAppToken();
                    break;
                case 'userTokens':
                    token = await this.refreshUserToken();
                    break;
                case 'password':
                    token = await this.fetchPasswordToken();
                    break;
                default:
                    throw AuthErrors.invalidConfig(
                        `Unsupported credential type: ${(this.cfg as CredentialConfig).kind}`
                    );
            }

            // Store the new token
            await this.cm.set(key, token);
            this.logger.info({ key, scope: token.scope }, 'Token refreshed successfully');

            return token;
        } catch (error) {
            this.logger.error({ error: (error as Error).message, key }, 'Token refresh failed');

            if ((error as { kind?: string }).kind) {
                throw error; // Re-throw AuthErrors
            }

            throw AuthErrors.refreshFailed(`Token refresh failed: ${(error as Error).message}`, false, error as Error);
        }
    }

    protected async fetchAppToken(): Promise<StoredToken> {
        const appConfig = this.cfg as AppOnlyConfig; // We know it's app config from switch

        try {
            const response = await axios.post(
                'https://www.reddit.com/api/v1/access_token',
                new URLSearchParams({
                    grant_type: 'client_credentials',
                    scope: (appConfig.scope || ['read']).join(' '),
                }),
                {
                    headers: {
                        Authorization: `Basic ${Buffer.from(`${appConfig.clientId}:${appConfig.clientSecret}`).toString(
                            'base64'
                        )}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': appConfig.userAgent,
                    },
                }
            );

            const tokenData = response.data;
            return {
                access_token: tokenData.access_token,
                token_type: tokenData.token_type,
                expires_in: tokenData.expires_in,
                scope: tokenData.scope,
                received_at: Date.now(),
            };
        } catch (error) {
            this.logger.error({ error: (error as Error).message }, 'App token fetch failed');
            throw AuthErrors.authFailed(`Failed to fetch app token: ${(error as Error).message}`, true, error as Error);
        }
    }

    protected async refreshUserToken(): Promise<StoredToken> {
        const userConfig = this.cfg as UserTokensConfig; // We know it's user config from switch

        try {
            const response = await axios.post(
                'https://www.reddit.com/api/v1/access_token',
                new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: userConfig.refreshToken,
                }),
                {
                    headers: {
                        Authorization: `Basic ${Buffer.from(
                            `${userConfig.clientId}:${userConfig.clientSecret}`
                        ).toString('base64')}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': userConfig.userAgent,
                    },
                }
            );

            const tokenData = response.data;
            return {
                access_token: tokenData.access_token,
                token_type: tokenData.token_type,
                expires_in: tokenData.expires_in,
                scope: tokenData.scope || userConfig.scope.join(' '), // Fallback to original scope
                received_at: Date.now(),
                refresh_token: tokenData.refresh_token || userConfig.refreshToken, // Keep original if not provided
            };
        } catch (error) {
            this.logger.error({ error: (error as Error).message }, 'User token refresh failed');
            throw AuthErrors.refreshFailed(
                `Failed to refresh user token: ${(error as Error).message}`,
                false,
                error as Error
            );
        }
    }

    protected async fetchPasswordToken(): Promise<StoredToken> {
        const pwdConfig = this.cfg as PasswordGrantConfig; // We know it's password config from switch

        try {
            const response = await axios.post(
                'https://www.reddit.com/api/v1/access_token',
                new URLSearchParams({
                    grant_type: 'password',
                    username: pwdConfig.username,
                    password: pwdConfig.password,
                    scope: (pwdConfig.scope || ['read']).join(' '),
                }),
                {
                    headers: {
                        Authorization: `Basic ${Buffer.from(`${pwdConfig.clientId}:${pwdConfig.clientSecret}`).toString(
                            'base64'
                        )}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': pwdConfig.userAgent,
                    },
                }
            );

            const tokenData = response.data;
            return {
                access_token: tokenData.access_token,
                token_type: tokenData.token_type,
                expires_in: tokenData.expires_in,
                scope: tokenData.scope,
                received_at: Date.now(),
                refresh_token: tokenData.refresh_token,
            };
        } catch (error) {
            this.logger.error({ error: (error as Error).message }, 'Password token fetch failed');
            throw AuthErrors.authFailed(
                `Failed to fetch password token: ${(error as Error).message}`,
                true,
                error as Error
            );
        }
    }
}
