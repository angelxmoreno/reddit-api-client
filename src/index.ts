// Core types and interfaces

export { DefaultAuthProvider } from './auth/AuthProvider';

// Error handling
export type { AuthError } from './errors';
export { AuthErrors } from './errors';
// Core implementations
export { DefaultCredentialManager } from './storage/CredentialManager';
export type {
    AppOnlyConfig,
    AuthProvider,
    CredentialConfig,
    CredentialManager,
    PasswordGrantConfig,
    RateLimiter,
    RateLimitRule,
    RateLimitRules,
    RateLimitState,
    RedditClientConfig,
    RequestOptions,
    StoredToken,
    UserTokensConfig,
    ValidationResult,
} from './types';
// Utility functions
export {
    calculateTokenTTL,
    extractEndpoint,
    isTokenExpiringSoon,
    isValidTokenStructure,
    randomString,
    shortHash,
} from './utils';
// Configuration validation
export {
    CredentialConfigValidator,
    validateCredentialConfig,
    validateRedditClientConfig,
} from './validation';
