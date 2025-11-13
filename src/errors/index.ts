export interface AuthError extends Error {
    kind: 'auth_failed' | 'refresh_failed' | 'rate_limited' | 'invalid_config' | 'scope_insufficient';
    retryable: boolean;
    retryAfter?: number;
    originalError?: Error;
    context?: {
        endpoint?: string;
        method?: string;
        userId?: string;
    };
}

export const AuthErrors = {
    authFailed(message: string, retryable = false, originalError?: Error): AuthError {
        const error = new Error(message) as AuthError;
        error.name = 'AuthError';
        error.kind = 'auth_failed';
        error.retryable = retryable;
        error.originalError = originalError;
        return error;
    },

    refreshFailed(message: string, retryable = false, originalError?: Error): AuthError {
        const error = new Error(message) as AuthError;
        error.name = 'AuthError';
        error.kind = 'refresh_failed';
        error.retryable = retryable;
        error.originalError = originalError;
        return error;
    },

    rateLimited(message: string, retryable = true, retryAfter?: number): AuthError {
        const error = new Error(message) as AuthError;
        error.name = 'AuthError';
        error.kind = 'rate_limited';
        error.retryable = retryable;
        error.retryAfter = retryAfter;
        return error;
    },

    invalidConfig(message: string): AuthError {
        const error = new Error(message) as AuthError;
        error.name = 'AuthError';
        error.kind = 'invalid_config';
        error.retryable = false;
        return error;
    },

    scopeInsufficient(required: string[], available: string[]): AuthError {
        const message = `Required scopes [${required.join(', ')}] not available in [${available.join(', ')}]`;
        const error = new Error(message) as AuthError;
        error.name = 'AuthError';
        error.kind = 'scope_insufficient';
        error.retryable = false;
        return error;
    },
};
