import type { AxiosInstance } from 'axios';
import type Keyv from 'keyv';
import type pino from 'pino';

// Credential Configuration Types
export type AppOnlyConfig = {
    kind: 'app';
    clientId: string;
    clientSecret: string;
    userAgent: string;
    scope?: string[];
};

export type UserTokensConfig = {
    kind: 'userTokens';
    clientId: string;
    clientSecret: string;
    userAgent: string;
    accessToken: string;
    refreshToken: string;
    scope: string[];
    usernameHint?: string;
};

export type PasswordGrantConfig = {
    kind: 'password';
    clientId: string;
    clientSecret: string;
    userAgent: string;
    username: string;
    password: string;
    scope?: string[];
};

export type CredentialConfig = AppOnlyConfig | UserTokensConfig | PasswordGrantConfig;

// Token Storage Types
export interface StoredToken {
    access_token: string;
    token_type: 'bearer';
    expires_in: number; // seconds
    scope: string; // space-separated scopes
    received_at: number; // ms epoch
    refresh_token?: string;
}

// Rate Limiting Types
export interface RateLimitRule {
    max: number;
    windowMs: number;
    per: 'user' | 'app';
}

export interface RateLimitRules {
    global: RateLimitRule;
    endpoints?: Record<string, RateLimitRule>;
}

export interface RateLimitState {
    tokens: number;
    lastRefill: number;
    resetAt?: number;
}

// Configuration Types
export interface RedditClientConfig {
    credentials: CredentialConfig;
    storage: Keyv<StoredToken>;
    logger: pino.Logger;
    axios?: AxiosInstance;
    rateLimiter?: {
        strategy: 'throw' | 'wait';
        rules: RateLimitRules;
    };
}

// Validation Types
export type ValidationResult = { valid: true } | { valid: false; errors: string[] };

// Request Types
export interface RequestOptions {
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
    timeout?: number;
}

// Interface Contracts
export interface CredentialManager {
    get(key: string): Promise<StoredToken | null>;
    set(key: string, token: StoredToken): Promise<void>;
    clear(key: string): Promise<void>;
    cleanup(): Promise<void>;
    buildKey(config: CredentialConfig): string;
    validateToken(token: StoredToken, credentialType?: CredentialConfig['kind']): Promise<boolean>;
}

export interface AuthProvider {
    ensureValidToken(): Promise<StoredToken>;
    getUserAgent(): string;
    checkScopes(required: string[]): Promise<boolean>;
    getConfig(): CredentialConfig;
    getStorageKey(): string;
}

export interface RateLimiter {
    schedule<T>(key: string, task: () => Promise<T>, endpoint?: string): Promise<T>;
    updateFromHeaders(key: string, headers: Record<string, string | number | undefined>): Promise<void>;
}
