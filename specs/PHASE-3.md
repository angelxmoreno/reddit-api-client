# Phase 3: Internal HTTP Client Implementation

## Overview
This phase creates the `RedditHttpClient` - the internal client that coordinates authentication and rate limiting for all Reddit API requests. This is the core component that Reddit API modules will use instead of raw axios.

## Goals
- ✅ Internal HTTP client with clean get/post/put/delete interface
- ✅ Automatic auth header injection for all requests
- ✅ Seamless rate limiting integration 
- ✅ Reddit response header processing
- ✅ Error handling and retry logic
- ✅ Request/response logging and monitoring
- ✅ Foundation for Reddit API method implementations

## Prerequisites
- **Phase 1 completed** (authentication working)
- **Phase 2 completed** (rate limiting working)
- Understanding of HTTP client patterns
- Knowledge of axios request/response interceptors
- Familiarity with error handling strategies

## Task Breakdown

### Task 3.1: Define HTTP Client Interfaces (2 hours)

**Objective**: Create comprehensive interfaces for the internal HTTP client.

**Add to `src/types/index.ts`**:

```ts
// HTTP Client Types (add these to existing file)
export interface RequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, any>;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface RequestContext {
  method: string;
  url: string;
  startTime: number;
  requestId: string;
  endpoint?: string;
  retryCount?: number;
}

export interface ResponseContext extends RequestContext {
  statusCode: number;
  duration: number;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
}

export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  retryCondition: (error: any) => boolean;
}

export interface HttpClient {
  get<T = any>(url: string, options?: RequestOptions): Promise<T>;
  post<T = any>(url: string, data?: any, options?: RequestOptions): Promise<T>;
  put<T = any>(url: string, data?: any, options?: RequestOptions): Promise<T>;
  delete<T = any>(url: string, options?: RequestOptions): Promise<T>;
  patch<T = any>(url: string, data?: any, options?: RequestOptions): Promise<T>;
}

export interface HttpMetrics {
  requestCount: number;
  errorCount: number;
  averageResponseTime: number;
  rateLimitHits: number;
  retryCount: number;
}
```

**Create `src/http/types.ts`** for HTTP-specific types:

```ts
export interface RedditApiResponse<T = any> {
  data: T;
  status: number;
  headers: Record<string, string>;
  rateLimiting?: {
    remaining: number;
    reset: number;
    used: number;
  };
}

export interface RequestInterceptor {
  (context: RequestContext): Promise<RequestContext>;
}

export interface ResponseInterceptor {
  (context: ResponseContext): Promise<ResponseContext>;
}

export interface ErrorInterceptor {
  (error: any, context: RequestContext): Promise<any>;
}

export interface HttpClientConfig {
  authProvider: AuthProvider;
  rateLimiter: RateLimiter;
  axios: AxiosInstance;
  logger: pino.Logger;
  retryConfig?: Partial<RetryConfig>;
  metrics?: boolean;
}
```

**Acceptance Criteria**:
- [ ] All HTTP client interfaces are properly typed
- [ ] Types integrate with existing auth/rate limiting types
- [ ] Generic types work correctly for responses
- [ ] No TypeScript errors

### Task 3.2: Implement Request Context Management (3 hours)

**Objective**: Create a system for tracking requests through the pipeline with proper context.

**Create `src/http/RequestContext.ts`**:

```ts
import { v4 as uuidv4 } from 'uuid';
import { RequestContext, ResponseContext } from '../types';

export class RequestContextManager {
  private contexts = new Map<string, RequestContext>();

  createContext(method: string, url: string): RequestContext {
    const context: RequestContext = {
      method: method.toUpperCase(),
      url,
      startTime: Date.now(),
      requestId: uuidv4(),
      endpoint: this.extractEndpoint(url),
      retryCount: 0
    };

    this.contexts.set(context.requestId, context);
    return context;
  }

  updateContext(requestId: string, updates: Partial<RequestContext>): RequestContext | null {
    const context = this.contexts.get(requestId);
    if (!context) return null;

    const updatedContext = { ...context, ...updates };
    this.contexts.set(requestId, updatedContext);
    return updatedContext;
  }

  createResponseContext(
    requestContext: RequestContext,
    statusCode: number,
    rateLimitHeaders?: Record<string, string | number | undefined>
  ): ResponseContext {
    const duration = Date.now() - requestContext.startTime;
    
    const responseContext: ResponseContext = {
      ...requestContext,
      statusCode,
      duration,
      rateLimitRemaining: this.parseRateLimitHeader(rateLimitHeaders?.['x-ratelimit-remaining']),
      rateLimitReset: this.parseRateLimitHeader(rateLimitHeaders?.['x-ratelimit-reset'])
    };

    return responseContext;
  }

  getContext(requestId: string): RequestContext | null {
    return this.contexts.get(requestId) || null;
  }

  removeContext(requestId: string): void {
    this.contexts.delete(requestId);
  }

  cleanup(maxAge: number = 300000): void {
    // Clean up contexts older than maxAge (default 5 minutes)
    const cutoff = Date.now() - maxAge;
    
    for (const [id, context] of this.contexts.entries()) {
      if (context.startTime < cutoff) {
        this.contexts.delete(id);
      }
    }
  }

  protected extractEndpoint(url: string): string | undefined {
    // Extract Reddit API endpoint for rate limiting
    const match = url.match(/\/api\/(\w+)/);
    return match ? `/api/${match[1]}` : undefined;
  }

  protected parseRateLimitHeader(value: string | number | undefined): number | undefined {
    if (value === undefined || value === null) return undefined;
    
    const parsed = typeof value === 'string' ? parseInt(value, 10) : value;
    return isNaN(parsed) ? undefined : parsed;
  }
}
```

