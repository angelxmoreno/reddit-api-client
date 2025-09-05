# Phase 2: Rate Limiting Infrastructure

## Overview
This phase builds the rate limiting system that prevents Reddit API quota violations. You'll implement a token bucket algorithm with persistent state, Reddit header integration, and configurable strategies.

## Goals
- ✅ Token bucket rate limiting per user/app identity
- ✅ Integration with Reddit response headers (`x-ratelimit-*`)
- ✅ Persistent rate limit state across application restarts
- ✅ Configurable strategies: throw immediately vs queue and wait
- ✅ Support for global and per-endpoint rate limits
- ✅ Queue management for concurrent requests

## Prerequisites
- **Phase 1 completed** (authentication foundation working)
- Understanding of rate limiting algorithms
- Knowledge of token bucket vs leaky bucket patterns
- Familiarity with queue management
- Understanding of Reddit's rate limiting behavior

## Reddit Rate Limiting Background

**Important Context for Implementation:**
- Reddit allows 60 requests per minute globally per app
- Some endpoints have stricter limits (e.g., 1 post per 10 minutes)
- Rate limits are per OAuth application, not per user
- Reddit returns headers: `x-ratelimit-remaining`, `x-ratelimit-reset`, `x-ratelimit-used`
- Violating rate limits can result in temporary or permanent bans

## Task Breakdown

### Task 2.1: Define Rate Limiting Types and Interfaces (2 hours)

**Objective**: Extend the types system with rate limiting interfaces.

**Add to `src/types/index.ts`**:

```ts
// Rate Limiting Types (add these to existing file)
export interface RateLimitRule {
  max: number;        // Maximum requests allowed
  windowMs: number;   // Time window in milliseconds
  per: 'user' | 'app'; // Whether limit is per-user or per-app
}

export interface RateLimitRules {
  global: RateLimitRule;
  endpoints?: Record<string, RateLimitRule>;
}

export interface RateLimitState {
  tokens: number;      // Current available tokens
  lastRefill: number;  // Last time bucket was refilled (ms epoch)
  resetAt?: number;    // When rate limit resets (from Reddit headers)
}

export interface QueuedTask<T> {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  endpoint?: string;
}

// Update RedditClientConfig to include strategy
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

// Add RateLimiter interface
export interface RateLimiter {
  schedule<T>(key: string, task: () => Promise<T>, endpoint?: string): Promise<T>;
  updateFromHeaders(key: string, headers: Record<string, string | number | undefined>): Promise<void>;
  getState(key: string, endpoint?: string): Promise<RateLimitState>;
  clearState(key: string, endpoint?: string): Promise<void>;
}
```

**Create `src/rate-limiting/types.ts`** for rate-limiting specific types:

```ts
export interface TokenBucket {
  tokens: number;
  capacity: number;
  refillRate: number; // tokens per millisecond
  lastRefill: number;
}

export interface QueueManager<T> {
  enqueue(item: QueuedTask<T>): void;
  dequeue(): QueuedTask<T> | undefined;
  size(): number;
  clear(): void;
}

export interface RateLimitStrategy {
  shouldBlock(state: RateLimitState, rule: RateLimitRule): boolean;
  handleBlocked(state: RateLimitState, rule: RateLimitRule): Promise<void> | never;
}
```

**Acceptance Criteria**:
- [ ] All rate limiting types compile correctly
- [ ] Types integrate with existing authentication types
- [ ] Interfaces are properly exported
- [ ] No circular dependencies

### Task 2.2: Implement Default Rate Limit Rules (1 hour)

**Objective**: Create sensible default rate limiting rules based on Reddit's documented limits.

**Create `src/rate-limiting/defaults.ts`**:

```ts
import { RateLimitRules } from '../types';

export const DEFAULT_RATE_LIMIT_RULES: RateLimitRules = {
  // Reddit's global limit: 60 requests per minute
  global: {
    max: 60,
    windowMs: 60_000, // 1 minute
    per: 'app'
  },
  
  // Specific endpoint limits based on Reddit documentation
  endpoints: {
    // Posting limits
    '/api/submit': {
      max: 1,
      windowMs: 600_000, // 10 minutes
      per: 'user'
    },
    
    // Comment limits
    '/api/comment': {
      max: 1,
      windowMs: 10_000, // 10 seconds
      per: 'user'
    },
    
    // Voting limits (more lenient)
    '/api/vote': {
      max: 10,
      windowMs: 60_000, // 1 minute
      per: 'user'
    },
    
    // Message limits
    '/api/compose': {
      max: 1,
      windowMs: 60_000, // 1 minute
      per: 'user'
    },
    
    // Subscription actions
    '/api/subscribe': {
      max: 5,
      windowMs: 60_000, // 1 minute
      per: 'user'
    }
  }
};

export function mergeRateLimitRules(
  defaults: RateLimitRules, 
  custom?: Partial<RateLimitRules>
): RateLimitRules {
  if (!custom) return defaults;
  
  return {
    global: custom.global || defaults.global,
    endpoints: {
      ...defaults.endpoints,
      ...custom.endpoints
    }
  };
}
```

