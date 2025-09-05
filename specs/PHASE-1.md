# Phase 1: Core Authentication Foundation

## Overview
This phase builds the fundamental authentication system for the Reddit API client. You'll implement the core classes that handle credential management, token storage, and OAuth flows.

## Goals
- ✅ Secure token storage with automatic TTL management
- ✅ Multi-user safe cache key generation  
- ✅ Token validation (structure + live API check)
- ✅ OAuth flows for all credential types
- ✅ Configuration validation with Zod
- ✅ Comprehensive error handling

## Prerequisites
- Understanding of TypeScript interfaces and classes
- Basic knowledge of OAuth 2.0 flows
- Familiarity with async/await patterns
- Understanding of discriminated unions

## Task Breakdown

### Task 1.1: Project Setup and Dependencies (2 hours)

**Objective**: Set up the TypeScript project with all required dependencies.

**Steps**:
1. Initialize npm project
2. Install dependencies
3. Configure TypeScript
4. Set up basic project structure

**Detailed Instructions**:

```bash
# Initialize project (from repo root)
npm init -y

# Install runtime dependencies
npm install zod

# Install peer dependencies (for development)
npm install axios keyv pino

# Install dev dependencies
npm install -D typescript @types/node @types/axios jest @types/jest ts-jest

# Initialize TypeScript config
npx tsc --init
```

**Create `tsconfig.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Create directory structure**:
```
src/
  types/
  auth/
  storage/
  errors/
  utils/
tests/
docs/
```

**Acceptance Criteria**:
- [ ] Project compiles with `npx tsc`
- [ ] All dependencies installed correctly
- [ ] Directory structure created
- [ ] No TypeScript errors

### Task 1.2: Define Core Types and Interfaces (3 hours)

**Objective**: Create all TypeScript interfaces and types for the authentication system.

**Create `src/types/index.ts`**:

```ts
import { AxiosInstance } from 'axios';
import * as pino from 'pino';
import Keyv from 'keyv';

// Credential Configuration Types
export type AppOnlyConfig = {
  kind: "app";
  clientId: string;
  clientSecret: string;
  userAgent: string;
  scope?: string[];
};

export type UserTokensConfig = {
  kind: "userTokens";
  clientId: string;
  clientSecret: string;
  userAgent: string;
  accessToken: string;
  refreshToken: string;
  scope: string[];
  usernameHint?: string;
};