**Create `src/http/HttpMetrics.ts`**:

```ts
import * as pino from 'pino';
import { HttpMetrics, ResponseContext } from '../types';

export class HttpMetricsCollector {
  protected metrics: HttpMetrics = {
    requestCount: 0,
    errorCount: 0,
    averageResponseTime: 0,
    rateLimitHits: 0,
    retryCount: 0
  };

  protected responseTimes: number[] = [];
  protected maxResponseTimeHistory = 1000; // Keep last 1000 response times

  constructor(protected logger: pino.Logger) {}

  recordRequest(context: ResponseContext): void {
    this.metrics.requestCount++;
    
    // Record response time
    this.responseTimes.push(context.duration);
    if (this.responseTimes.length > this.maxResponseTimeHistory) {
      this.responseTimes.shift();
    }
    
    // Update average response time
    this.metrics.averageResponseTime = 
      this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length;

    // Record rate limit hits
    if (context.statusCode === 429) {
      this.metrics.rateLimitHits++;
    }

    // Record retries
    if (context.retryCount && context.retryCount > 0) {
      this.metrics.retryCount += context.retryCount;
    }

    this.logger.debug({
      requestId: context.requestId,
      method: context.method,
      url: context.url,
      statusCode: context.statusCode,
      duration: context.duration,
      rateLimitRemaining: context.rateLimitRemaining,
      retryCount: context.retryCount
    }, 'HTTP request completed');
  }

  recordError(context: RequestContext, error: any): void {
    this.metrics.errorCount++;
    
    this.logger.error({
      requestId: context.requestId,
      method: context.method,
      url: context.url,
      error: error.message,
      retryCount: context.retryCount
    }, 'HTTP request failed');
  }

  getMetrics(): HttpMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {
      requestCount: 0,
      errorCount: 0,
      averageResponseTime: 0,
      rateLimitHits: 0,
      retryCount: 0
    };
    this.responseTimes = [];
  }

  logSummary(): void {
    const successRate = this.metrics.requestCount > 0 
      ? ((this.metrics.requestCount - this.metrics.errorCount) / this.metrics.requestCount * 100).toFixed(2)
      : '0.00';

    this.logger.info({
      ...this.metrics,
      successRate: `${successRate}%`
    }, 'HTTP client metrics summary');
  }
}
```

**Testing Instructions**:
Create `tests/RequestContext.test.ts`:

```ts
import { RequestContextManager } from '../src/http/RequestContext';

describe('RequestContextManager', () => {
  let contextManager: RequestContextManager;

  beforeEach(() => {
    contextManager = new RequestContextManager();
  });

  describe('createContext', () => {
    it('should create context with correct properties', () => {
      const context = contextManager.createContext('GET', '/api/v1/me');
      
      expect(context.method).toBe('GET');
      expect(context.url).toBe('/api/v1/me');
      expect(context.requestId).toBeDefined();
      expect(context.startTime).toBeDefined();
      expect(context.endpoint).toBeUndefined(); // /api/v1/me doesn't match pattern
      expect(context.retryCount).toBe(0);
    });

    it('should extract endpoint from Reddit API URLs', () => {
      const context = contextManager.createContext('POST', '/api/submit');
      expect(context.endpoint).toBe('/api/submit');
    });

    it('should normalize method to uppercase', () => {
      const context = contextManager.createContext('post', '/api/submit');
      expect(context.method).toBe('POST');
    });
  });

  describe('context management', () => {
    it('should store and retrieve contexts', () => {
      const context = contextManager.createContext('GET', '/test');
      const retrieved = contextManager.getContext(context.requestId);
      
      expect(retrieved).toBe(context);
    });

    it('should update contexts', () => {
      const context = contextManager.createContext('GET', '/test');
      const updated = contextManager.updateContext(context.requestId, { retryCount: 1 });
      
      expect(updated?.retryCount).toBe(1);
      expect(updated?.requestId).toBe(context.requestId);
    });

    it('should remove contexts', () => {
      const context = contextManager.createContext('GET', '/test');
      contextManager.removeContext(context.requestId);
      
      const retrieved = contextManager.getContext(context.requestId);
      expect(retrieved).toBeNull();
    });
  });

  describe('createResponseContext', () => {
    it('should create response context with timing info', () => {
      const requestContext = contextManager.createContext('GET', '/test');
      
      // Simulate some time passing
      jest.advanceTimersByTime(100);
      
      const responseContext = contextManager.createResponseContext(
        requestContext,
        200,
        { 'x-ratelimit-remaining': '59', 'x-ratelimit-reset': '1234567890' }
      );
      
      expect(responseContext.statusCode).toBe(200);
      expect(responseContext.duration).toBeGreaterThan(0);
      expect(responseContext.rateLimitRemaining).toBe(59);
      expect(responseContext.rateLimitReset).toBe(1234567890);
    });
  });
});
```

