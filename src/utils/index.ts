import * as crypto from 'node:crypto';

/**
 * Creates a short, stable hash from input string
 * Used for creating deterministic cache keys from secrets
 */
export function shortHash(input: string): string {
    const data = Buffer.from(input, 'utf8');
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
}

/**
 * Generates a random string for OAuth state parameters
 */
export function randomString(length = 16): string {
    return crypto.randomBytes(length).toString('hex');
}

/**
 * Checks if a token is expiring soon (within buffer time)
 */
export function isTokenExpiringSoon(token: { received_at: number; expires_in: number }, bufferMs = 60_000): boolean {
    const now = Date.now();
    const expiresAt = token.received_at + token.expires_in * 1000;
    const timeUntilExpiry = expiresAt - now;
    return timeUntilExpiry < bufferMs;
}

/**
 * Calculates TTL for token storage (expires_in minus safety buffer)
 */
export function calculateTokenTTL(expiresIn: number, bufferMs = 60_000): number {
    return Math.max(0, expiresIn * 1000 - bufferMs);
}

/**
 * Extracts endpoint from URL for rate limiting
 */
export function extractEndpoint(url: string): string | undefined {
    const match = url.match(/\/api\/(\w+)/);
    return match ? `/api/${match[1]}` : undefined;
}

/**
 * Validates token structure with type guard
 */
export function isValidTokenStructure(token: unknown): token is {
    access_token: string;
    token_type: 'bearer';
    expires_in: number;
    received_at: number;
    scope: string;
} {
    const t = token as Record<string, unknown>;
    return !!(
        t?.access_token &&
        typeof t.access_token === 'string' &&
        t?.token_type === 'bearer' &&
        typeof t?.expires_in === 'number' &&
        typeof t?.received_at === 'number' &&
        typeof t?.scope === 'string'
    );
}