**Testing Instructions**:
Create `tests/defaults.test.ts`:

```ts
import { DEFAULT_RATE_LIMIT_RULES, mergeRateLimitRules } from '../src/rate-limiting/defaults';

describe('Rate Limit Defaults', () => {
  it('should have sensible default rules', () => {
    expect(DEFAULT_RATE_LIMIT_RULES.global.max).toBe(60);
    expect(DEFAULT_RATE_LIMIT_RULES.global.windowMs).toBe(60_000);
    expect(DEFAULT_RATE_LIMIT_RULES.global.per).toBe('app');
  });

  it('should have endpoint-specific rules', () => {
    expect(DEFAULT_RATE_LIMIT_RULES.endpoints['/api/submit']).toEqual({
      max: 1,
      windowMs: 600_000,
      per: 'user'
    });
  });

  it('should merge custom rules correctly', () => {
    const custom = {
      global: { max: 100, windowMs: 60_000, per: 'app' as const },
      endpoints: {
        '/api/custom': { max: 5, windowMs: 30_000, per: 'user' as const }
      }
    };

    const merged = mergeRateLimitRules(DEFAULT_RATE_LIMIT_RULES, custom);
    
    expect(merged.global.max).toBe(100);
    expect(merged.endpoints['/api/submit']).toBeDefined(); // Original endpoint preserved
    expect(merged.endpoints['/api/custom']).toBeDefined(); // Custom endpoint added
  });
});
```

**Acceptance Criteria**:
- [ ] Default rules match Reddit's documented limits
- [ ] Rule merging works correctly
- [ ] Tests verify all default values
- [ ] Rules are properly typed

### Task 2.3: Implement Token Bucket Algorithm (4 hours)

**Objective**: Create a token bucket implementation for rate limiting.

**Create `src/rate-limiting/TokenBucket.ts`**:

```ts
import { RateLimitRule, RateLimitState } from '../types';

export class TokenBucket {
  constructor(
    protected capacity: number,
    protected refillRate: number, // tokens per millisecond
    protected logger?: any
  ) {}

  /**
   * Creates a token bucket from a rate limit rule
   */
  static fromRule(rule: RateLimitRule): TokenBucket {
    const refillRate = rule.max / rule.windowMs;
    return new TokenBucket(rule.max, refillRate);
  }

  /**
   * Refills the bucket based on time elapsed
   */
  refill(state: RateLimitState, now: number = Date.now()): RateLimitState {
    const timeSinceLastRefill = now - state.lastRefill;
    const tokensToAdd = Math.floor(timeSinceLastRefill * this.refillRate);
    
    if (tokensToAdd > 0) {
      const newTokens = Math.min(this.capacity, state.tokens + tokensToAdd);
      return {
        ...state,
        tokens: newTokens,
        lastRefill: now
      };
    }
    
    return state;
  }

  /**
   * Attempts to consume tokens from the bucket
   */
  consume(state: RateLimitState, tokens: number = 1, now: number = Date.now()): {
    state: RateLimitState;
    allowed: boolean;
  } {
    const refilledState = this.refill(state, now);
    
    if (refilledState.tokens >= tokens) {
      return {
        state: {
          ...refilledState,
          tokens: refilledState.tokens - tokens
        },
        allowed: true
      };
    }
    
    return {
      state: refilledState,
      allowed: false
    };
  }

  /**
   * Calculates when the next token will be available
   */
  getNextTokenTime(state: RateLimitState, now: number = Date.now()): number {
    if (state.tokens > 0) return now;
    
    const timeForOneToken = 1 / this.refillRate;
    return now + timeForOneToken;
  }

  /**
   * Gets the current state after refilling
   */
  getCurrentState(state: RateLimitState, now: number = Date.now()): RateLimitState {
    return this.refill(state, now);
  }
}
```

**Testing Instructions**:
Create `tests/TokenBucket.test.ts`:

```ts
import { TokenBucket } from '../src/rate-limiting/TokenBucket';
import { RateLimitState } from '../src/types';

describe('TokenBucket', () => {
  let bucket: TokenBucket;
  const now = Date.now();

  beforeEach(() => {
    // 10 tokens per 1000ms = 0.01 tokens per ms
    bucket = new TokenBucket(10, 0.01);
  });

  describe('refill', () => {
    it('should refill tokens based on elapsed time', () => {
      const state: RateLimitState = {
        tokens: 5,
        lastRefill: now - 500 // 500ms ago
      };

      const newState = bucket.refill(state, now);
      
      // 500ms * 0.01 = 5 tokens to add, but capped at capacity
      expect(newState.tokens).toBe(10); // 5 + 5 = 10 (capacity)
      expect(newState.lastRefill).toBe(now);
    });

    it('should not exceed capacity', () => {
      const state: RateLimitState = {
        tokens: 8,
        lastRefill: now - 1000 // 1000ms ago
      };

      const newState = bucket.refill(state, now);
      
      // Would add 10 tokens (8 + 10 = 18) but capped at 10
      expect(newState.tokens).toBe(10);
    });

    it('should not refill if no time passed', () => {
      const state: RateLimitState = {
        tokens: 5,
        lastRefill: now
      };

      const newState = bucket.refill(state, now);
      expect(newState.tokens).toBe(5);
    });
  });

  describe('consume', () => {
    it('should consume tokens when available', () => {
      const state: RateLimitState = {
        tokens: 5,
        lastRefill: now
      };

      const result = bucket.consume(state, 2, now);
      
      expect(result.allowed).toBe(true);
      expect(result.state.tokens).toBe(3);
    });

    it('should reject consumption when insufficient tokens', () => {
      const state: RateLimitState = {
        tokens: 1,
        lastRefill: now
      };

      const result = bucket.consume(state, 2, now);
      
      expect(result.allowed).toBe(false);
      expect(result.state.tokens).toBe(1); // Unchanged
    });

    it('should refill before consuming', () => {
      const state: RateLimitState = {
        tokens: 0,
        lastRefill: now - 1000 // 1000ms ago, should add 10 tokens
      };

      const result = bucket.consume(state, 5, now);
      
      expect(result.allowed).toBe(true);
      expect(result.state.tokens).toBe(5); // 10 - 5 = 5
    });
  });

  describe('getNextTokenTime', () => {
    it('should return current time if tokens available', () => {
      const state: RateLimitState = {
        tokens: 5,
        lastRefill: now
      };

      const nextTime = bucket.getNextTokenTime(state, now);
      expect(nextTime).toBe(now);
    });

    it('should calculate wait time when no tokens', () => {
      const state: RateLimitState = {
        tokens: 0,
        lastRefill: now
      };

      const nextTime = bucket.getNextTokenTime(state, now);
      expect(nextTime).toBe(now + 100); // 1/0.01 = 100ms for one token
    });
  });

  describe('fromRule', () => {
    it('should create bucket from rate limit rule', () => {
      const rule = {
        max: 60,
        windowMs: 60_000,
        per: 'app' as const
      };

      const bucket = TokenBucket.fromRule(rule);
      
      // 60 tokens per 60000ms = 0.001 tokens per ms
      expect(bucket['capacity']).toBe(60);
      expect(bucket['refillRate']).toBe(0.001);
    });
  });
});
```

**Acceptance Criteria**:
- [ ] Token bucket refills correctly based on time
- [ ] Token consumption works properly
- [ ] Capacity limits are respected
- [ ] Next token time calculations are accurate
- [ ] All edge cases are handled
- [ ] Tests cover all functionality

### Task 2.4: Implement Queue Management (3 hours)

**Objective**: Create a queue system for managing requests when rate limited.

**Create `src/rate-limiting/QueueManager.ts`**:

```ts
import { QueuedTask } from '../types';
import * as pino from 'pino';

export class QueueManager<T> {
  protected queue: QueuedTask<T>[] = [];
  protected processing = false;

  constructor(
    protected logger: pino.Logger,
    protected maxQueueSize: number = 100
  ) {}

  enqueue(task: QueuedTask<T>): void {
    if (this.queue.length >= this.maxQueueSize) {
      const error = new Error(`Queue full: ${this.maxQueueSize} items`);
      task.reject(error);
      return;
    }

    this.queue.push(task);
    this.logger.debug({ queueSize: this.queue.length }, 'Task enqueued');
  }

  dequeue(): QueuedTask<T> | undefined {
    const task = this.queue.shift();
    if (task) {
      this.logger.debug({ queueSize: this.queue.length }, 'Task dequeued');
    }
    return task;
  }

  peek(): QueuedTask<T> | undefined {
    return this.queue[0];
  }

  size(): number {
    return this.queue.length;
  }

  clear(): void {
    // Reject all queued tasks
    for (const task of this.queue) {
      task.reject(new Error('Queue cleared'));
    }
    this.queue = [];
    this.logger.debug('Queue cleared');
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Process the queue with a given processor function
   */
  async processQueue(processor: (task: QueuedTask<T>) => Promise<boolean>): Promise<void> {
    if (this.processing) return;
    
    this.processing = true;
    
    try {
      while (!this.isEmpty()) {
        const task = this.peek();
        if (!task) break;

        const shouldContinue = await processor(task);
        
        if (shouldContinue) {
          this.dequeue(); // Remove processed task
        } else {
          break; // Stop processing (e.g., rate limited)
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process queue with delay between items
   */
  async processQueueWithDelay(
    processor: (task: QueuedTask<T>) => Promise<boolean>,
    delayMs: number
  ): Promise<void> {
    if (this.processing) return;
    
    this.processing = true;
    
    try {
      while (!this.isEmpty()) {
        const task = this.peek();
        if (!task) break;

        const shouldContinue = await processor(task);
        
        if (shouldContinue) {
          this.dequeue();
          
          // Add delay between processing items
          if (!this.isEmpty() && delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        } else {
          break;
        }
      }
    } finally {
      this.processing = false;
    }
  }
}
```