**Acceptance Criteria**:
- [ ] Request contexts are created and managed correctly
- [ ] Response contexts include timing and rate limit info
- [ ] Context cleanup prevents memory leaks
- [ ] Metrics collection works accurately
- [ ] All tests pass

### Task 3.3: Implement Retry Logic (4 hours)

**Objective**: Create robust retry logic for transient failures and rate limiting.

**Create `src/http/RetryHandler.ts`**:

```ts
import * as pino from 'pino';
import { RetryConfig, RequestContext } from '../types';
import { AuthErrors } from '../errors';

export class RetryHandler {
  protected defaultConfig: RetryConfig = {
    maxRetries: 3,
    retryDelay: 1000, // 1 second base delay
    retryCondition: (error: any) => this.isRetryableError(error)
  };

  constructor(
    protected config: Partial<RetryConfig>,
    protected logger: pino.Logger
  ) {}

  async executeWithRetry<T>(
    context: RequestContext,
    operation: () => Promise<T>,
    updateContext: (updates: Partial<RequestContext>) => void
  ): Promise<T> {
    const retryConfig = { ...this.defaultConfig, ...this.config };
    let lastError: any;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          updateContext({ retryCount: attempt });
          this.logger.debug({
            requestId: context.requestId,
            attempt,
            maxRetries: retryConfig.maxRetries
          }, 'Retrying request');
        }

        const result = await operation();
        
        if (attempt > 0) {
          this.logger.info({
            requestId: context.requestId,
            attempt,
            totalAttempts: attempt + 1
          }, 'Request succeeded after retry');
        }

        return result;
      } catch (error) {
        lastError = error;
        
        // Don't retry on last attempt
        if (attempt === retryConfig.maxRetries) {
          break;
        }

        // Check if error is retryable
        if (!retryConfig.retryCondition(error)) {
          this.logger.debug({
            requestId: context.requestId,
            error: error.message
          }, 'Error is not retryable, aborting');
          break;
        }

        // Calculate delay with exponential backoff
        const delay = this.calculateRetryDelay(
          attempt,
          retryConfig.retryDelay,
          error
        );

        this.logger.warn({
          requestId: context.requestId,
          attempt,
          error: error.message,
          retryDelay: delay
        }, 'Request failed, will retry');

        await this.sleep(delay);
      }
    }

    // All retries exhausted, throw the last error
    throw lastError;
  }

  protected isRetryableError(error: any): boolean {
    // Network errors
    if (error.code === 'ECONNRESET' || 
        error.code === 'ECONNABORTED' || 
        error.code === 'ETIMEDOUT') {
      return true;
    }

    // HTTP status codes that indicate transient issues
    if (error.response?.status) {
      const status = error.response.status;
      
      // Server errors (5xx)
      if (status >= 500 && status < 600) {
        return true;
      }
      
      // Rate limiting (429) - but should be handled by rate limiter
      if (status === 429) {
        return true;
      }
      
      // Request timeout (408)
      if (status === 408) {
        return true;
      }
      
      // Too many requests from Reddit's perspective (sometimes transient)
      if (status === 503) {
        return true;
      }
    }

    // Auth errors that might be transient (token refresh issues)
    if (error.kind === 'auth_failed' && error.retryable) {
      return true;
    }

    return false;
  }

  protected calculateRetryDelay(
    attempt: number,
    baseDelay: number,
    error: any
  ): number {
    // Use Retry-After header if present
    if (error.response?.headers?.['retry-after']) {
      const retryAfter = parseInt(error.response.headers['retry-after'], 10);
      if (!isNaN(retryAfter)) {
        return retryAfter * 1000; // Convert to milliseconds
      }
    }

    // Use retryAfter from our auth errors
    if (error.retryAfter) {
      return error.retryAfter * 1000;
    }

    // Exponential backoff with jitter
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

**Testing Instructions**:
Create `tests/RetryHandler.test.ts`:

```ts
import pino from 'pino';
import { RetryHandler } from '../src/http/RetryHandler';
import { RequestContext } from '../src/types';

