import { describe, expect, test } from 'bun:test';
import { AuthErrors } from '../src/errors';

describe('AuthErrors', () => {
    test('should create auth failed error', () => {
        const error = AuthErrors.authFailed('Authentication failed');
        expect(error.kind).toBe('auth_failed');
        expect(error.retryable).toBe(false);
        expect(error.message).toBe('Authentication failed');
    });

    test('should create rate limited error with retry after', () => {
        const error = AuthErrors.rateLimited('Rate limited', true, 60);
        expect(error.kind).toBe('rate_limited');
        expect(error.retryable).toBe(true);
        expect(error.retryAfter).toBe(60);
    });

    test('should create scope insufficient error', () => {
        const error = AuthErrors.scopeInsufficient(['submit'], ['read']);
        expect(error.kind).toBe('scope_insufficient');
        expect(error.retryable).toBe(false);
        expect(error.message).toContain('submit');
        expect(error.message).toContain('read');
    });
});
