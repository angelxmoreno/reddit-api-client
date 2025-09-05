# Reddit API Client - Authentication Infrastructure Specification

## Project Context

We're building a **comprehensive Reddit API client** for Node.js that provides developers with a complete toolkit for Reddit integrations. This document specifies the **authentication infrastructure** - the foundational layer that handles OAuth flows, token management, and API access control.

### The Complete Reddit Client Vision

**Full Reddit API Client** (what we're building overall):
- **Authentication Infrastructure** ← *This document*
- **Core API Methods** (subreddits, posts, comments, users, etc.)
- **Convenience Features** (pagination, response parsing, rate limiting)
- **Advanced Utilities** (bulk operations, streaming, webhooks)

### Core Design Principles

Our authentication infrastructure follows these **agreed-upon principles**:

- **Separation of concerns**: Auth, credentials, and rate-limit handling are independent modules
- **Safety by design**: Multi-user safe keys, TTL storage, refresh 60s before expiry
- **Flexibility**: Caller chooses axios instance, Keyv backend, and rate-limit strategy
- **Maintainability**: Clear discriminated unions for configs, clean TypeScript interfaces
- **Extensibility**: Rate limit rules are externalized and configurable

### This Document's Scope

This specification covers **only the authentication infrastructure** - the critical foundation that everything else builds upon. Before we can implement Reddit API methods like `client.getSubreddit()` or `client.createPost()`, we need bulletproof OAuth handling.

**What This Auth Module Provides:**
- Automatic OAuth token acquisition and refresh
- Multi-user authentication support
- Rate limiting and API quota management  
- Secure token storage and validation
- Production-ready error handling

**What Depends On This Module:**
- All Reddit API method implementations
- Rate limiting across the entire client
- User session management
- Error handling and retry logic

---

## Technical Architecture

Our authentication infrastructure centers around an **internal HTTP client** that encapsulates all auth and rate limiting logic. Reddit API modules (SubredditAPI, UserAPI, etc.) use this internal client instead of raw axios.

### Core Architecture Overview

```ts
// Main Reddit API Client
class RedditApiClient {
  protected httpClient: RedditHttpClient; // Internal client with auth + rate limiting
  
  constructor(config: RedditClientConfig) {
    // Set up auth infrastructure
    this.httpClient = new RedditHttpClient(config);
    
    // Pass internal client to API modules
    this.subreddits = new SubredditAPI(this.httpClient);
    this.users = new RedditUserAPI(this.httpClient);
    this.posts = new PostAPI(this.httpClient);
  }
}

// Internal HTTP client (the core of this specification)
class RedditHttpClient {
  constructor(
    protected authProvider: AuthProvider,
    protected rateLimiter: RateLimiter,
    protected axios: AxiosInstance,
    protected logger: Logger
  ) {}

  async get(url: string, options?: RequestOptions) {
    const token = await this.authProvider.ensureValidToken();
    
    return this.rateLimiter.schedule(this.getRequestKey(), () => 
      this.axios.get(url, {
        ...options,
        headers: { 
          Authorization: `Bearer ${token.access_token}`,
          'User-Agent': this.authProvider.getUserAgent(),
          ...options?.headers 
        }
      })
    );
  }
  
  // post, put, delete follow same pattern
}

// Reddit API modules use the internal client
class SubredditAPI {
  constructor(protected client: RedditHttpClient) {}

  async getSubreddit(name: string) {
    // Auth and rate limiting handled automatically by internal client
    return this.client.get(`/r/${name}/about`);
  }
  
  async getHotPosts(subreddit: string) {
    return this.client.get(`/r/${subreddit}/hot`);
  }
}
```

### Core Authentication Components

**`CredentialConfig`** - Defines what authentication credentials are available
- App-only access (client ID + secret)
- User tokens (access + refresh tokens)  
- Username/password (legacy support)

**`CredentialManager`** - Handles secure token storage and lifecycle
- Token caching with automatic TTL management
- Multi-user safe cache key generation
- Token validation against Reddit's API
- Cleanup of expired credentials

**`AuthProvider`** - Orchestrates authentication for API requests
- Token acquisition and refresh logic
- Scope validation and error handling
- Provides tokens to internal HTTP client
- Manages concurrent refresh attempts safely

**`RateLimiter`** - Ensures Reddit API compliance
- **Token bucket per identity**: Separate rate limiting for each user/app combination
- **Reddit header integration**: Uses `x-ratelimit-*` headers to track real quota
- **Configurable strategy**:
  - `throw`: Immediate error when rate-limited
  - `wait`: Enqueue and delay until quota available
- **Cross-run enforcement**: Optional TTL-backed state persistence via Keyv
- **Global + endpoint rules**: Different limits for different API endpoints

**`RedditHttpClient`** - Internal client that coordinates everything
- Calls AuthProvider for valid tokens
- Calls RateLimiter to schedule requests
- Attaches all required headers
- Provides clean get/post/put/delete interface

### Request Flow Architecture

Every Reddit API request follows this coordinated flow through the internal client:

1. **API Method Call**: `reddit.subreddits.getSubreddit('javascript')`
2. **Internal Client**: `this.client.get('/r/javascript/about')`
3. **Auth Provider**: Ensure valid token (refresh if needed)
4. **Rate Limiter**: Schedule request based on current quota
5. **HTTP Request**: Execute with auth headers attached
6. **Response Processing**: Update rate limits, handle errors
7. **Return Result**: Clean response back to caller

This flow is completely transparent to Reddit API method implementations.

---

## Implementation Specification

### Configuration System

The auth infrastructure accepts comprehensive configuration:

```ts
interface RedditClientConfig {
  credentials: CredentialConfig;
  storage: Keyv<StoredToken>;      // Token storage backend
  logger: pino.Logger;             // Structured logging
  axios?: AxiosInstance;           // Optional pre-configured HTTP client
  rateLimiter?: {
    strategy: 'throw' | 'wait';
    rules: RateLimitRules;
  };
}
```

### Credential Types

**App-Only Authentication** (for read-only or app-specific operations)
```ts
{
  kind: "app",
  clientId: string,
  clientSecret: string,
  userAgent: string,
  scope?: string[]
}
```

**User Token Authentication** (for user-specific operations)
```ts
{
  kind: "userTokens",
  clientId: string,
  clientSecret: string,
  userAgent: string,
  accessToken: string,
  refreshToken: string,
  scope: string[],              // Cannot be expanded during refresh
  usernameHint?: string         // For cache isolation
}
```

**Password Grant** (legacy support for personal scripts)
```ts
{
  kind: "password",
  clientId: string,
  clientSecret: string,
  userAgent: string,
  username: string,
  password: string,
  scope?: string[]
}
```

### Input Validation

Using Zod schemas for runtime validation of configuration:

```ts
import { z } from 'zod';

const AppOnlyConfigSchema = z.object({
  kind: z.literal("app"),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  userAgent: z.string().min(1),
  scope: z.array(z.string()).optional(),
});

const UserTokensConfigSchema = z.object({
  kind: z.literal("userTokens"),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  userAgent: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  scope: z.array(z.string()).min(1), // REQUIRED
  usernameHint: z.string().optional(),
});

const PasswordGrantConfigSchema = z.object({
  kind: z.literal("password"),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  userAgent: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  scope: z.array(z.string()).optional(),
});

const CredentialConfigSchema = z.discriminatedUnion("kind", [
  AppOnlyConfigSchema,
  UserTokensConfigSchema,
  PasswordGrantConfigSchema,
]);

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
}
```

### Storage and Caching Strategy

**Token Storage Schema**
- Keys: `reddit:token:{type}:{clientId}:{userIdentifier}`
- TTL: `expires_in - 60 seconds` for proactive refresh
- Validation: Structure verification + live API confirmation

**Rate Limit Storage Schema**
- Keys: `reddit:ratelimit:{type}:{clientId}:{userIdentifier}:{endpoint?}`
- Persistent state across application restarts
- Real-time updates from Reddit response headers

**Multi-User Isolation**
```ts
// Each Reddit client instance gets isolated storage
const clientA = new RedditApiClient({
  credentials: { /* user A credentials */ },
  storage: new Keyv({ namespace: "myapp-user-a" })
});

const clientB = new RedditApiClient({
  credentials: { /* user B credentials */ },
  storage: new Keyv({ namespace: "myapp-user-b" })
});
// No token conflicts between users
```

### Error Handling Framework

Structured errors that the Reddit client can handle appropriately:

```ts
interface AuthError extends Error {
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
  static authFailed(message: string, retryable = false): AuthError {
    return { name: 'AuthError', kind: 'auth_failed', message, retryable };
  }
  
  static rateLimited(message: string, retryable = true, retryAfter?: number): AuthError {
    return { name: 'AuthError', kind: 'rate_limited', message, retryable, retryAfter };
  }
  
  static scopeInsufficient(required: string[], available: string[]): AuthError {
    return { 
      name: 'AuthError', 
      kind: 'scope_insufficient', 
      message: `Required scopes [${required.join(', ')}] not available in [${available.join(', ')}]`,
      retryable: false 
    };
  }
}
```

---

## Core Implementation Classes

### CredentialManager

```ts
interface StoredToken {
  access_token: string;
  token_type: "bearer";
  expires_in: number; // seconds
  scope: string;      // space-separated scopes actually granted
  received_at: number; // ms epoch
  refresh_token?: string;
}

export class DefaultCredentialManager implements CredentialManager {
  constructor(
    protected store: Keyv<StoredToken>,
    protected logger: pino.Logger
  ) {}

  buildKey(cfg: CredentialConfig): string {
    switch (cfg.kind) {
      case "app": return `reddit:token:app:${cfg.clientId}`;
      case "userTokens": {
        const id = cfg.usernameHint ?? shortHash(cfg.refreshToken);
        return `reddit:token:user:${cfg.clientId}:${id}`;
      }
      case "password": return `reddit:token:pwd:${cfg.clientId}:${cfg.username}`;
    }
  }

  async get(key: string): Promise<StoredToken | null> {
    try {
      const token = await this.store.get(key);
      if (token && !(await this.validateToken(token))) {
        this.logger.warn({ key }, 'Found invalid token, clearing');
        await this.clear(key);
        return null;
      }
      return token ?? null;
    } catch (error) {
      this.logger.error({ error, key }, 'Failed to retrieve token');
      return null;
    }
  }

  async set(key: string, token: StoredToken): Promise<void> {
    // TTL = expires_in minus 60 second safety buffer
    const ttl = Math.max(0, (token.expires_in * 1000) - 60_000);
    this.logger.debug({ key, ttl, expires_in: token.expires_in }, 'Storing token');
    await this.store.set(key, token, ttl);
  }

  async validateToken(token: StoredToken): Promise<boolean> {
    // Structure validation
    const structureValid = !!(
      token?.access_token &&
      token?.token_type === 'bearer' &&
      typeof token?.expires_in === 'number' &&
      token?.received_at &&
      typeof token?.scope === 'string'
    );
    
    if (!structureValid) return false;
    
    // Live API validation - skip for app-only tokens as /api/v1/me requires user tokens
    if (credentialKind === 'app') {
      this.logger.debug('Skipping live API validation for app-only token');
      return true; // Rely on structure + TTL validation only
    }
    
    try {
      const response = await axios.get('https://oauth.reddit.com/api/v1/me', {
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'User-Agent': 'token-validator/1.0'
        },
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      this.logger.debug({ error: error.message }, 'Token validation API call failed');
      return false;
    }
  }
}
```

### AuthProvider

```ts
export class DefaultAuthProvider implements AuthProvider {
  protected refreshPromise?: Promise<StoredToken>; // Prevent concurrent refresh

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

    if (!token || this.isExpiringSoon(token)) {
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

  async checkScopes(required: string[]): Promise<boolean> {
    const token = await this.ensureValidToken();
    if (!token?.scope) return false;
    
    const available = token.scope.split(' ');
    const missing = required.filter(scope => !available.includes(scope));
    
    if (missing.length > 0) {
      this.logger.warn({ required, available, missing }, 'Scope check failed');
      return false;
    }
    return true;
  }

  protected isExpiringSoon(token: StoredToken): boolean {
    const now = Date.now();
    const expiresAt = token.received_at + (token.expires_in * 1000);
    const timeUntilExpiry = expiresAt - now;
    return timeUntilExpiry < 60_000; // refresh if <60s remaining
  }

  protected async refreshToken(): Promise<StoredToken> {
    switch (this.cfg.kind) {
      case "app":
        return this.fetchAppToken();
      case "userTokens":
        return this.refreshUserToken();
      case "password":
        return this.fetchPasswordToken();
    }
  }
}
```

### RateLimiter

```ts
interface RateLimitState {
  tokens: number;
  lastRefill: number;
  resetAt?: number; // from reddit headers
}

export class DefaultRateLimiter implements RateLimiter {
  protected queues = new Map<string, Array<{task: () => Promise<any>, resolve: (value: any) => void, reject: (error: any) => void}>>();

  constructor(
    protected rules: RateLimitRules,
    protected store: Keyv<RateLimitState>,
    protected logger: pino.Logger
  ) {}

  async schedule<T>(key: string, task: () => Promise<T>, endpoint?: string): Promise<T> {
    const rule = (endpoint && this.rules.endpoints?.[endpoint]) || this.rules.global;
    const rateLimitKey = this.buildRateLimitKey(key, endpoint);
    
    if (this.rules.strategy === 'throw') {
      const state = await this.getRateLimitState(rateLimitKey, rule);
      if (state.tokens <= 0) {
        throw AuthErrors.rateLimited('Rate limit exceeded', true, this.getWaitTimeSeconds(state, rule));
      }
    }
    
    return new Promise((resolve, reject) => {
      if (!this.queues.has(rateLimitKey)) {
        this.queues.set(rateLimitKey, []);
      }
      
      this.queues.get(rateLimitKey)!.push({ task, resolve, reject });
      this.processQueue(rateLimitKey, rule);
    });
  }

  async updateFromHeaders(key: string, headers: Record<string, string | number | undefined>): Promise<void> {
    const remaining = headers['x-ratelimit-remaining'];
    const reset = headers['x-ratelimit-reset'];
    
    const remainingNum = Number(remaining);
    const resetNum = Number(reset);
    if (!Number.isNaN(remainingNum) && !Number.isNaN(resetNum)) {
      const rateLimitKey = this.buildRateLimitKey(key);
      const state: RateLimitState = {
        tokens: remainingNum,
        lastRefill: Date.now(),
        resetAt: Date.now() + resetNum * 1000 // reset is seconds until reset, not epoch
      };
      
      await this.saveRateLimitState(rateLimitKey, state);
      this.logger.debug({ key, remaining, reset }, 'Updated rate limit from headers');
    }
  }
}
```

### RedditHttpClient (Internal Client)

```ts
export class RedditHttpClient {
  constructor(
    protected authProvider: AuthProvider,
    protected rateLimiter: RateLimiter,
    protected axios: AxiosInstance,
    protected logger: pino.Logger
  ) {}

  async get(url: string, options?: RequestOptions) {
    return this.makeRequest('GET', url, undefined, options);
  }

  async post(url: string, data?: any, options?: RequestOptions) {
    return this.makeRequest('POST', url, data, options);
  }

  async put(url: string, data?: any, options?: RequestOptions) {
    return this.makeRequest('PUT', url, data, options);
  }

  async delete(url: string, options?: RequestOptions) {
    return this.makeRequest('DELETE', url, undefined, options);
  }

  protected async makeRequest(method: string, url: string, data?: any, options?: RequestOptions) {
    const token = await this.authProvider.ensureValidToken();
    const key = this.getRequestKey();
    const endpoint = this.extractEndpoint(url);
    
    return this.rateLimiter.schedule(key, async () => {
      const response = await this.axios.request({
        method,
        url,
        data,
        ...options,
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'User-Agent': this.authProvider.getUserAgent(),
          ...options?.headers
        }
      });

      // Update rate limits from response headers
      await this.rateLimiter.updateFromHeaders(key, response.headers);
      
      return response;
    }, endpoint);
  }

  protected getRequestKey(): string {
    // Use the same key as CredentialManager for consistency
    return this.credentialManager.buildKey(this.authProvider.getConfig());
  }

  protected extractEndpoint(url: string): string | undefined {
    // Extract endpoint for rate limiting (e.g., '/api/submit', '/api/comment')
    const match = url.match(/\/api\/(\w+)/);
    return match ? `/api/${match[1]}` : undefined;
  }
}
```

---

## Integration with Reddit Client Features

### Complete Reddit Client Implementation

```ts
export class RedditApiClient {
  protected httpClient: RedditHttpClient;
  public subreddits: SubredditAPI;
  public users: RedditUserAPI;
  public posts: PostAPI;
  public comments: CommentAPI;

  constructor(config: RedditClientConfig) {
    // Validate configuration
    const validation = CredentialConfigValidator.validate(config.credentials);
    if (!validation.valid) {
      throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
    }

    // Set up auth infrastructure
    const credentialManager = new DefaultCredentialManager(config.storage, config.logger);
    const rateLimiter = new DefaultRateLimiter(
      config.rateLimiter?.rules || defaultRules,
      config.storage,
      config.logger
    );
    const authProvider = new DefaultAuthProvider(
      config.credentials,
      credentialManager,
      config.logger
    );

    // Create internal HTTP client
    const axios = config.axios || axios.create({
      baseURL: "https://oauth.reddit.com"
    });

    this.httpClient = new RedditHttpClient(
      authProvider,
      rateLimiter,
      axios,
      config.logger
    );

    // Initialize API modules
    this.subreddits = new SubredditAPI(this.httpClient);
    this.users = new RedditUserAPI(this.httpClient);
    this.posts = new PostAPI(this.httpClient);
    this.comments = new CommentAPI(this.httpClient);
  }
}

// API modules use the internal client
class SubredditAPI {
  constructor(protected client: RedditHttpClient) {}

  async getSubreddit(name: string) {
    const response = await this.client.get(`/r/${name}/about`);
    return response.data;
  }

  async getHotPosts(subreddit: string, options?: PaginationOptions) {
    const response = await this.client.get(`/r/${subreddit}/hot`, {
      params: options
    });
    return response.data;
  }

  async subscribe(subreddit: string) {
    return this.client.post('/api/subscribe', {
      action: 'sub',
      sr_name: subreddit
    });
  }
}

class PostAPI {
  constructor(protected client: RedditHttpClient) {}

  async createPost(data: PostData) {
    // Auth provider ensures 'submit' scope is available
    return this.client.post('/api/submit', data);
  }

  async voteOnPost(id: string, direction: 1 | 0 | -1) {
    return this.client.post('/api/vote', {
      id,
      dir: direction
    });
  }
}
```

### Usage Examples

```ts
import { RedditApiClient } from 'reddit-api-client';
import Keyv from 'keyv';
import pino from 'pino';

// Set up client
const logger = pino({ level: 'info' });
const storage = new Keyv({ namespace: "myapp-production" });

const reddit = new RedditApiClient({
  credentials: {
    kind: "userTokens",
    clientId: process.env.REDDIT_CLIENT_ID!,
    clientSecret: process.env.REDDIT_CLIENT_SECRET!,
    userAgent: "MyApp/1.0 by u/myusername",
    accessToken: process.env.ACCESS_TOKEN!,
    refreshToken: process.env.REFRESH_TOKEN!,
    scope: ["identity", "read", "submit"],
    usernameHint: "myuser"
  },
  storage,
  logger,
  rateLimiter: {
    strategy: "wait",
    rules: {
      global: { max: 60, windowMs: 60_000 },
      endpoints: {
        '/api/submit': { max: 1, windowMs: 600_000 }
      }
    }
  }
});

// Use Reddit client - auth and rate limiting automatic
const subreddit = await reddit.subreddits.getSubreddit('javascript');
const posts = await reddit.subreddits.getHotPosts('javascript');
const newPost = await reddit.posts.createPost({
  title: "Hello from Node.js!",
  text: "This post was created automatically",
  sr: "test"
});

// Multi-user safe
const userBReddit = new RedditApiClient({
  credentials: { /* user B credentials */ },
  storage: new Keyv({ namespace: "myapp-user-b" }),
  logger
});
// No conflicts with user A
```

---

## Implementation Roadmap

### Phase 1: Core Authentication Foundation
**Goal**: Solid OAuth infrastructure for the Reddit client to build upon

1. Implement `CredentialManager` with secure token storage and validation
2. Build `AuthProvider` with OAuth flows and refresh logic
3. Create `RedditHttpClient` internal client with auth coordination
4. Add Zod-based configuration validation
5. Comprehensive error types and handling

**Deliverable**: Working `RedditHttpClient` that handles auth automatically

### Phase 2: Rate Limiting Infrastructure  
**Goal**: Prevent API quota violations across all Reddit client features

1. Implement `RateLimiter` with token bucket algorithm
2. Add persistent rate limit state management
3. Integrate with Reddit response headers for real-time updates
4. Support per-endpoint and per-user rate limiting
5. Configurable strategies (throw vs queue)

**Deliverable**: Rate limiting integrated into `RedditHttpClient`

### Phase 3: Reddit Client Integration
**Goal**: Complete Reddit API client using the auth infrastructure

1. Design and implement API module interfaces (SubredditAPI, UserAPI, etc.)
2. Build comprehensive Reddit API method coverage
3. Add pagination, response parsing, and convenience features
4. Performance optimization for high-throughput scenarios
5. Comprehensive testing with real Reddit API usage

**Deliverable**: Full-featured Reddit API client

### Phase 4: Production Readiness
**Goal**: Enterprise-grade reliability and developer experience

1. Advanced error handling and recovery mechanisms
2. Comprehensive logging and monitoring hooks
3. Performance testing and optimization
4. Complete documentation and examples
5. npm package publishing and maintenance

**Deliverable**: Production-ready Reddit API client

---

## Success Criteria for Auth Infrastructure

The authentication infrastructure will be considered complete when:

1. **Reddit API methods authenticate automatically** without manual token management
2. **Multi-user Reddit clients work safely** without token conflicts between users
3. **Rate limiting prevents quota violations** across all Reddit API operations
4. **Token refresh is completely transparent** to Reddit API method implementations
5. **Authentication errors provide actionable guidance** for application error handling
6. **The infrastructure scales** to support high-throughput Reddit applications

### Future Reddit Client Features Enabled

Once this auth infrastructure is complete, we can build:

- **Subreddit API**: Browse, search, subscribe to subreddits
- **Post API**: Create, edit, vote on posts and comments  
- **User API**: Profile management, messaging, preferences
- **Moderation API**: Mod actions, reports, mod mail
- **Real-time Features**: Live comment streams, notifications
- **Bulk Operations**: Mass actions with proper rate limiting
- **Analytics**: Aggregated data collection with quota management

---

## Dependencies and Technical Requirements

**Core Dependencies**:
- `axios` - HTTP client (peer dependency)
- `keyv` - Storage abstraction (peer dependency)  
- `pino` - Structured logging (peer dependency)
- `zod` - Runtime validation

**Integration Requirements**:
- Must work with any Keyv-compatible storage backend
- Must accept pre-configured axios instances
- Must provide structured error types for Reddit client error handling
- Must support both single-user and multi-user Reddit applications

**Performance Requirements**:
- Token refresh must not block concurrent Reddit API requests
- Rate limiting must have minimal latency overhead
- Storage operations must be optimized for high-frequency Reddit API usage

This authentication infrastructure provides the bulletproof foundation needed to build a comprehensive, production-ready Reddit API client that developers can rely on for everything from simple bots to large-scale Reddit integrations.