**Testing Instructions**:
Create `tests/QueueManager.test.ts`:

```ts
import pino from 'pino';
import { QueueManager } from '../src/rate-limiting/QueueManager';
import { QueuedTask } from '../src/types';

describe('QueueManager', () => {
  let queueManager: QueueManager<string>;
  let logger: pino.Logger;

  beforeEach(() => {
    logger = pino({ level: 'silent' });
    queueManager = new QueueManager<string>(logger, 5);
  });

  describe('basic operations', () => {
    it('should enqueue and dequeue tasks', () => {
      const task: QueuedTask<string> = {
        task: () => Promise.resolve('result'),
        resolve: jest.fn(),
        reject: jest.fn()
      };

      queueManager.enqueue(task);
      expect(queueManager.size()).toBe(1);

      const dequeued = queueManager.dequeue();
      expect(dequeued).toBe(task);
      expect(queueManager.size()).toBe(0);
    });

    it('should reject tasks when queue is full', () => {
      const mockReject = jest.fn();
      
      // Fill queue to capacity
      for (let i = 0; i < 5; i++) {
        queueManager.enqueue({
          task: () => Promise.resolve('result'),
          resolve: jest.fn(),
          reject: jest.fn()
        });
      }

      // Try to add one more
      queueManager.enqueue({
        task: () => Promise.resolve('result'),
        resolve: jest.fn(),
        reject: mockReject
      });

      expect(mockReject).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Queue full: 5 items'
        })
      );
    });

    it('should clear all tasks', () => {
      const mockReject1 = jest.fn();
      const mockReject2 = jest.fn();

      queueManager.enqueue({
        task: () => Promise.resolve('result'),
        resolve: jest.fn(),
        reject: mockReject1
      });

      queueManager.enqueue({
        task: () => Promise.resolve('result'),
        resolve: jest.fn(),
        reject: mockReject2
      });

      queueManager.clear();
      
      expect(queueManager.size()).toBe(0);
      expect(mockReject1).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Queue cleared'
        })
      );
      expect(mockReject2).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Queue cleared'
        })
      );
    });
  });

  describe('processQueue', () => {
    it('should process all tasks successfully', async () => {
      const mockResolve1 = jest.fn();
      const mockResolve2 = jest.fn();

      queueManager.enqueue({
        task: () => Promise.resolve('result1'),
        resolve: mockResolve1,
        reject: jest.fn()
      });

      queueManager.enqueue({
        task: () => Promise.resolve('result2'),
        resolve: mockResolve2,
        reject: jest.fn()
      });

      const processor = jest.fn().mockResolvedValue(true);
      
      await queueManager.processQueue(processor);
      
      expect(processor).toHaveBeenCalledTimes(2);
      expect(queueManager.size()).toBe(0);
    });

    it('should stop processing when processor returns false', async () => {
      queueManager.enqueue({
        task: () => Promise.resolve('result1'),
        resolve: jest.fn(),
        reject: jest.fn()
      });

      queueManager.enqueue({
        task: () => Promise.resolve('result2'),
        resolve: jest.fn(),
        reject: jest.fn()
      });

      const processor = jest.fn()
        .mockResolvedValueOnce(true)  // Process first task
        .mockResolvedValueOnce(false); // Stop at second task
      
      await queueManager.processQueue(processor);
      
      expect(processor).toHaveBeenCalledTimes(2);
      expect(queueManager.size()).toBe(1); // One task remaining
    });

    it('should not process concurrently', async () => {
      let processingCount = 0;
      
      queueManager.enqueue({
        task: () => Promise.resolve('result'),
        resolve: jest.fn(),
        reject: jest.fn()
      });

      const processor = async () => {
        processingCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
        processingCount--;
        return true;
      };

      // Start two concurrent processing attempts
      const promise1 = queueManager.processQueue(processor);
      const promise2 = queueManager.processQueue(processor);

      await Promise.all([promise1, promise2]);
      
      expect(processingCount).toBe(0); // Should never exceed 1
    });
  });
});
```

