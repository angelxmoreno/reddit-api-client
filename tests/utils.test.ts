import { describe, expect, test } from 'bun:test';
import {
    calculateTokenTTL,
    extractEndpoint,
    isTokenExpiringSoon,
    isValidTokenStructure,
    randomString,
    shortHash,
} from '../src/utils';

describe('Utils', () => {
    test('should create consistent short hashes', () => {
        const input = 'test-string';
        const hash1 = shortHash(input);
        const hash2 = shortHash(input);

        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(12);
        expect(hash1).toMatch(/^[a-f0-9]{12}$/);
    });

    test('should generate random strings', () => {
        const str1 = randomString();
        const str2 = randomString();

        expect(str1).not.toBe(str2);
        expect(str1).toHaveLength(32); // 16 bytes = 32 hex chars
    });

    test('should detect expiring tokens', () => {
        const now = Date.now();
        const expiringToken = {
            received_at: now,
            expires_in: 30, // 30 seconds, less than 60s buffer
        };
        const validToken = {
            received_at: now,
            expires_in: 3600, // 1 hour
        };

        expect(isTokenExpiringSoon(expiringToken)).toBe(true);
        expect(isTokenExpiringSoon(validToken)).toBe(false);
    });

    test('should calculate token TTL', () => {
        const expiresIn = 3600; // 1 hour
        const ttl = calculateTokenTTL(expiresIn);

        expect(ttl).toBe(3600 * 1000 - 60_000); // 1 hour minus 1 minute
    });

    test('should extract endpoints from URLs', () => {
        expect(extractEndpoint('/api/submit')).toBe('/api/submit');
        expect(extractEndpoint('/r/javascript/about')).toBeUndefined();
        expect(extractEndpoint('/api/vote')).toBe('/api/vote');
    });

    test('should validate token structure', () => {
        const validToken = {
            access_token: 'token',
            token_type: 'bearer' as const,
            expires_in: 3600,
            received_at: Date.now(),
            scope: 'read submit',
        };
        const invalidToken = {
            access_token: 'token',
            // missing required fields
        };

        expect(isValidTokenStructure(validToken)).toBe(true);
        expect(isValidTokenStructure(invalidToken)).toBe(false);
    });
});