export type PasswordGrantConfig = {
  kind: "password";
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
  token_type: "bearer";
  expires_in: number; // seconds
  scope: string;      // space-separated scopes
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
export type ValidationResult = 
  | { valid: true }
  | { valid: false; errors: string[] };

// Request Types
export interface RequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, any>;
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
```

**Acceptance Criteria**:
- [ ] All types compile without errors
- [ ] Discriminated unions work correctly
- [ ] Interfaces are properly exported
- [ ] No circular dependencies

### Task 1.3: Implement Error System (2 hours)

**Objective**: Create a comprehensive error handling system with proper error types.

**Create `src/errors/index.ts`**:

```ts
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

export class AuthErrors {
  static authFailed(message: string, retryable = false, originalError?: Error): AuthError {
    const error = new Error(message) as AuthError;
    error.name = 'AuthError';
    error.kind = 'auth_failed';
    error.retryable = retryable;
    error.originalError = originalError;
    return error;
  }
  
  static refreshFailed(message: string, retryable = false, originalError?: Error): AuthError {
    const error = new Error(message) as AuthError;
    error.name = 'AuthError';
    error.kind = 'refresh_failed';
    error.retryable = retryable;
    error.originalError = originalError;
    return error;
  }
  
  static rateLimited(message: string, retryable = true, retryAfter?: number): AuthError {
    const error = new Error(message) as AuthError;
    error.name = 'AuthError';
    error.kind = 'rate_limited';
    error.retryable = retryable;
    error.retryAfter = retryAfter;
    return error;
  }
  
  static invalidConfig(message: string): AuthError {
    const error = new Error(message) as AuthError;
    error.name = 'AuthError';
    error.kind = 'invalid_config';
    error.retryable = false;
    return error;
  }
  
  static scopeInsufficient(required: string[], available: string[]): AuthError {
    const message = `Required scopes [${required.join(', ')}] not available in [${available.join(', ')}]`;
    const error = new Error(message) as AuthError;
    error.name = 'AuthError';
    error.kind = 'scope_insufficient';
    error.retryable = false;
    return error;
  }
}
```

**Testing Instructions**:
Create `tests/errors.test.ts`:

```ts
import { AuthErrors } from '../src/errors';

describe('AuthErrors', () => {
  it('should create auth failed error', () => {
    const error = AuthErrors.authFailed('Authentication failed');
    expect(error.kind).toBe('auth_failed');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('Authentication failed');
  });

  it('should create rate limited error with retry after', () => {
    const error = AuthErrors.rateLimited('Rate limited', true, 60);
    expect(error.kind).toBe('rate_limited');
    expect(error.retryable).toBe(true);
    expect(error.retryAfter).toBe(60);
  });

  it('should create scope insufficient error', () => {
    const error = AuthErrors.scopeInsufficient(['submit'], ['read']);
    expect(error.kind).toBe('scope_insufficient');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('submit');
    expect(error.message).toContain('read');
  });
});
```

**Acceptance Criteria**:
- [ ] All error types work correctly
- [ ] Error messages are descriptive
- [ ] Tests pass
- [ ] Error inheritance works properly

### Task 1.4: Implement Configuration Validation with Zod (4 hours)

**Objective**: Create Zod schemas for validating all configuration types.

**Create `src/validation/index.ts`**:

```ts
import { z } from 'zod';
import { ValidationResult } from '../types';

const AppOnlyConfigSchema = z.object({
  kind: z.literal("app"),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
  userAgent: z.string().min(1, "User agent is required"),
  scope: z.array(z.string()).optional(),
});

const UserTokensConfigSchema = z.object({
  kind: z.literal("userTokens"),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
  userAgent: z.string().min(1, "User agent is required"),
  accessToken: z.string().min(1, "Access token is required"),
  refreshToken: z.string().min(1, "Refresh token is required"),
  scope: z.array(z.string()).min(1, "At least one scope is required"),
  usernameHint: z.string().optional(),
});

const PasswordGrantConfigSchema = z.object({
  kind: z.literal("password"),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
  userAgent: z.string().min(1, "User agent is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  scope: z.array(z.string()).optional(),
});

const CredentialConfigSchema = z.discriminatedUnion("kind", [
  AppOnlyConfigSchema,
  UserTokensConfigSchema,
  PasswordGrantConfigSchema,
]);

const RateLimitRuleSchema = z.object({
  max: z.number().positive("Max must be positive"),
  windowMs: z.number().positive("Window must be positive"),
  per: z.enum(['user', 'app']),
});

const RateLimitRulesSchema = z.object({
  global: RateLimitRuleSchema,
  endpoints: z.record(z.string(), RateLimitRuleSchema).optional(),
});

const RedditClientConfigSchema = z.object({
  credentials: CredentialConfigSchema,
  storage: z.any(), // Can't validate Keyv instance with Zod
  logger: z.any(),  // Can't validate Pino logger with Zod
  axios: z.any().optional(),
  rateLimiter: z.object({
    strategy: z.enum(['throw', 'wait']),
    rules: RateLimitRulesSchema,
  }).optional(),
});

export class CredentialConfigValidator {
  static validate(config: unknown): ValidationResult {
    const result = CredentialConfigSchema.safeParse(config);
    
    if (result.success) {
      return { valid: true };
    }
    
    return {
      valid: false,
      errors: result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
    };
  }

  static validateClientConfig(config: unknown): ValidationResult {
    const result = RedditClientConfigSchema.safeParse(config);
    
    if (result.success) {
      return { valid: true };
    }
    
    return {
      valid: false,
      errors: result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
    };
  }
}
```

**Testing Instructions**:
Create `tests/validation.test.ts`:

```ts
import { CredentialConfigValidator } from '../src/validation';

describe('CredentialConfigValidator', () => {
  it('should validate app-only config', () => {
    const config = {
      kind: "app",
      clientId: "test-client",
      clientSecret: "test-secret",
      userAgent: "test-app/1.0"
    };
    
    const result = CredentialConfigValidator.validate(config);
    expect(result.valid).toBe(true);
  });

  it('should reject invalid config', () => {
    const config = {
      kind: "app",
      clientId: "", // Invalid: empty string
      clientSecret: "test-secret",
      userAgent: "test-app/1.0"
    };
    
    const result = CredentialConfigValidator.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('clientId: Client ID is required');
  });

  it('should validate user tokens config', () => {
    const config = {
      kind: "userTokens",
      clientId: "test-client",
      clientSecret: "test-secret",
      userAgent: "test-app/1.0",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      scope: ["read", "submit"]
    };
    
    const result = CredentialConfigValidator.validate(config);
    expect(result.valid).toBe(true);
  });
});
```

**Acceptance Criteria**:
- [ ] All configuration schemas validate correctly
- [ ] Error messages are helpful and specific
- [ ] Discriminated union validation works
- [ ] Tests cover all validation scenarios

### Task 1.5: Implement Utility Functions (2 hours)

**Objective**: Create helper functions needed by the authentication system.

**Create `src/utils/index.ts`**:

```ts
import * as crypto from 'crypto';

/**
 * Creates a short, stable hash from input string
 * Used for creating deterministic cache keys from secrets
 */
export function shortHash(input: string): string {
  const data = Buffer.from(input, "utf8");
  return crypto
    .createHash("sha256")
    .update(data)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Generates a random string for OAuth state parameters
 */
export function randomString(length = 16): string {
  return crypto
    .randomBytes(length)
    .toString('hex');
}

/**
 * Checks if a token is expiring soon (within buffer time)
 */
export function isTokenExpiringSoon(token: { received_at: number; expires_in: number }, bufferMs = 60_000): boolean {
  const now = Date.now();
  const expiresAt = token.received_at + (token.expires_in * 1000);
  const timeUntilExpiry = expiresAt - now;
  return timeUntilExpiry < bufferMs;
}

/**
 * Calculates TTL for token storage (expires_in minus safety buffer)
 */
export function calculateTokenTTL(expiresIn: number, bufferMs = 60_000): number {
  return Math.max(0, (expiresIn * 1000) - bufferMs);
}

/**
 * Extracts endpoint from URL for rate limiting
 */
export function extractEndpoint(url: string): string | undefined {
  const match = url.match(/\/api\/(\w+)/);
  return match ? `/api/${match[1]}` : undefined;
}

/**
 * Validates token structure
 */
export function isValidTokenStructure(token: any): boolean {
  return !!(
    token?.access_token &&
    token?.token_type === 'bearer' &&
    typeof token?.expires_in === 'number' &&
    token?.received_at &&
    typeof token?.scope === 'string'
  );
}
```

**Testing Instructions**:
Create `tests/utils.test.ts`:

```ts
import { shortHash, randomString, isTokenExpiringSoon, calculateTokenTTL, extractEndpoint, isValidTokenStructure } from '../src/utils';

describe('Utils', () => {
  it('should create consistent short hashes', () => {
    const input = "test-string";
    const hash1 = shortHash(input);
    const hash2 = shortHash(input);
    
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(12);
    expect(hash1).toMatch(/^[a-f0-9]{12}$/);
  });

  it('should generate random strings', () => {
    const str1 = randomString();
    const str2 = randomString();
    
    expect(str1).not.toBe(str2);
    expect(str1).toHaveLength(32); // 16 bytes = 32 hex chars
  });

  it('should detect expiring tokens', () => {
    const now = Date.now();
    const expiringToken = {
      received_at: now,
      expires_in: 30 // 30 seconds, less than 60s buffer
    };
    const validToken = {
      received_at: now,
      expires_in: 3600 // 1 hour
    };
    
    expect(isTokenExpiringSoon(expiringToken)).toBe(true);
    expect(isTokenExpiringSoon(validToken)).toBe(false);
  });

  it('should calculate token TTL', () => {
    const expiresIn = 3600; // 1 hour
    const ttl = calculateTokenTTL(expiresIn);
    
    expect(ttl).toBe(3600 * 1000 - 60_000); // 1 hour minus 1 minute
  });

  it('should extract endpoints from URLs', () => {
    expect(extractEndpoint('/api/submit')).toBe('/api/submit');
    expect(extractEndpoint('/r/javascript/about')).toBeUndefined();
    expect(extractEndpoint('/api/vote')).toBe('/api/vote');
  });

  it('should validate token structure', () => {
    const validToken = {
      access_token: "token",
      token_type: "bearer",
      expires_in: 3600,
      received_at: Date.now(),
      scope: "read submit"
    };
    const invalidToken = {
      access_token: "token",
      // missing required fields
    };
    
    expect(isValidTokenStructure(validToken)).toBe(true);
    expect(isValidTokenStructure(invalidToken)).toBe(false);
  });
});
```

**Acceptance Criteria**:
- [ ] All utility functions work correctly
- [ ] Hash function produces consistent results
- [ ] Token expiry logic is accurate
- [ ] Tests cover all utility functions

### Task 1.6: Implement CredentialManager (6 hours)

**Objective**: Create the credential management system with secure token storage.

**Create `src/storage/CredentialManager.ts`**:

```ts
import Keyv from 'keyv';
import * as pino from 'pino';
import axios from 'axios';
import { CredentialManager, StoredToken, CredentialConfig } from '../types';
import { shortHash, calculateTokenTTL, isValidTokenStructure } from '../utils';

export class DefaultCredentialManager implements CredentialManager {
  constructor(
    protected store: Keyv<StoredToken>,
    protected logger: pino.Logger
  ) {}

  buildKey(cfg: CredentialConfig): string {
    switch (cfg.kind) {
      case "app": 
        return `reddit:token:app:${cfg.clientId}`;
      case "userTokens": {
        const id = cfg.usernameHint ?? shortHash(cfg.refreshToken);
        return `reddit:token:user:${cfg.clientId}:${id}`;
      }
      case "password": 
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
      this.logger.error({ error: error.message, key }, 'Failed to retrieve token');
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
      
      this.logger.debug({ 
        key, 
        ttl, 
        expires_in: token.expires_in,
        scope: token.scope 
      }, 'Storing token');

      await this.store.set(key, token, ttl);
    } catch (error) {
      this.logger.error({ error: error.message, key }, 'Failed to store token');
      throw error;
    }
  }

  async clear(key: string): Promise<void> {
    try {
      await this.store.delete(key);
      this.logger.debug({ key }, 'Cleared token');
    } catch (error) {
      this.logger.error({ error: error.message, key }, 'Failed to clear token');
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
          'Authorization': `Bearer ${token.access_token}`,
          'User-Agent': 'reddit-api-client-token-validator/1.0'
        },
        timeout: 5000
      });
      
      const isValid = response.status === 200;
      this.logger.debug({ isValid, credentialType }, 'Token API validation result');
      return isValid;
    } catch (error) {
      this.logger.debug({ error: error.message, credentialType }, 'Token validation API call failed');
      return false;
    }
  }
}
```

**Testing Instructions**:
Create `tests/CredentialManager.test.ts`:

```ts
import Keyv from 'keyv';
import pino from 'pino';
import axios from 'axios';
import { DefaultCredentialManager } from '../src/storage/CredentialManager';
import { StoredToken, CredentialConfig } from '../src/types';