**Acceptance Criteria**:
- [ ] Queue operations work correctly
- [ ] Queue capacity limits are enforced
- [ ] Queue processing works with delays
- [ ] Concurrent processing is prevented
- [ ] Error handling works properly
- [ ] All tests pass

### Task 2.5: Implement Core RateLimiter (6 hours)

**Objective**: Create the main rate limiter that coordinates token buckets, queues, and Reddit header updates.

**Create `src/rate-limiting/RateLimiter.ts`**:

```ts
import Keyv from 'keyv';
import * as pino from 'pino';
import { RateLimiter, RateLimitRules, RateLimitRule, RateLimitState, QueuedTask } from '../types';
import { AuthErrors } from '../errors';
import { TokenBucket } from './TokenBucket';
import { QueueManager } from './QueueManager';

export class DefaultRateLimiter implements RateLimiter {
  protected queues = new Map<string, QueueManager<any>>();
  protected buckets = new Map<string, TokenBucket>();

  constructor(
    protected rules: RateLimitRules,
    protected store: Keyv<RateLimitState>,
    protected logger: pino.Logger,
    protected strategy: 'throw' | 'wait' = 'wait'
  ) {}

  async schedule<T>(key: string, task: () => Promise<T>, endpoint?: string): Promise<T> {
    const rule = this.getRule(endpoint);
    const rateLimitKey = this.buildRateLimitKey(key, endpoint);
    
    // Get current rate limit state
    const state = await this.getRateLimitState(rateLimitKey, rule);
    const bucket = this.getBucket(rule);
    
    // Try to consume a token
    const result = bucket.consume(state);
    
    if (result.allowed) {
      // Update state and execute immediately
      await this.saveRateLimitState(rateLimitKey, result.state);
      return await this.executeTask(task, rateLimitKey);
    }

    // Handle rate limiting based on strategy
    if (this.strategy === 'throw') {
      const waitTime = this.calculateWaitTime(result.state, rule);
      throw AuthErrors.rateLimited(
        `Rate limit exceeded for ${endpoint || 'global'}`,
        true,
        Math.ceil(waitTime / 1000)
      );
    }

    // Queue the task for later execution
    return this.queueTask(rateLimitKey, task, rule);
  }

  async updateFromHeaders(
    key: string, 
    headers: Record<string, string | number | undefined>
  ): Promise<void> {
    const remaining = this.parseHeader(headers['x-ratelimit-remaining']);
    const reset = this.parseHeader(headers['x-ratelimit-reset']);
    const used = this.parseHeader(headers['x-ratelimit-used']);
    
    if (remaining !== null || reset !== null) {
      const rateLimitKey = this.buildRateLimitKey(key);
      let state = await this.getRateLimitState(rateLimitKey, this.rules.global);
      
      if (remaining !== null) {
        state.tokens = remaining;
      }
      
      if (reset !== null) {
        state.resetAt = reset * 1000; // Convert to milliseconds
      }
      
      state.lastRefill = Date.now();
      
      await this.saveRateLimitState(rateLimitKey, state);
      
      this.logger.debug({ 
        key, 
        remaining, 
        reset, 
        used 
      }, 'Updated rate limit from headers');
      
      // Try to process any queued tasks
      this.processQueue(rateLimitKey);
    }
  }

  async getState(key: string, endpoint?: string): Promise<RateLimitState> {
    const rule = this.getRule(endpoint);
    const rateLimitKey = this.buildRateLimitKey(key, endpoint);
    return this.getRateLimitState(rateLimitKey, rule);
  }

  async clearState(key: string, endpoint?: string): Promise<void> {
    const rateLimitKey = this.buildRateLimitKey(key, endpoint);
    await this.store.delete(rateLimitKey);
    this.logger.debug({ key, endpoint }, 'Cleared rate limit state');
  }

  protected getRule(endpoint?: string): RateLimitRule {
    if (endpoint && this.rules.endpoints?.[endpoint]) {
      return this.rules.endpoints[endpoint];
    }
    return this.rules.global;
  }

  protected buildRateLimitKey(key: string, endpoint?: string): string {
    const baseKey = key.replace('reddit:token:', 'reddit:ratelimit:');
    return endpoint ? `${baseKey}:${endpoint}` : baseKey;
  }

  protected async getRateLimitState(rateLimitKey: string, rule: RateLimitRule): Promise<RateLimitState> {
    let state = await this.store.get(rateLimitKey);
    
    if (!state) {
      // Initialize with full bucket
      state = {
        tokens: rule.max,
        lastRefill: Date.now()
      };
      await this.saveRateLimitState(rateLimitKey, state);
    }
    
    return state;
  }

  protected async saveRateLimitState(rateLimitKey: string, state: RateLimitState): Promise<void> {
    try {
      await this.store.set(rateLimitKey, state);
    } catch (error) {
      this.logger.error({ error: error.message, rateLimitKey }, 'Failed to save rate limit state');
    }
  }

  protected getBucket(rule: RateLimitRule): TokenBucket {
    const ruleKey = `${rule.max}:${rule.windowMs}:${rule.per}`;
    
    if (!this.buckets.has(ruleKey)) {
      this.buckets.set(ruleKey, TokenBucket.fromRule(rule));
    }
    
    return this.buckets.get(ruleKey)!;
  }

  protected getQueue(rateLimitKey: string): QueueManager<any> {
    if (!this.queues.has(rateLimitKey)) {
      this.queues.set(rateLimitKey, new QueueManager(this.logger));
    }
    
    return this.queues.get(rateLimitKey)!;
  }

  protected async queueTask<T>(
    rateLimitKey: string, 
    task: () => Promise<T>,
    rule: RateLimitRule
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queuedTask: QueuedTask<T> = {
        task,
        resolve,
        reject
      };
      
      const queue = this.getQueue(rateLimitKey);
      queue.enqueue(queuedTask);
      
      this.logger.debug({ 
        rateLimitKey, 
        queueSize: queue.size() 
      }, 'Task queued due to rate limit');
      
      // Start processing the queue
      this.processQueue(rateLimitKey);
    });
  }

  protected async processQueue(rateLimitKey: string): Promise<void> {
    const queue = this.getQueue(rateLimitKey);
    
    if (queue.isEmpty()) return;
    
    const rule = this.getRule(); // Default to global rule for queue processing
    const bucket = this.getBucket(rule);
    
    await queue.processQueue(async (queuedTask) => {
      try {
        const state = await this.getRateLimitState(rateLimitKey, rule);
        const result = bucket.consume(state);
        
        if (result.allowed) {
          // Execute the task
          await this.saveRateLimitState(rateLimitKey, result.state);
          const taskResult = await this.executeTask(queuedTask.task, rateLimitKey);
          queuedTask.resolve(taskResult);
          return true; // Continue processing
        } else {
          // Still rate limited, calculate delay and retry later
          const waitTime = this.calculateWaitTime(result.state, rule);
          
          setTimeout(() => {
            this.processQueue(rateLimitKey);
          }, waitTime);
          
          return false; // Stop processing for now
        }
      } catch (error) {
        queuedTask.reject(error);
        return true; // Continue with next task even if this one failed
      }
    });
  }

  protected async executeTask<T>(task: () => Promise<T>, rateLimitKey: string): Promise<T> {
    try {
      const result = await task();
      this.logger.debug({ rateLimitKey }, 'Task executed successfully');
      return result;
    } catch (error) {
      this.logger.error({ 
        error: error.message, 
        rateLimitKey 
      }, 'Task execution failed');
      throw error;
    }
  }

  protected calculateWaitTime(state: RateLimitState, rule: RateLimitRule): number {
    if (state.resetAt) {
      // Use Reddit's reset time if available
      return Math.max(100, state.resetAt - Date.now());
    }
    
    // Calculate based on refill rate
    const bucket = this.getBucket(rule);
    return bucket.getNextTokenTime(state) - Date.now();
  }

  protected parseHeader(value: string | number | undefined): number | null {
    if (value === undefined || value === null) return null;
    
    const parsed = typeof value === 'string' ? parseInt(value, 10) : value;
    return isNaN(parsed) ? null : parsed;
  }
}
```

