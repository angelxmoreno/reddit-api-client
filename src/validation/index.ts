import { z } from 'zod';
import type { ValidationResult } from '../types';

const AppOnlyConfigSchema = z.object({
    kind: z.literal('app'),
    clientId: z.string().min(1, 'Client ID is required'),
    clientSecret: z.string().min(1, 'Client secret is required'),
    userAgent: z.string().min(1, 'User agent is required'),
    scope: z.array(z.string()).optional(),
});

const UserTokensConfigSchema = z.object({
    kind: z.literal('userTokens'),
    clientId: z.string().min(1, 'Client ID is required'),
    clientSecret: z.string().min(1, 'Client secret is required'),
    userAgent: z.string().min(1, 'User agent is required'),
    accessToken: z.string().min(1, 'Access token is required'),
    refreshToken: z.string().min(1, 'Refresh token is required'),
    scope: z.array(z.string()).min(1, 'At least one scope is required'),
    usernameHint: z.string().optional(),
});

const PasswordGrantConfigSchema = z.object({
    kind: z.literal('password'),
    clientId: z.string().min(1, 'Client ID is required'),
    clientSecret: z.string().min(1, 'Client secret is required'),
    userAgent: z.string().min(1, 'User agent is required'),
    username: z.string().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
    scope: z.array(z.string()).optional(),
});

const CredentialConfigSchema = z.discriminatedUnion('kind', [
    AppOnlyConfigSchema,
    UserTokensConfigSchema,
    PasswordGrantConfigSchema,
]);

const RateLimitRuleSchema = z.object({
    max: z.number().positive('Max must be positive'),
    windowMs: z.number().positive('Window must be positive'),
    per: z.enum(['user', 'app']),
});

const RateLimitRulesSchema = z.object({
    global: RateLimitRuleSchema,
    endpoints: z.record(z.string(), RateLimitRuleSchema).optional(),
});

const RedditClientConfigSchema = z.object({
    credentials: CredentialConfigSchema,
    storage: z.unknown(), // Can't validate Keyv instance with Zod
    logger: z.unknown(), // Can't validate Pino logger with Zod
    axios: z.unknown().optional(),
    rateLimiter: z
        .object({
            strategy: z.enum(['throw', 'wait']),
            rules: RateLimitRulesSchema,
        })
        .optional(),
});

export function validateCredentialConfig(config: unknown): ValidationResult {
    const result = CredentialConfigSchema.safeParse(config);

    if (result.success) {
        return { valid: true };
    }

    return {
        valid: false,
        errors: result.error.issues.map((err) => `${err.path.join('.')}: ${err.message}`),
    };
}

export function validateRedditClientConfig(config: unknown): ValidationResult {
    const result = RedditClientConfigSchema.safeParse(config);

    if (result.success) {
        return { valid: true };
    }

    return {
        valid: false,
        errors: result.error.issues.map((err) => `${err.path.join('.')}: ${err.message}`),
    };
}

export const CredentialConfigValidator = {
    validate: validateCredentialConfig,
    validateClientConfig: validateRedditClientConfig,
};