// Mock axios for token validation
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DefaultCredentialManager', () => {
  let store: Keyv<StoredToken>;
  let logger: pino.Logger;
  let credentialManager: DefaultCredentialManager;

  beforeEach(() => {
    store = new Keyv();
    logger = pino({ level: 'silent' }); // Silent for tests
    credentialManager = new DefaultCredentialManager(store, logger);
  });

  describe('buildKey', () => {
    it('should build app key correctly', () => {
      const config: CredentialConfig = {
        kind: 'app',
        clientId: 'test-client',
        clientSecret: 'secret',
        userAgent: 'test/1.0'
      };
      
      const key = credentialManager.buildKey(config);
      expect(key).toBe('reddit:token:app:test-client');
    });

    it('should build user key with username hint', () => {
      const config: CredentialConfig = {
        kind: 'userTokens',
        clientId: 'test-client',
        clientSecret: 'secret',
        userAgent: 'test/1.0',
        accessToken: 'access',
        refreshToken: 'refresh',
        scope: ['read'],
        usernameHint: 'testuser'
      };
      
      const key = credentialManager.buildKey(config);
      expect(key).toBe('reddit:token:user:test-client:testuser');
    });

    it('should build user key with refresh token hash when no username hint', () => {
      const config: CredentialConfig = {
        kind: 'userTokens',
        clientId: 'test-client',
        clientSecret: 'secret',
        userAgent: 'test/1.0',
        accessToken: 'access',
        refreshToken: 'refresh-token-123',
        scope: ['read']
      };
      
      const key = credentialManager.buildKey(config);
      expect(key).toMatch(/^reddit:token:user:test-client:[a-f0-9]{12}$/);
    });
  });

  describe('get/set/clear', () => {
    const validToken: StoredToken = {
      access_token: 'test-token',
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'read submit',
      received_at: Date.now()
    };

    beforeEach(() => {
      // Mock successful token validation
      mockedAxios.get.mockResolvedValue({ status: 200, data: {} });
    });

    it('should store and retrieve token', async () => {
      const key = 'test-key';
      
      await credentialManager.set(key, validToken);
      const retrieved = await credentialManager.get(key);
      
      expect(retrieved).toEqual(validToken);
    });

    it('should return null for non-existent token', async () => {
      const retrieved = await credentialManager.get('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should clear token', async () => {
      const key = 'test-key';
      
      await credentialManager.set(key, validToken);
      await credentialManager.clear(key);
      const retrieved = await credentialManager.get(key);
      
      expect(retrieved).toBeNull();
    });

    it('should clear invalid token automatically', async () => {
      const key = 'test-key';
      
      // Mock failed token validation
      mockedAxios.get.mockRejectedValue(new Error('Unauthorized'));
      
      await credentialManager.set(key, validToken);
      const retrieved = await credentialManager.get(key);
      
      expect(retrieved).toBeNull();
    });
  });

  describe('validateToken', () => {
    it('should validate correct token structure', async () => {
      const validToken: StoredToken = {
        access_token: 'test-token',
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'read',
        received_at: Date.now()
      };

      mockedAxios.get.mockResolvedValue({ status: 200, data: {} });
      
      const isValid = await credentialManager.validateToken(validToken);
      expect(isValid).toBe(true);
    });

    it('should reject invalid token structure', async () => {
      const invalidToken = {
        access_token: 'test-token',
        // Missing required fields
      } as StoredToken;
      
      const isValid = await credentialManager.validateToken(invalidToken);
      expect(isValid).toBe(false);
    });

    it('should reject token that fails API validation', async () => {
      const validToken: StoredToken = {
        access_token: 'test-token',
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'read',
        received_at: Date.now()
      };

      mockedAxios.get.mockRejectedValue(new Error('Unauthorized'));
      
      const isValid = await credentialManager.validateToken(validToken);
      expect(isValid).toBe(false);
    });
  });
});
```

**Acceptance Criteria**:
- [ ] CredentialManager builds correct cache keys
- [ ] Token storage and retrieval works
- [ ] Token validation (structure + API) works
- [ ] TTL is calculated correctly
- [ ] Invalid tokens are automatically cleared
- [ ] All tests pass

### Task 1.7: Implement AuthProvider Foundation (8 hours)

**Objective**: Create the authentication provider that manages OAuth flows and token refresh.

**Create `src/auth/AuthProvider.ts`**:

```ts
import * as pino from 'pino';
import axios from 'axios';
import { AuthProvider, CredentialConfig, StoredToken, CredentialManager } from '../types';
import { AuthErrors } from '../errors';
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

  async checkScopes(required: string[]): Promise<boolean> {
    try {
      const token = await this.ensureValidToken();
      if (!token?.scope) {
        this.logger.warn('Token has no scope information');
        return false;
      }
      
      const available = token.scope.split(' ');
      const missing = required.filter(scope => !available.includes(scope));
      
      if (missing.length > 0) {
        this.logger.warn({ required, available, missing }, 'Scope check failed');
        throw AuthErrors.scopeInsufficient(required, available);
      }
      
      return true;
    } catch (error) {
      if (error.kind === 'scope_insufficient') {
        throw error;
      }
      this.logger.error({ error: error.message }, 'Scope check failed');
      return false;
    }
  }

  protected async refreshToken(): Promise<StoredToken> {
    const key = this.cm.buildKey(this.cfg);
    
    try {
      let token: StoredToken;
      
      switch (this.cfg.kind) {
        case "app":
          token = await this.fetchAppToken();
          break;
        case "userTokens":
          token = await this.refreshUserToken();
          break;
        case "password":
          token = await this.fetchPasswordToken();
          break;
        default:
          throw AuthErrors.invalidConfig(`Unsupported credential type: ${(this.cfg as any).kind}`);
      }

      // Store the new token
      await this.cm.set(key, token);
      this.logger.info({ key, scope: token.scope }, 'Token refreshed successfully');
      
      return token;
    } catch (error) {
      this.logger.error({ error: error.message, key }, 'Token refresh failed');
      
      if (error.kind) {
        throw error; // Re-throw AuthErrors
      }
      
      throw AuthErrors.refreshFailed(`Token refresh failed: ${error.message}`, false, error);
    }
  }

  protected async fetchAppToken(): Promise<StoredToken> {
    const appConfig = this.cfg as any; // We know it's app config from switch
    
    try {
      const response = await axios.post('https://www.reddit.com/api/v1/access_token', 
        new URLSearchParams({
          grant_type: 'client_credentials',
          scope: (appConfig.scope || ['read']).join(' ')
        }), {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${appConfig.clientId}:${appConfig.clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': appConfig.userAgent
          }
        }
      );

      const tokenData = response.data;
      return {
        access_token: tokenData.access_token,
        token_type: tokenData.token_type,
        expires_in: tokenData.expires_in,
        scope: tokenData.scope,
        received_at: Date.now()
      };
    } catch (error) {
      this.logger.error({ error: error.message }, 'App token fetch failed');
      throw AuthErrors.authFailed(`Failed to fetch app token: ${error.message}`, true, error);
    }
  }

  protected async refreshUserToken(): Promise<StoredToken> {
    const userConfig = this.cfg as any; // We know it's user config from switch
    
    try {
      const response = await axios.post('https://www.reddit.com/api/v1/access_token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: userConfig.refreshToken
        }), {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${userConfig.clientId}:${userConfig.clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': userConfig.userAgent
          }
        }
      );

      const tokenData = response.data;
      return {
        access_token: tokenData.access_token,
        token_type: tokenData.token_type,
        expires_in: tokenData.expires_in,
        scope: tokenData.scope || userConfig.scope.join(' '), // Fallback to original scope
        received_at: Date.now(),
        refresh_token: tokenData.refresh_token || userConfig.refreshToken // Keep original if not provided
      };
    } catch (error) {
      this.logger.error({ error: error.message }, 'User token refresh failed');
      throw AuthErrors.refreshFailed(`Failed to refresh user token: ${error.message}`, false, error);
    }
  }

  protected async fetchPasswordToken(): Promise<StoredToken> {
    const pwdConfig = this.cfg as any; // We know it's password config from switch
    
    try {
      const response = await axios.post('https://www.reddit.com/api/v1/access_token',
        new URLSearchParams({
          grant_type: 'password',
          username: pwdConfig.username,
          password: pwdConfig.password,
          scope: (pwdConfig.scope || ['read']).join(' ')
        }), {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${pwdConfig.clientId}:${pwdConfig.clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': pwdConfig.userAgent
          }
        }
      );

      const tokenData = response.data;
      return {
        access_token: tokenData.access_token,
        token_type: tokenData.token_type,
        expires_in: tokenData.expires_in,
        scope: tokenData.scope,
        received_at: Date.now(),
        refresh_token: tokenData.refresh_token
      };
    } catch (error) {
      this.logger.error({ error: error.message }, 'Password token fetch failed');
      throw AuthErrors.authFailed(`Failed to fetch password token: ${error.message}`, true, error);
    }
  }
}
```

**Testing Instructions**:
Create `tests/AuthProvider.test.ts`:

```ts
import pino from 'pino';
import axios from 'axios';
import { DefaultAuthProvider } from '../src/auth/AuthProvider';
import { DefaultCredentialManager } from '../src/storage/CredentialManager';
import { CredentialConfig, StoredToken } from '../src/types';
import { AuthErrors } from '../src/errors';

