import { describe, expect, test } from 'bun:test';
import { validateCredentialConfig } from '../src/validation';

describe('CredentialConfigValidator', () => {
    test('should validate app-only config', () => {
        const config = {
            kind: 'app',
            clientId: 'test-client',
            clientSecret: 'test-secret',
            userAgent: 'test-app/1.0',
        };

        const result = validateCredentialConfig(config);
        expect(result.valid).toBe(true);
    });

    test('should reject invalid config', () => {
        const config = {
            kind: 'app',
            clientId: '', // Invalid: empty string
            clientSecret: 'test-secret',
            userAgent: 'test-app/1.0',
        };

        const result = validateCredentialConfig(config);
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.errors).toContain('clientId: Client ID is required');
        }
    });

    test('should validate user tokens config', () => {
        const config = {
            kind: 'userTokens',
            clientId: 'test-client',
            clientSecret: 'test-secret',
            userAgent: 'test-app/1.0',
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            scope: ['read', 'submit'],
        };

        const result = validateCredentialConfig(config);
        expect(result.valid).toBe(true);
    });
});