**Testing Instructions**:
Create `tests/RateLimiter.test.ts`:

```ts
import Keyv from 'keyv';
import pino from 'pino';
import { DefaultRateLimiter } from '../src/rate-limiting/RateLimiter';
import { RateLimitRules } from '../src/types';
import { AuthErrors } from '../src/errors';

describe('DefaultRateLimiter', () => {
  let store: Keyv;
  let logger: pino.Logger;
  let rateLimiter: DefaultRateLimiter;
  
  const testRules: RateLimitRules = {
    global: { max: 5, windowMs: 1000, per: 'app' },
    endpoints: {
      '/api/submit': { max: 1, windowMs: 10000, per: 'user' }
    }
  };

  beforeEach(() => {
    store = new Keyv();
    logger = pino({ level: 'silent' });
    rateLimiter = new DefaultRateLimiter(testRules, store, logger, 'wait');
  });

  describe('schedule with wait strategy', () => {
    it('should execute task immediately when tokens available', async () => {
      const task = jest.fn().mockResolvedValue('result');
      
      const result = await rateLimiter.schedule('test-key', task);
      
      expect(result).toBe('result');
      expect(task).toHaveBeenCalledTimes(1);
    });

    it('should queue tasks when rate limited', async () => {
      const task = jest.fn().mockResolvedValue('result');
      
      // Exhaust rate limit
      for (let i = 0; i < 5; i++) {
        await rateLimiter.schedule('test-key', () => Promise.resolve(`result-${i}`));
      }
      
      // This should be queued
      const queuedPromise = rateLimiter.schedule('test-key', task);
      
      // Should not execute immediately
      expect(task).not.toHaveBeenCalled();
      
      // Wait for queue processing (with timeout)
      const result = await Promise.race([
        queuedPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 2000)
        )
      ]);
      
      expect(result).toBe('result');
      expect(task).toHaveBeenCalledTimes(1);
    });

    it('should handle endpoint-specific limits', async () => {
      const task = jest.fn().mockResolvedValue('result');
      
      // Use endpoint-specific limit (1 per 10 seconds)
      await rateLimiter.schedule('test-key', task, '/api/submit');
      
      // Second request should be queued
      const secondTask = jest.fn().mockResolvedValue('result2');
      const queuedPromise = rateLimiter.schedule('test-key', secondTask, '/api/submit');
      
      expect(secondTask).not.toHaveBeenCalled();
      
      // Should execute after delay
      const result = await Promise.race([
        queuedPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 15000)
        )
      ]);
      
      expect(result).toBe('result2');
    });
  });

  describe('schedule with throw strategy', () => {
    beforeEach(() => {
      rateLimiter = new DefaultRateLimiter(testRules, store, logger, 'throw');
    });

    it('should throw when rate limited', async () => {
      const task = jest.fn().mockResolvedValue('result');
      
      // Exhaust rate limit
      for (let i = 0; i < 5; i++) {
        await rateLimiter.schedule('test-key', task);
      }
      
      // This should throw
      await expect(rateLimiter.schedule('test-key', task))
        .rejects.toMatchObject({
          kind: 'rate_limited',
          retryable: true
        });
    });
  });

  describe('updateFromHeaders', () => {
    it('should update rate limit state from Reddit headers', async () => {
      const headers = {
        'x-ratelimit-remaining': '30',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
        'x-ratelimit-used': '30'
      };
      
      await rateLimiter.updateFromHeaders('test-key', headers);
      
      const state = await rateLimiter.getState('test-key');
      expect(state.tokens).toBe(30);
      expect(state.resetAt).toBeDefined();
    });

    it('should handle missing headers gracefully', async () => {
      const headers = {
        'some-other-header': 'value'
      };
      
      // Should not throw
      await expect(rateLimiter.updateFromHeaders('test-key', headers))
        .resolves.toBeUndefined();
    });
  });

  describe('state management', () => {
    it('should get current state', async () => {
      const state = await rateLimiter.getState('test-key');
      
      expect(state.tokens).toBe(5); // Initial tokens = max
      expect(state.lastRefill).toBeDefined();
    });

    it('should clear state', async () => {
      // Set some state
      await rateLimiter.schedule('test-key', () => Promise.resolve('result'));
      
      // Clear it
      await rateLimiter.clearState('test-key');
      
      // Should be reset to initial state
      const state = await rateLimiter.getState('test-key');
      expect(state.tokens).toBe(5);
    });
  });
});
```