// Mock dependencies
jest.mock('axios');
jest.mock('../src/storage/CredentialManager');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const MockedCredentialManager = DefaultCredentialManager as jest.MockedClass<typeof DefaultCredentialManager>;

describe('DefaultAuthProvider', () => {
  let mockCredentialManager: jest.Mocked<DefaultCredentialManager>;
  let logger: pino.Logger;
  let authProvider: DefaultAuthProvider;

  const appConfig: CredentialConfig = {
    kind: 'app',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    userAgent: 'test-app/1.0'
  };

  beforeEach(() => {
    mockCredentialManager = new MockedCredentialManager() as jest.Mocked<DefaultCredentialManager>;
    logger = pino({ level: 'silent' });
    authProvider = new DefaultAuthProvider(appConfig, mockCredentialManager, logger);
    
    jest.clearAllMocks();
  });

  describe('ensureValidToken', () => {
    const validToken: StoredToken = {
      access_token: 'test-token',
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'read',
      received_at: Date.now()
    };

    it('should return existing valid token', async () => {
      mockCredentialManager.buildKey.mockReturnValue('test-key');
      mockCredentialManager.get.mockResolvedValue(validToken);

      const token = await authProvider.ensureValidToken();
      
      expect(token).toBe(validToken);
      expect(mockCredentialManager.get).toHaveBeenCalledWith('test-key');
    });

    it('should refresh expired token', async () => {
      const expiredToken: StoredToken = {
        ...validToken,
        received_at: Date.now() - 3600000, // 1 hour ago
        expires_in: 3600 // 1 hour, so it's expired
      };

      mockCredentialManager.buildKey.mockReturnValue('test-key');
      mockCredentialManager.get.mockResolvedValue(expiredToken);
      mockCredentialManager.set.mockResolvedValue();

      // Mock successful token fetch
      mockedAxios.post.mockResolvedValue({
        data: {
          access_token: 'new-token',
          token_type: 'bearer',
          expires_in: 3600,
          scope: 'read'
        }
      });

      const token = await authProvider.ensureValidToken();
      
      expect(token.access_token).toBe('new-token');
      expect(mockCredentialManager.set).toHaveBeenCalled();
    });

    it('should handle concurrent refresh requests', async () => {
      mockCredentialManager.buildKey.mockReturnValue('test-key');
      mockCredentialManager.get.mockResolvedValue(null); // No token
      mockCredentialManager.set.mockResolvedValue();

      // Mock slow token fetch
      mockedAxios.post.mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            data: {
              access_token: 'new-token',
              token_type: 'bearer',
              expires_in: 3600,
              scope: 'read'
            }
          }), 100)
        )
      );

      // Start two concurrent requests
      const promise1 = authProvider.ensureValidToken();
      const promise2 = authProvider.ensureValidToken();

      const [token1, token2] = await Promise.all([promise1, promise2]);
      
      expect(token1).toBe(token2);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1); // Only one actual refresh
    });
  });

  describe('checkScopes', () => {
    it('should pass when token has required scopes', async () => {
      const tokenWithScopes: StoredToken = {
        access_token: 'test-token',
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'read submit vote',
        received_at: Date.now()
      };

      mockCredentialManager.buildKey.mockReturnValue('test-key');
      mockCredentialManager.get.mockResolvedValue(tokenWithScopes);

      const hasScopes = await authProvider.checkScopes(['read', 'submit']);
      expect(hasScopes).toBe(true);
    });

    it('should throw when token lacks required scopes', async () => {
      const tokenWithLimitedScopes: StoredToken = {
        access_token: 'test-token',
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'read',
        received_at: Date.now()
      };

      mockCredentialManager.buildKey.mockReturnValue('test-key');
      mockCredentialManager.get.mockResolvedValue(tokenWithLimitedScopes);

      await expect(authProvider.checkScopes(['read', 'submit']))
        .rejects.toMatchObject({
          kind: 'scope_insufficient'
        });
    });
  });

  describe('fetchAppToken', () => {
    it('should fetch app token successfully', async () => {
      mockCredentialManager.buildKey.mockReturnValue('test-key');
      mockCredentialManager.set.mockResolvedValue();

      mockedAxios.post.mockResolvedValue({
        data: {
          access_token: 'app-token',
          token_type: 'bearer',
          expires_in: 3600,
          scope: 'read'
        }
      });

      const token = await authProvider.ensureValidToken();
      
      expect(token.access_token).toBe('app-token');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://www.reddit.com/api/v1/access_token',
        expect.any(URLSearchParams),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Basic'),
            'User-Agent': 'test-app/1.0'
          })
        })
      );
    });
  });
});
```

**Acceptance Criteria**:
- [ ] AuthProvider can ensure valid tokens
- [ ] Token refresh works for all credential types
- [ ] Concurrent refresh protection works
- [ ] Scope validation works correctly
- [ ] OAuth flows are implemented correctly
- [ ] All tests pass

## Phase 1 Completion Checklist

**Before moving to Phase 2, ensure:**

- [ ] All TypeScript compiles without errors
- [ ] All tests pass (`npm test`)
- [ ] Configuration validation works with Zod
- [ ] Token storage and retrieval works
- [ ] Token validation (structure + API) works
- [ ] OAuth flows work for all credential types
- [ ] Error handling provides clear messages
- [ ] Multi-user cache keys prevent conflicts
- [ ] Code follows TypeScript best practices
- [ ] Documentation is clear and complete

**Deliverables:**
1. Working `CredentialManager` class
2. Working `AuthProvider` class  
3. Complete configuration validation
4. Comprehensive error system
5. Full test suite
6. Documentation and examples

**Time Estimate**: 27 hours total
**Difficulty**: Intermediate
**Dependencies**: None (this is the foundation)

Once Phase 1 is complete, you'll have a solid authentication foundation that Phase 2 can build upon for rate limiting functionality.