describe('RetryHandler', () => {
  let retryHandler: RetryHandler;
  let logger: pino.Logger;
  let context: RequestContext;
  let updateContext: jest.Mock;

  beforeEach(() => {
    logger = pino({ level: 'silent' });
    retryHandler = new RetryHandler({ maxRetries: 2, retryDelay: 10 }, logger);
    
    context = {
      method: 'GET',
      url: '/test',
      startTime: Date.now(),
      requestId: 'test-id',
      retryCount: 0
    };
    
    updateContext = jest.fn();
  });

  describe('executeWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await retryHandler.executeWithRetry(context, operation, updateContext);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
      expect(updateContext).not.toHaveBeenCalled();
    });

    it('should retry on retryable errors', async () => {
      const retryableError = { 
        response: { status: 500 },
        message: 'Internal Server Error'
      };
      
      const operation = jest.fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('success');
      
      const result = await retryHandler.executeWithRetry(context, operation, updateContext);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
      expect(updateContext).toHaveBeenCalledWith({ retryCount: 1 });
      expect(updateContext).toHaveBeenCalledWith({ retryCount: 2 });
    });

    it('should not retry non-retryable errors', async () => {
      const nonRetryableError = { 
        response: { status: 400 },
        message: 'Bad Request'
      };
      
      const operation = jest.fn().mockRejectedValue(nonRetryableError);
      
      await expect(retryHandler.executeWithRetry(context, operation, updateContext))
        .rejects.toBe(nonRetryableError);
      
      expect(operation).toHaveBeenCalledTimes(1);
      expect(updateContext).not.toHaveBeenCalled();
    });

    it('should exhaust retries and throw last error', async () => {
      const retryableError = { 
        response: { status: 500 },
        message: 'Internal Server Error'
      };
      
      const operation = jest.fn().mockRejectedValue(retryableError);
      
      await expect(retryHandler.executeWithRetry(context, operation, updateContext))
        .rejects.toBe(retryableError);
      
      expect(operation).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('should respect Retry-After header', async () => {
      const errorWithRetryAfter = {
        response: { 
          status: 429,
          headers: { 'retry-after': '2' }
        },
        message: 'Rate Limited'
      };
      
      const operation = jest.fn()
        .mockRejectedValueOnce(errorWithRetryAfter)
        .mockResolvedValue('success');
      
      const startTime = Date.now();
      const result = await retryHandler.executeWithRetry(context, operation, updateContext);
      const duration = Date.now() - startTime;
      
      expect(result).toBe('success');
      expect(duration).toBeGreaterThan(1900); // Should wait ~2 seconds
    });
  });

  describe('isRetryableError', () => {
    it('should identify retryable network errors', () => {
      const networkErrors = [
        { code: 'ECONNRESET' },
        { code: 'ECONNABORTED' },
        { code: 'ETIMEDOUT' }
      ];

      networkErrors.forEach(error => {
        expect(retryHandler['isRetryableError'](error)).toBe(true);
      });
    });

    it('should identify retryable HTTP status codes', () => {
      const retryableStatuses = [429, 500, 502, 503, 504, 408];

      retryableStatuses.forEach(status => {
        const error = { response: { status } };
        expect(retryHandler['isRetryableError'](error)).toBe(true);
      });
    });

    it('should identify non-retryable HTTP status codes', () => {
      const nonRetryableStatuses = [400, 401, 403, 404];

      nonRetryableStatuses.forEach(status => {
        const error = { response: { status } };
        expect(retryHandler['isRetryableError'](error)).toBe(false);
      });
    });
  });
});
```

**Acceptance Criteria**:
- [ ] Retry logic works for transient failures
- [ ] Exponential backoff with jitter implemented
- [ ] Retry-After headers are respected
- [ ] Non-retryable errors fail fast
- [ ] Retry counts are tracked correctly
- [ ] All tests pass

### Task 3.4: Implement Core RedditHttpClient (8 hours)

**Objective**: Create the main HTTP client that coordinates auth, rate limiting, and retry logic.

**Create `src/http/RedditHttpClient.ts`**:

```ts
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as pino from 'pino';
import { 
  HttpClient, 
  HttpClientConfig, 
  RequestOptions, 
  AuthProvider, 
  RateLimiter,
  RedditApiResponse
} from '../types';
import { RequestContextManager } from './RequestContext';
import { HttpMetricsCollector } from './HttpMetrics';
import { RetryHandler } from './RetryHandler';
import { AuthErrors } from '../errors';

export class RedditHttpClient implements HttpClient {
  protected contextManager: RequestContextManager;
  protected metricsCollector?: HttpMetricsCollector;
  protected retryHandler: RetryHandler;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(protected config: HttpClientConfig) {
    this.contextManager = new RequestContextManager();
    
    if (config.metrics !== false) {
      this.metricsCollector = new HttpMetricsCollector(config.logger);
    }
    
    this.retryHandler = new RetryHandler(
      config.retryConfig || {},
      config.logger
    );

    // Set up periodic context cleanup with proper cleanup handling
    this.cleanupInterval = setInterval(() => {
      this.contextManager.cleanup();
    }, 300000); // Clean up every 5 minutes
  }