**Acceptance Criteria**:
- [ ] Rate limiter executes tasks immediately when tokens available
- [ ] Tasks are queued when rate limited with 'wait' strategy
- [ ] Rate limiter throws errors with 'throw' strategy
- [ ] Reddit headers update rate limit state correctly
- [ ] Endpoint-specific rules work
- [ ] Queue processing works correctly
- [ ] State management works
- [ ] All tests pass

### Task 2.6: Integration with Authentication System (3 hours)

**Objective**: Integrate the rate limiter with the existing authentication infrastructure.

**Update `src/auth/AuthProvider.ts`** to include rate limiter dependency:

```ts
// Add to imports
import { RateLimiter } from '../types';

// Update constructor
export class DefaultAuthProvider implements AuthProvider {
  protected refreshPromise?: Promise<StoredToken>;

  constructor(
    protected cfg: CredentialConfig,
    protected cm: CredentialManager,
    protected rateLimiter: RateLimiter, // Add this
    protected logger: pino.Logger
  ) {}

  // Update ensureValidToken to use rate limiter for token refresh
  async ensureValidToken(): Promise<StoredToken> {
    if (this.refreshPromise) {
      this.logger.debug('Waiting for existing refresh operation');
      return this.refreshPromise;
    }

    const key = this.cm.buildKey(this.cfg);
    let token = await this.cm.get(key);

    if (!token || isTokenExpiringSoon(token)) {
      this.logger.debug({ key, hasToken: !!token }, 'Token refresh needed');
      
      // Use rate limiter for token refresh
      this.refreshPromise = this.rateLimiter.schedule(key, async () => {
        return this.refreshToken();
      });
      
      try {
        token = await this.refreshPromise;
      } finally {
        this.refreshPromise = undefined;
      }
    }

    return token;
  }

  // Rest of the class remains the same...
}
```

**Create integration factory function in `src/index.ts`**:

```ts
import Keyv from 'keyv';
import * as pino from 'pino';
import axios, { AxiosInstance } from 'axios';
import { RedditClientConfig } from './types';
import { DefaultCredentialManager } from './storage/CredentialManager';
import { DefaultAuthProvider } from './auth/AuthProvider';
import { DefaultRateLimiter } from './rate-limiting/RateLimiter';
import { DEFAULT_RATE_LIMIT_RULES, mergeRateLimitRules } from './rate-limiting/defaults';
import { CredentialConfigValidator } from './validation';

export function createRedditAuthInfrastructure(config: RedditClientConfig) {
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

  // Create or use provided axios instance
  const axios = config.axios || axios.create({
    baseURL: "https://oauth.reddit.com"
  });

  return {
    authProvider,
    rateLimiter,
    credentialManager,
    axios
  };
}

// Export all main classes and types
export * from './types';
export * from './errors';
export * from './auth/AuthProvider';
export * from './storage/CredentialManager';
export * from './rate-limiting/RateLimiter';
export * from './validation';
```

**Testing Instructions**:
Create `tests/integration.test.ts`:

```ts
import Keyv from 'keyv';
import pino from 'pino';
import { createRedditAuthInfrastructure } from '../src';
import { RedditClientConfig } from '../src/types';

describe('Reddit Auth Infrastructure Integration', () => {
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
      }
    };
  });

  it('should create all components correctly', () => {
    const infrastructure = createRedditAuthInfrastructure(config);
    
    expect(infrastructure.authProvider).toBeDefined();
    expect(infrastructure.rateLimiter).toBeDefined();
    expect(infrastructure.credentialManager).toBeDefined();
    expect(infrastructure.axios).toBeDefined();
  });

  it('should validate configuration', () => {
    const invalidConfig = {
      ...config,
      credentials: {
        kind: 'app',
        clientId: '', // Invalid
        clientSecret: 'test-secret',
        userAgent: 'test-app/1.0'
      }
    };

    expect(() => createRedditAuthInfrastructure(invalidConfig))
      .toThrow('Invalid configuration');
  });

  it('should merge rate limit rules with defaults', () => {
    const customConfig = {
      ...config,
      rateLimiter: {
        strategy: 'throw' as const,
        rules: {
          global: { max: 100, windowMs: 60000, per: 'app' as const },
          endpoints: {
            '/api/custom': { max: 1, windowMs: 5000, per: 'user' as const }
          }
        }
      }
    };

    const infrastructure = createRedditAuthInfrastructure(customConfig);
    
    // Should use custom global rule but keep default endpoint rules too
    expect(infrastructure.rateLimiter).toBeDefined();
  });
});
```

**Acceptance Criteria**:
- [ ] AuthProvider integrates with RateLimiter
- [ ] Factory function creates all components correctly
- [ ] Configuration validation works
- [ ] Rate limit rule merging works
- [ ] Integration tests pass
- [ ] All exports are correct

## Phase 2 Completion Checklist

**Before moving to Phase 3, ensure:**

- [ ] All TypeScript compiles without errors
- [ ] All tests pass (`npm test`)
- [ ] Token bucket algorithm works correctly
- [ ] Queue management handles concurrent requests
- [ ] Rate limiter integrates with authentication
- [ ] Reddit header updates work
- [ ] Both 'throw' and 'wait' strategies work
- [ ] Default rate limit rules are sensible
- [ ] State persistence across restarts works
- [ ] Performance is acceptable under load

**Integration Tests to Run:**
1. Rate limit with 'wait' strategy queues requests properly
2. Rate limit with 'throw' strategy fails fast
3. Reddit headers update rate limit state
4. Multiple endpoints have separate rate limits
5. Concurrent requests don't break rate limiting
6. Rate limit state persists across app restarts

**Deliverables:**
1. Working `RateLimiter` implementation
2. Token bucket algorithm with queue management
3. Reddit header integration
4. Default rate limiting rules
5. Full integration with authentication system
6. Comprehensive test suite

**Time Estimate**: 21 hours total
**Difficulty**: Intermediate to Advanced
**Dependencies**: Phase 1 (Authentication Foundation)

Once Phase 2 is complete, you'll have a production-ready rate limiting system that prevents Reddit API quota violations and integrates seamlessly with the authentication infrastructure. This will be ready for Phase 3 where we build the internal HTTP client that coordinates everything.