  /**
   * Dispose of resources and cleanup timers to prevent memory leaks
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Perform final cleanup
    this.contextManager.cleanup();
  }

  async get<T = any>(url: string, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>('GET', url, undefined, options);
  }

  async post<T = any>(url: string, data?: any, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>('POST', url, data, options);
  }

  async put<T = any>(url: string, data?: any, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>('PUT', url, data, options);
  }

  async delete<T = any>(url: string, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>('DELETE', url, undefined, options);
  }

  async patch<T = any>(url: string, data?: any, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>('PATCH', url, data, options);
  }

  protected async makeRequest<T>(
    method: string,
    url: string,
    data?: any,
    options?: RequestOptions
  ): Promise<T> {
    const context = this.contextManager.createContext(method, url);
    
    try {
      const result = await this.retryHandler.executeWithRetry(
        context,
        () => this.executeRequest<T>(context, method, url, data, options),
        (updates) => this.contextManager.updateContext(context.requestId, updates)
      );

      return result;
    } catch (error) {
      this.metricsCollector?.recordError(context, error);
      throw error;
    } finally {
      this.contextManager.removeContext(context.requestId);
    }
  }

  protected async executeRequest<T>(
    context: RequestContext,
    method: string,
    url: string,
    data?: any,
    options?: RequestOptions
  ): Promise<T> {
    // Get authentication token
    const token = await this.config.authProvider.ensureValidToken();
    
    // Build request key for rate limiting
    const requestKey = this.buildRequestKey();
    
    // Execute request with rate limiting
    const response = await this.config.rateLimiter.schedule(
      requestKey,
      async () => {
        return this.performHttpRequest(method, url, data, options, token.access_token);
      },
      context.endpoint
    );

    // Process response
    const responseContext = this.contextManager.createResponseContext(
      context,
      response.status,
      response.headers
    );

    // Update rate limiting from headers
    await this.config.rateLimiter.updateFromHeaders(requestKey, response.headers);

    // Record metrics
    this.metricsCollector?.recordRequest(responseContext);

    // Log successful request
    this.config.logger.debug({
      requestId: context.requestId,
      method,
      url,
      statusCode: response.status,
      duration: responseContext.duration
    }, 'HTTP request completed successfully');

    return this.processResponse<T>(response);
  }

  protected async performHttpRequest(
    method: string,
    url: string,
    data?: any,
    options?: RequestOptions,
    accessToken?: string
  ): Promise<AxiosResponse> {
    const requestConfig = {
      method,
      url,
      data,
      timeout: options?.timeout || 30000,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': this.config.authProvider.getUserAgent(),
        'Content-Type': method !== 'GET' ? 'application/json' : undefined,
        ...options?.headers
      },
      params: options?.params
    };

    // Remove undefined values
    Object.keys(requestConfig.headers).forEach(key => {
      if (requestConfig.headers[key] === undefined) {
        delete requestConfig.headers[key];
      }
    });

    try {
      const response = await this.config.axios.request(requestConfig);
      return response;
    } catch (error) {
      // Handle specific Reddit API errors
      if (error.response?.status === 401) {
        throw AuthErrors.authFailed('Authentication failed', true, error);
      }
      
      if (error.response?.status === 403) {
        throw AuthErrors.scopeInsufficient(
          ['unknown'], // We don't know the required scope
          [] // We don't know the available scopes
        );
      }
      
      if (error.response?.status === 429) {
        const retryAfter = error.response.headers['retry-after'];
        throw AuthErrors.rateLimited(
          'Rate limit exceeded',
          true,
          retryAfter ? parseInt(retryAfter, 10) : undefined
        );
      }

      throw error;
    }
  }

  protected processResponse<T>(response: AxiosResponse): T {
    // Handle Reddit API response format
    if (response.data && typeof response.data === 'object') {
      // Reddit API often wraps responses in different formats
      // This is a simplified version - real implementation would handle
      // Reddit's various response formats
      return response.data as T;
    }

    return response.data as T;
  }

  protected buildRequestKey(): string {
    // Use the auth provider's credential manager to build a consistent key
    return this.config.authProvider.getConfig().clientId || 'default';
  }

  // Public methods for monitoring and management
  getMetrics() {
    return this.metricsCollector?.getMetrics();
  }

  logMetricsSummary(): void {
    this.metricsCollector?.logSummary();
  }

  resetMetrics(): void {
    this.metricsCollector?.reset();
  }
}
```

**Testing Instructions**:
Create `tests/RedditHttpClient.test.ts`:

```ts
import axios from 'axios';
import pino from 'pino';
import { RedditHttpClient } from '../src/http/RedditHttpClient';
import { AuthProvider, RateLimiter, StoredToken } from '../src/types';

// Mock dependencies
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('RedditHttpClient', () => {
  let httpClient: RedditHttpClient;
  let mockAuthProvider: jest.Mocked<AuthProvider>;
  let mockRateLimiter: jest.Mocked<RateLimiter>;
  let mockAxios: jest.Mocked<any>;
  let logger: pino.Logger;

  const mockToken: StoredToken = {
    access_token: 'test-token',
    token_type: 'bearer',
    expires_in: 3600,
    scope: 'read',
    received_at: Date.now()
  };

  beforeEach(() => {
    logger = pino({ level: 'silent' });
    
    mockAuthProvider = {
      ensureValidToken: jest.fn().mockResolvedValue(mockToken),
      getUserAgent: jest.fn().mockReturnValue('test-app/1.0'),
      getConfig: jest.fn().mockReturnValue({ clientId: 'test-client' }),
      checkScopes: jest.fn().mockResolvedValue(true)
    } as any;

    mockRateLimiter = {
      schedule: jest.fn().mockImplementation((key, task) => task()),
      updateFromHeaders: jest.fn().mockResolvedValue(undefined),
      getState: jest.fn(),
      clearState: jest.fn()
    } as any;

    mockAxios = {
      request: jest.fn().mockResolvedValue({
        data: { test: 'data' },
        status: 200,
        headers: {}
      })
    };

    httpClient = new RedditHttpClient({
      authProvider: mockAuthProvider,
      rateLimiter: mockRateLimiter,
      axios: mockAxios,
      logger,
      metrics: true
    });
  });

  describe('HTTP methods', () => {
    it('should make GET request successfully', async () => {
      const result = await httpClient.get('/api/v1/me');
      
      expect(result).toEqual({ test: 'data' });
      expect(mockAuthProvider.ensureValidToken).toHaveBeenCalled();
      expect(mockRateLimiter.schedule).toHaveBeenCalled();
      expect(mockAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/api/v1/me',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'User-Agent': 'test-app/1.0'
          })
        })
      );
    });

    it('should make POST request with data', async () => {
      const postData = { title: 'Test Post', text: 'Test content' };
      
      await httpClient.post('/api/submit', postData);
      
      expect(mockAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/api/submit',
          data: postData,
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });

    it('should include custom headers from options', async () => {
      await httpClient.get('/test', {
        headers: { 'Custom-Header': 'value' }
      });
      
      expect(mockAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'Custom-Header': 'value'
          })
        })
      );
    });
  });

  describe('error handling', () => {
    it('should handle 401 authentication errors', async () => {
      const authError = {
        response: { status: 401 },
        message: 'Unauthorized'
      };
      
      mockAxios.request.mockRejectedValue(authError);
      
      await expect(httpClient.get('/test'))
        .rejects.toMatchObject({
          kind: 'auth_failed',
          retryable: true
        });
    });

    it('should handle 403 scope errors', async () => {
      const scopeError = {
        response: { status: 403 },
        message: 'Forbidden'
      };
      
      mockAxios.request.mockRejectedValue(scopeError);
      
      await expect(httpClient.get('/test'))
        .rejects.toMatchObject({
          kind: 'scope_insufficient'
        });
    });

    it('should handle 429 rate limit errors', async () => {
      const rateLimitError = {
        response: { 
          status: 429,
          headers: { 'retry-after': '60' }
        },
        message: 'Rate Limited'
      };
      
      mockAxios.request.mockRejectedValue(rateLimitError);
      
      await expect(httpClient.get('/test'))
        .rejects.toMatchObject({
          kind: 'rate_limited',
          retryAfter: 60
        });
    });
  });

  describe('rate limiting integration', () => {
    it('should schedule requests through rate limiter', async () => {
      await httpClient.get('/api/submit');
      
      expect(mockRateLimiter.schedule).toHaveBeenCalledWith(
        'test-client',
        expect.any(Function),
        '/api/submit'
      );
    });

    it('should update rate limiter from response headers', async () => {
      mockAxios.request.mockResolvedValue({
        data: {},
        status: 200,
        headers: {
          'x-ratelimit-remaining': '59',
          'x-ratelimit-reset': '1234567890'
        }
      });
      
      await httpClient.get('/test');
      
      expect(mockRateLimiter.updateFromHeaders).toHaveBeenCalledWith(
        'test-client',
        expect.objectContaining({
          'x-ratelimit-remaining': '59',
          'x-ratelimit-reset': '1234567890'
        })
      );
    });
  });

  describe('metrics', () => {
    it('should collect request metrics', async () => {
      await httpClient.get('/test');
      
      const metrics = httpClient.getMetrics();
      expect(metrics?.requestCount).toBe(1);
      expect(metrics?.errorCount).toBe(0);
    });

    it('should collect error metrics', async () => {
      mockAxios.request.mockRejectedValue(new Error('Network error'));
      
      try {
        await httpClient.get('/test');
      } catch (error) {
        // Expected error
      }
      
      const metrics = httpClient.getMetrics();
      expect(metrics?.errorCount).toBe(1);
    });
  });
});
```

**Acceptance Criteria**:
- [ ] All HTTP methods work correctly
- [ ] Authentication headers are injected automatically
- [ ] Rate limiting is integrated seamlessly
- [ ] Reddit response headers update rate limits
- [ ] Error handling produces proper AuthErrors
- [ ] Retry logic works for transient failures
- [ ] Metrics are collected accurately
- [ ] All tests pass

### Task 3.5: Create Factory Function and Integration (3 hours)

**Objective**: Create a factory function that wires up all components and provides a clean interface.

**Update `src/index.ts`** with the complete factory:

```ts
import Keyv from 'keyv';
import * as pino from 'pino';
import axios, { AxiosInstance } from 'axios';
import { RedditClientConfig } from './types';
import { DefaultCredentialManager } from './storage/CredentialManager';
import { DefaultAuthProvider } from './auth/AuthProvider';
import { DefaultRateLimiter } from './rate-limiting/RateLimiter';
import { RedditHttpClient } from './http/RedditHttpClient';
import { DEFAULT_RATE_LIMIT_RULES, mergeRateLimitRules } from './rate-limiting/defaults';
import { CredentialConfigValidator } from './validation';

export interface RedditHttpClientFactory {
  httpClient: RedditHttpClient;
  authProvider: DefaultAuthProvider;
  rateLimiter: DefaultRateLimiter;
  credentialManager: DefaultCredentialManager;
}

export function createRedditHttpClient(config: RedditClientConfig): RedditHttpClientFactory {
  // Validate configuration
  const validation = CredentialConfigValidator.validateClientConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
  }

  // Set up rate limiting rules
  const rateLimitRules = mergeRateLimitRules(
    DEFAULT_RATE_LIMIT_RULES,
    config.rateLimiter?.rules
  );

  // Create axios instance if not provided
  const axiosInstance = config.axios || axios.create({
    baseURL: "https://oauth.reddit.com",
    timeout: 30000
  });

  // Create components
  const credentialManager = new DefaultCredentialManager(config.storage, config.logger);
  
  const rateLimiter = new DefaultRateLimiter(
    rateLimitRules,
    config.storage, // Same Keyv instance, different keys
    config.logger,
    config.rateLimiter?.strategy || 'wait'
  );

  const authProvider = new DefaultAuthProvider(
    config.credentials,
    credentialManager,
    rateLimiter,
    config.logger
  );

  // Create HTTP client
  const httpClient = new RedditHttpClient({
    authProvider,
    rateLimiter,
    axios: axiosInstance,
    logger: config.logger,
    retryConfig: {
      maxRetries: 3,
      retryDelay: 1000
    },
    metrics: config.debug || false
  });

  return {
    httpClient,
    authProvider,
    rateLimiter,
    credentialManager
  };
}

// Convenience function for just getting the HTTP client
export function createRedditClient(config: RedditClientConfig): RedditHttpClient {
  return createRedditHttpClient(config).httpClient;
}

// Export all main classes and types
export * from './types';
export * from './errors';
export * from './auth/AuthProvider';
export * from './storage/CredentialManager';
export * from './rate-limiting/RateLimiter';
export * from './http/RedditHttpClient';
export * from './validation';
```

**Create usage examples in `docs/examples.md`**:

```markdown
# Reddit HTTP Client Examples

## Basic Usage

```typescript
import { createRedditClient } from 'reddit-auth-client';
import Keyv from 'keyv';
import pino from 'pino';

const logger = pino({ level: 'info' });
const storage = new Keyv({ namespace: 'reddit-app' });

const client = createRedditClient({
  credentials: {
    kind: 'app',
    clientId: process.env.REDDIT_CLIENT_ID!,
    clientSecret: process.env.REDDIT_CLIENT_SECRET!,
    userAgent: 'MyApp/1.0 by u/myusername'
  },
  storage,
  logger
});

// Make requests - auth and rate limiting are automatic
const subreddit = await client.get('/r/javascript/about');
const posts = await client.get('/r/javascript/hot');
```

## User-based Authentication

```typescript
const client = createRedditClient({
  credentials: {
    kind: 'userTokens',
    clientId: process.env.REDDIT_CLIENT_ID!,
    clientSecret: process.env.REDDIT_CLIENT_SECRET!,
    userAgent: 'MyApp/1.0 by u/myusername',
    accessToken: process.env.ACCESS_TOKEN!,
    refreshToken: process.env.REFRESH_TOKEN!,
    scope: ['identity', 'read', 'submit'],
    usernameHint: 'myuser'
  },
  storage,
  logger,
  rateLimiter: {
    strategy: 'wait', // Queue requests when rate limited
    rules: {
      global: { max: 60, windowMs: 60000, per: 'app' },
      endpoints: {
        '/api/submit': { max: 1, windowMs: 600000, per: 'user' }
      }
    }
  }
});

// Create a post
const result = await client.post('/api/submit', {
  kind: 'self',
  sr: 'test',
  title: 'My Post Title',
  text: 'Post content goes here'
});
```

## Error Handling

```typescript
try {
  const result = await client.get('/api/v1/me');
} catch (error) {
  if (error.kind === 'auth_failed') {
    console.log('Authentication failed:', error.message);
  } else if (error.kind === 'rate_limited') {
    console.log(`Rate limited, retry in ${error.retryAfter} seconds`);
  } else if (error.kind === 'scope_insufficient') {
    console.log('Need more permissions:', error.message);
  } else {
    console.log('Request failed:', error.message);
  }
}
```

## Monitoring and Metrics

```typescript
const { httpClient } = createRedditHttpClient(config);

// Make some requests...
await httpClient.get('/r/javascript/hot');
await httpClient.get('/r/typescript/hot');

// Check metrics
const metrics = httpClient.getMetrics();
console.log('Requests made:', metrics.requestCount);
console.log('Average response time:', metrics.averageResponseTime);
console.log('Error rate:', metrics.errorCount / metrics.requestCount);

// Log summary
httpClient.logMetricsSummary();
```
```

**Testing Instructions**:
Create `tests/integration-full.test.ts`:

```ts
import Keyv from 'keyv';
import pino from 'pino';
import { createRedditClient, createRedditHttpClient } from '../src';
import { RedditClientConfig } from '../src/types';

// Mock axios for integration tests
jest.mock('axios');

describe('Full Integration Test', () => {
  let config: RedditClientConfig;

  beforeEach(() => {
    config = {
      credentials: {
        kind: 'app',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        userAgent: 'test-app/1.0'
      },
      storage: new Keyv(),
      logger: pino({ level: 'silent' }),
      rateLimiter: {
        strategy: 'wait',
        rules: {
          global: { max: 5, windowMs: 1000, per: 'app' }
        }
      },
      debug: true
    };
  });

  it('should create HTTP client with all components wired correctly', () => {
    const client = createRedditClient(config);
    
    expect(client).toBeDefined();
    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
    expect(typeof client.getMetrics).toBe('function');
  });

  it('should create full factory with all components', () => {
    const factory = createRedditHttpClient(config);
    
    expect(factory.httpClient).toBeDefined();
    expect(factory.authProvider).toBeDefined();
    expect(factory.rateLimiter).toBeDefined();
    expect(factory.credentialManager).toBeDefined();
  });

  it('should validate configuration before creation', () => {
    const invalidConfig = {
      ...config,
      credentials: {
        kind: 'app',
        clientId: '', // Invalid
        clientSecret: 'test-secret',
        userAgent: 'test-app/1.0'
      }
    };

    expect(() => createRedditClient(invalidConfig))
      .toThrow('Invalid configuration');
  });

  it('should use default values for optional configuration', () => {
    const minimalConfig = {
      credentials: config.credentials,
      storage: config.storage,
      logger: config.logger
    };

    const client = createRedditClient(minimalConfig);
    expect(client).toBeDefined();
  });
});
```

**Acceptance Criteria**:
- [ ] Factory function creates all components correctly
- [ ] Configuration validation works
- [ ] Default values are applied appropriately
- [ ] Integration tests pass
- [ ] Examples work correctly
- [ ] Documentation is clear

## Phase 3 Completion Checklist

**Before moving to Phase 4, ensure:**

- [ ] All TypeScript compiles without errors
- [ ] All tests pass (`npm test`)
- [ ] HTTP client handles all HTTP methods correctly
- [ ] Authentication is automatic and transparent
- [ ] Rate limiting prevents quota violations
- [ ] Reddit response headers update rate limits
- [ ] Retry logic handles transient failures
- [ ] Error handling produces structured errors
- [ ] Metrics collection works accurately
- [ ] Factory function wires components correctly
- [ ] Memory usage is reasonable (no leaks)
- [ ] Performance is acceptable under load

**Integration Tests to Run:**
1. End-to-end request with auth and rate limiting
2. Token refresh during request execution
3. Rate limit queue processing
4. Error handling and retry logic
5. Metrics collection accuracy
6. Multi-user isolation
7. Response header processing

**Manual Testing:**
1. Create a test Reddit app
2. Use real credentials to make API calls
3. Verify rate limiting prevents 429 errors
4. Test token refresh functionality
5. Verify request/response logging
6. Check metrics accuracy

**Deliverables:**
1. Complete `RedditHttpClient` implementation
2. Request context and metrics collection
3. Robust retry logic with exponential backoff
4. Factory function for easy setup
5. Comprehensive test suite
6. Usage examples and documentation

**Time Estimate**: 20 hours total
**Difficulty**: Advanced
**Dependencies**: Phase 1 (Auth), Phase 2 (Rate Limiting)

Once Phase 3 is complete, you'll have a production-ready internal HTTP client that automatically handles authentication, rate limiting, retries, and monitoring. This provides the foundation for Phase 4 where we'll build the final Reddit API client that uses this infrastructure.
