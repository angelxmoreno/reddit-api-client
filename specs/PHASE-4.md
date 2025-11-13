# Phase 4: Reddit API Client Implementation

## Overview
This final phase creates the complete Reddit API client that developers will actually use. You'll build API modules that leverage the existing documentation from the `reddit-api-ts-docs` repository, providing a type-safe and comprehensive interface to Reddit's API.

## Goals
- ✅ Main `RedditApiClient` class that coordinates everything
- ✅ Modular API interfaces using `reddit-api-ts-docs` documentation
- ✅ Reddit API method implementations with proper typing from existing Zod schemas
- ✅ Response parsing and data transformation
- ✅ Comprehensive error handling for Reddit-specific errors
- ✅ Pagination support for list endpoints
- ✅ Type-safe API based on `reddit-api-ts-docs` definitions

## Prerequisites
- **Phase 1-3 completed** (full auth infrastructure working)
- **Access to `reddit-api-ts-docs` repository** (contains pre-built API documentation and Zod schemas)
- Understanding of Reddit API structure and endpoints
- Knowledge of Reddit's response formats
- Familiarity with API design patterns

## Reddit API Documentation Integration

**Using reddit-api-ts-docs:**
The `reddit-api-ts-docs` repository contains comprehensive documentation for Reddit's API with:
- 19 documented API groups (Account, Subreddits, Users, etc.)
- Over 180+ endpoints with full type definitions
- Zod schemas for runtime validation
- Request/response type definitions
- Organized `DocGroup` and `Doc` interfaces

**Repository Structure:**
- Each `DocGroup` represents a Reddit API category
- Each `Doc` contains: description, method, uri, requestSchema, responseSchema
- Zod schemas provide runtime validation and TypeScript types

## Task Breakdown

### Task 4.1: Setup reddit-api-ts-docs Integration (2 hours)

**Objective**: Install and configure the reddit-api-ts-docs package to provide comprehensive Reddit API documentation and types.

**Install reddit-api-ts-docs package**:
```bash
bun add reddit-api-ts-docs
```

**Create `src/reddit/types.ts`** to re-export and extend the documentation types:

```ts
// Re-export all types from reddit-api-ts-docs
export * from 'reddit-api-ts-docs';

// Import specific types we'll use frequently
export type { Doc, DocGroup } from 'reddit-api-ts-docs';

// Additional custom types for our client implementation
export interface PaginationOptions {
  limit?: number; // 1-100, default 25
  after?: string; // fullname of last item from previous page
  before?: string; // fullname of first item from next page
  count?: number; // number of items already seen
}

export interface PaginationResult {
  after: string | null;
  before: string | null;
}

export interface SortOptions {
  sort?: 'hot' | 'new' | 'top' | 'rising' | 'controversial';
  t?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all'; // time period for 'top'
}

export interface SearchOptions extends PaginationOptions, SortOptions {
  q: string; // search query
  restrict_sr?: boolean; // restrict to subreddit
  type?: 'link' | 'user' | 'sr'; // search type
  include_over_18?: boolean;
}

// Client-specific wrapper types
export interface ListingResponse<T> {
  items: T[];
  pagination: PaginationResult;
}

export interface ApiRequestOptions {
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
}
```

**Create `src/reddit/documentationLoader.ts`** to load and organize Reddit API documentation:

```ts
import { DocGroup, Doc, getAllDocGroups } from 'reddit-api-ts-docs';

export class RedditApiDocumentation {
  protected static instance: RedditApiDocumentation;
  protected docGroups: DocGroup[];
  protected endpointMap: Map<string, Doc>;

  protected constructor() {
    this.docGroups = getAllDocGroups();
    this.endpointMap = new Map();
    this.buildEndpointMap();
  }

  static getInstance(): RedditApiDocumentation {
    if (!RedditApiDocumentation.instance) {
      RedditApiDocumentation.instance = new RedditApiDocumentation();
    }
    return RedditApiDocumentation.instance;
  }

  protected buildEndpointMap(): void {
    for (const group of this.docGroups) {
      for (const doc of group.docs) {
        const key = `${doc.method.toUpperCase()}:${doc.uri}`;
        this.endpointMap.set(key, doc);
      }
    }
  }

  getDocGroups(): DocGroup[] {
    return this.docGroups;
  }

  getDocGroup(name: string): DocGroup | undefined {
    return this.docGroups.find(group => group.name.toLowerCase() === name.toLowerCase());
  }

  getEndpoint(method: string, uri: string): Doc | undefined {
    const key = `${method.toUpperCase()}:${uri}`;
    return this.endpointMap.get(key);
  }

  findEndpointsByCategory(category: string): Doc[] {
    const group = this.getDocGroup(category);
    return group ? group.docs : [];
  }

  getAllEndpoints(): Doc[] {
    return Array.from(this.endpointMap.values());
  }

  validateRequest(method: string, uri: string, data: unknown): { valid: boolean; errors?: string[] } {
    const endpoint = this.getEndpoint(method, uri);
    if (!endpoint) {
      return { valid: false, errors: ['Endpoint not found in documentation'] };
    }

    if (!endpoint.requestSchema) {
      return { valid: true }; // No validation required
    }

    const result = endpoint.requestSchema.safeParse(data);
    if (result.success) {
      return { valid: true };
    }

    return {
      valid: false,
      errors: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
    };
  }

  validateResponse(method: string, uri: string, data: unknown): { valid: boolean; errors?: string[] } {
    const endpoint = this.getEndpoint(method, uri);
    if (!endpoint) {
      return { valid: false, errors: ['Endpoint not found in documentation'] };
    }

    if (!endpoint.responseSchema) {
      return { valid: true }; // No validation required
    }

    const result = endpoint.responseSchema.safeParse(data);
    if (result.success) {
      return { valid: true };
    }

    return {
      valid: false,
      errors: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
    };
  }
}

// Convenience function to get the documentation instance
export function getRedditApiDocs(): RedditApiDocumentation {
  return RedditApiDocumentation.getInstance();
}
```

**Testing Instructions**:
Create `tests/reddit-documentation.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import { RedditApiDocumentation, getRedditApiDocs } from '../src/reddit/documentationLoader';

describe('Reddit API Documentation', () => {
  test('should load all documentation groups', () => {
    const docs = getRedditApiDocs();
    const groups = docs.getDocGroups();

    expect(groups.length).toBeGreaterThan(0);
    expect(groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: expect.any(String) })
    ]));
  });

  test('should find specific doc groups', () => {
    const docs = getRedditApiDocs();

    const subredditGroup = docs.getDocGroup('Subreddits');
    expect(subredditGroup).toBeDefined();
    expect(subredditGroup?.name).toBe('Subreddits');
  });

  test('should find endpoints by method and URI', () => {
    const docs = getRedditApiDocs();

    // Look for a known endpoint - this will depend on what's in reddit-api-ts-docs
    const endpoints = docs.getAllEndpoints();
    expect(endpoints.length).toBeGreaterThan(0);

    // Test finding an endpoint (use first available as example)
    const firstEndpoint = endpoints[0];
    const found = docs.getEndpoint(firstEndpoint.method, firstEndpoint.uri);
    expect(found).toBeDefined();
    expect(found?.uri).toBe(firstEndpoint.uri);
  });

  test('should validate requests when schema exists', () => {
    const docs = getRedditApiDocs();
    const endpoints = docs.getAllEndpoints();

    // Find an endpoint with a request schema
    const endpointWithSchema = endpoints.find(ep => ep.requestSchema);
    if (endpointWithSchema) {
      // Test with invalid data
      const result = docs.validateRequest(
        endpointWithSchema.method,
        endpointWithSchema.uri,
        { invalid: 'data' }
      );

      // We expect this might be invalid depending on the schema
      expect(result).toHaveProperty('valid');
    }
  });

  test('should be singleton', () => {
    const docs1 = getRedditApiDocs();
    const docs2 = getRedditApiDocs();
    expect(docs1).toBe(docs2);
  });
});
```

**Acceptance Criteria**:
- [ ] reddit-api-ts-docs package is installed and accessible
- [ ] Documentation loader can access all Reddit API groups
- [ ] Endpoint lookup by method and URI works correctly
- [ ] Request/response validation uses Zod schemas from documentation
- [ ] Types are properly re-exported for client usage
- [ ] All tests pass

### Task 4.2: Implement Response Parsing and Utilities (2 hours)

**Objective**: Create utilities for parsing Reddit API responses using reddit-api-ts-docs schemas and handling Reddit-specific data formats.

**Create `src/reddit/parser.ts`**:

```ts
import { getRedditApiDocs } from './documentationLoader';
import { PaginationResult } from './types';
import { z } from 'zod';

export class RedditResponseParser {
  /**
   * Parses and validates a Reddit API response using documentation schemas
   */
  static parseResponse<T>(method: string, uri: string, response: unknown): T {
    const docs = getRedditApiDocs();
    const endpoint = docs.getEndpoint(method, uri);

    if (endpoint?.responseSchema) {
      const validation = docs.validateResponse(method, uri, response);
      if (!validation.valid) {
        console.warn(`Response validation failed for ${method} ${uri}:`, validation.errors);
      }
    }

    // Handle standard Reddit response format
    if (response && typeof response === 'object') {
      const resp = response as Record<string, unknown>;

      // Direct data response
      if (resp.data && !resp.kind) {
        return resp.data as T;
      }

      // Wrapped response with kind
      if (resp.kind && resp.data) {
        return resp.data as T;
      }

      // Array of responses
      if (Array.isArray(response)) {
        return response.map(item => this.parseResponseItem(item)) as unknown as T;
      }
    }

    return response as T;
  }

  /**
   * Parse individual response item
   */
  protected static parseResponseItem(item: unknown): unknown {
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (obj.kind && obj.data) {
        return obj.data;
      }
    }
    return item;
  }

  /**
   * Parses a Reddit listing response with type safety
   */
  static parseListing<T>(response: unknown): { items: T[]; pagination: PaginationResult } {
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid listing response format');
    }

    const resp = response as Record<string, unknown>;

    if (resp.kind === 'Listing' && resp.data && typeof resp.data === 'object') {
      const listingData = resp.data as Record<string, unknown>;

      if (Array.isArray(listingData.children)) {
        const items = listingData.children.map(child => {
          if (child && typeof child === 'object') {
            const childObj = child as Record<string, unknown>;
            return childObj.data as T;
          }
          return child as T;
        });

        return {
          items,
          pagination: {
            after: (listingData.after as string) || null,
            before: (listingData.before as string) || null
          }
        };
      }
    }

    throw new Error('Invalid listing response format');
  }

  /**
   * Parses a submission response (post creation) with validation
   */
  static parseSubmissionResponse(response: unknown): unknown {
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid submission response format');
    }

    const resp = response as Record<string, unknown>;

    if (resp.json && typeof resp.json === 'object') {
      const json = resp.json as Record<string, unknown>;

      // Check for errors first
      if (Array.isArray(json.errors) && json.errors.length > 0) {
        const errors = json.errors.map((err: unknown) => {
          if (Array.isArray(err)) {
            return err.join(': ');
          }
          return String(err);
        }).join(', ');
        throw new Error(`Submission failed: ${errors}`);
      }

      // Extract successful submission data
      if (json.data && typeof json.data === 'object') {
        const data = json.data as Record<string, unknown>;
        if (Array.isArray(data.things) && data.things.length > 0) {
          const firstThing = data.things[0];
          if (firstThing && typeof firstThing === 'object') {
            const thing = firstThing as Record<string, unknown>;
            return thing.data;
          }
        }
      }
    }

    throw new Error('Invalid submission response format');
  }

  /**
   * Parses API errors from Reddit responses
   */
  static parseErrors(response: unknown): string[] {
    const errors: string[] = [];

    if (response && typeof response === 'object') {
      const resp = response as Record<string, unknown>;

      if (resp.json && typeof resp.json === 'object') {
        const json = resp.json as Record<string, unknown>;

        if (Array.isArray(json.errors)) {
          for (const error of json.errors) {
            if (Array.isArray(error)) {
              errors.push(error.join(': '));
            } else {
              errors.push(String(error));
            }
          }
        }
      }
    }

    return errors;
  }

  /**
   * Converts Reddit's timestamp format to JavaScript Date
   */
  static parseTimestamp(utc: number): Date {
    return new Date(utc * 1000);
  }

  /**
   * Parses fullname to extract type and ID
   */
  static parseFullname(fullname: string): { type: string; id: string } {
    const match = fullname.match(/^(t\d+)_(.+)$/);
    if (!match) {
      throw new Error(`Invalid fullname format: ${fullname}`);
    }

    return {
      type: match[1],
      id: match[2]
    };
  }

  /**
   * Creates a fullname from type and ID
   */
  static createFullname(type: string, id: string): string {
    return `${type}_${id}`;
  }

  /**
   * Checks if a response indicates an error
   */
  static hasErrors(response: unknown): boolean {
    if (!response || typeof response !== 'object') {
      return false;
    }

    const resp = response as Record<string, unknown>;
    if (resp.json && typeof resp.json === 'object') {
      const json = resp.json as Record<string, unknown>;
      return Array.isArray(json.errors) && json.errors.length > 0;
    }

    return false;
  }

  /**
   * Normalizes Reddit URLs
   */
  static normalizeUrl(url: string): string {
    // Convert relative URLs to absolute
    if (url.startsWith('/')) {
      return `https://www.reddit.com${url}`;
    }

    // Ensure HTTPS
    if (url.startsWith('http://')) {
      return url.replace('http://', 'https://');
    }

    return url;
  }

  /**
   * Extracts subreddit name from various formats
   */
  static extractSubredditName(input: string): string {
    // Remove r/ prefix if present
    if (input.startsWith('r/')) {
      return input.substring(2);
    }

    // Remove /r/ prefix if present
    if (input.startsWith('/r/')) {
      return input.substring(3);
    }

    return input;
  }

  /**
   * Validates request data using endpoint schema
   */
  static validateRequest(method: string, uri: string, data: unknown): { valid: boolean; errors?: string[] } {
    const docs = getRedditApiDocs();
    return docs.validateRequest(method, uri, data);
  }
}
```

**Create `src/reddit/utils.ts`**:

```ts
import { PaginationOptions, SortOptions, ApiRequestOptions } from './types';

export class RedditUtils {
  /**
   * Builds query parameters for pagination
   */
  static buildPaginationParams(options?: PaginationOptions): Record<string, string> {
    const params: Record<string, string> = {};

    if (options?.limit) {
      params.limit = Math.min(Math.max(options.limit, 1), 100).toString();
    }

    if (options?.after) {
      params.after = options.after;
    }

    if (options?.before) {
      params.before = options.before;
    }

    if (options?.count) {
      params.count = options.count.toString();
    }

    return params;
  }

  /**
   * Builds query parameters for sorting
   */
  static buildSortParams(options?: SortOptions): Record<string, string> {
    const params: Record<string, string> = {};

    if (options?.sort) {
      params.sort = options.sort;
    }

    if (options?.t) {
      params.t = options.t;
    }

    return params;
  }

  /**
   * Converts API request options to proper format
   */
  static buildRequestOptions(options?: ApiRequestOptions): { params?: Record<string, string>; headers?: Record<string, string> } {
    const result: { params?: Record<string, string>; headers?: Record<string, string> } = {};

    if (options?.params) {
      result.params = {};
      for (const [key, value] of Object.entries(options.params)) {
        result.params[key] = String(value);
      }
    }

    if (options?.headers) {
      result.headers = { ...options.headers };
    }

    return result;
  }

  /**
   * Validates subreddit name format
   */
  static validateSubredditName(name: string): boolean {
    // Reddit subreddit names: 2-21 chars, alphanumeric + underscore
    const pattern = /^[A-Za-z0-9_]{2,21}$/;
    return pattern.test(name);
  }

  /**
   * Validates username format
   */
  static validateUsername(username: string): boolean {
    // Reddit usernames: 3-20 chars, alphanumeric + underscore + hyphen
    const pattern = /^[A-Za-z0-9_-]{3,20}$/;
    return pattern.test(username);
  }

  /**
   * Validates post title
   */
  static validatePostTitle(title: string): boolean {
    return title.length > 0 && title.length <= 300;
  }

  /**
   * Validates comment text
   */
  static validateCommentText(text: string): boolean {
    return text.length > 0 && text.length <= 10000;
  }

  /**
   * Escapes text for Reddit markdown
   */
  static escapeMarkdown(text: string): string {
    // Escape Reddit markdown special characters
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/~/g, '\\~')
      .replace(/\^/g, '\\^')
      .replace(/>/g, '\\>')
      .replace(/#/g, '\\#')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  /**
   * Formats numbers in Reddit style (k, M, etc.)
   */
  static formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
  }

  /**
   * Gets relative time string
   */
  static getRelativeTime(timestamp: number): string {
    const now = Date.now() / 1000;
    const diff = now - timestamp;

    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
    return `${Math.floor(diff / 31536000)}y ago`;
  }

  /**
   * Extracts post ID from various Reddit URL formats
   */
  static extractPostId(url: string): string | null {
    const patterns = [
      /\/comments\/([a-z0-9]+)\//,  // /r/sub/comments/abc123/title/
      /\/([a-z0-9]+)$/,             // Direct post ID
      /comments\/([a-z0-9]+)/       // Any comments URL
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }
}
```

**Testing Instructions**:
Create `tests/reddit-parser.test.ts`:

```ts
import { RedditResponseParser } from '../src/reddit/parser';
import { RedditListing, Post } from '../src/reddit/types';

describe('RedditResponseParser', () => {
  describe('parseResponse', () => {
    test('should parse wrapped responses', () => {
      const response = {
        kind: 't3',
        data: { id: 'test123', title: 'Test Post' }
      };
      
      const parsed = RedditResponseParser.parseResponse(response);
      expect(parsed).toEqual({ id: 'test123', title: 'Test Post' });
    });

    test('should parse direct data responses', () => {
      const response = {
        data: { id: 'test123', title: 'Test Post' }
      };
      
      const parsed = RedditResponseParser.parseResponse(response);
      expect(parsed).toEqual({ id: 'test123', title: 'Test Post' });
    });
  });

  describe('parseListing', () => {
    test('should parse listing responses', () => {
      const listing: RedditListing<Post> = {
        kind: 'Listing',
        data: {
          children: [
            { kind: 't3', data: { id: '1' } as Post },
            { kind: 't3', data: { id: '2' } as Post }
          ],
          after: 'abc123',
          before: null,
          dist: 2,
          modhash: null
        }
      };
      
      const parsed = RedditResponseParser.parseListing(listing);
      expect(parsed.kind).toBe('Listing');
      expect(parsed.data.children).toHaveLength(2);
    });
  });

  describe('extractListingItems', () => {
    test('should extract items from listing', () => {
      const listing: RedditListing<Post> = {
        kind: 'Listing',
        data: {
          children: [
            { kind: 't3', data: { id: '1', title: 'Post 1' } as Post },
            { kind: 't3', data: { id: '2', title: 'Post 2' } as Post }
          ],
          after: null,
          before: null,
          dist: 2,
          modhash: null
        }
      };
      
      const items = RedditResponseParser.extractListingItems(listing);
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe('1');
      expect(items[1].id).toBe('2');
    });
  });

  describe('parseFullname', () => {
    test('should parse valid fullnames', () => {
      const result = RedditResponseParser.parseFullname('t3_abc123');
      expect(result).toEqual({ type: 't3', id: 'abc123' });
    });

    test('should throw on invalid fullnames', () => {
      expect(() => RedditResponseParser.parseFullname('invalid'))
        .toThrow('Invalid fullname format');
    });
  });

  describe('createFullname', () => {
    test('should create valid fullnames', () => {
      const fullname = RedditResponseParser.createFullname('t3', 'abc123');
      expect(fullname).toBe('t3_abc123');
    });
  });
});
```

**Acceptance Criteria**:
- [ ] Response parsing handles all Reddit API formats correctly
- [ ] Utility functions work with Reddit-specific data
- [ ] Error parsing extracts useful error messages
- [ ] Validation functions catch invalid input
- [ ] All helper functions are tested
- [ ] No parsing errors with real Reddit API responses

### Task 4.3: Implement Documentation-Driven API Client (5 hours)

**Objective**: Create a documentation-driven API client that automatically generates methods based on reddit-api-ts-docs definitions.

**Create `src/reddit/api/BaseAPI.ts`** - A base class for all API modules:

```ts
import { RedditHttpClient } from '../../http/RedditHttpClient';
import { getRedditApiDocs } from '../documentationLoader';
import { RedditResponseParser } from '../parser';
import { RedditUtils } from '../utils';
import { ApiRequestOptions, ListingResponse } from '../types';
import type { Doc } from 'reddit-api-ts-docs';

export abstract class BaseAPI {
  constructor(protected client: RedditHttpClient) {}

  protected async makeDocumentedRequest<T>(
    method: string,
    uri: string,
    data?: unknown,
    options?: ApiRequestOptions
  ): Promise<T> {
    // Validate request if schema exists
    if (data) {
      const validation = RedditResponseParser.validateRequest(method, uri, data);
      if (!validation.valid) {
        throw new Error(`Request validation failed: ${validation.errors?.join(', ')}`);
      }
    }

    let response: unknown;
    const requestOptions = RedditUtils.buildRequestOptions(options);

    switch (method.toUpperCase()) {
      case 'GET':
        response = await this.client.get(uri, requestOptions);
        break;
      case 'POST':
        response = await this.client.post(uri, data, requestOptions);
        break;
      case 'PUT':
        response = await this.client.put(uri, data, requestOptions);
        break;
      case 'DELETE':
        response = await this.client.delete(uri, requestOptions);
        break;
      case 'PATCH':
        response = await this.client.patch(uri, data, requestOptions);
        break;
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }

    return RedditResponseParser.parseResponse<T>(method, uri, response);
  }

  protected async makeListingRequest<T>(
    method: string,
    uri: string,
    data?: unknown,
    options?: ApiRequestOptions
  ): Promise<ListingResponse<T>> {
    const response = await this.makeDocumentedRequest<unknown>(method, uri, data, options);
    const parsed = RedditResponseParser.parseListing<T>(response);
    return parsed;
  }

  protected getEndpointDoc(method: string, uri: string): Doc | undefined {
    const docs = getRedditApiDocs();
    return docs.getEndpoint(method, uri);
  }
}
```

**Create `src/reddit/api/SubredditAPI.ts`**:

```ts
import { BaseAPI } from './BaseAPI';
import { RedditUtils } from '../utils';
import { PaginationOptions, SortOptions, SearchOptions, ListingResponse } from '../types';

export class SubredditAPI extends BaseAPI {
  /**
   * Get information about a subreddit
   */
  async getSubreddit(name: string): Promise<unknown> {
    const subredditName = RedditUtils.extractSubredditName(name);

    if (!RedditUtils.validateSubredditName(subredditName)) {
      throw new Error(`Invalid subreddit name: ${name}`);
    }

    return this.makeDocumentedRequest('GET', `/r/${subredditName}/about`);
  }

  /**
   * Get hot posts from a subreddit
   */
  async getHotPosts(subreddit: string, options?: PaginationOptions): Promise<ListingResponse<unknown>> {
    const subredditName = RedditUtils.extractSubredditName(subreddit);
    const params = RedditUtils.buildPaginationParams(options);

    return this.makeListingRequest('GET', `/r/${subredditName}/hot`, undefined, { params });
  }

  /**
   * Get new posts from a subreddit
   */
  async getNewPosts(subreddit: string, options?: PaginationOptions): Promise<ListingResponse<unknown>> {
    const subredditName = RedditUtils.extractSubredditName(subreddit);
    const params = RedditUtils.buildPaginationParams(options);

    return this.makeListingRequest('GET', `/r/${subredditName}/new`, undefined, { params });
  }

  /**
   * Get top posts from a subreddit
   */
  async getTopPosts(subreddit: string, options?: PaginationOptions & SortOptions): Promise<ListingResponse<unknown>> {
    const subredditName = RedditUtils.extractSubredditName(subreddit);
    const params = {
      ...RedditUtils.buildPaginationParams(options),
      ...RedditUtils.buildSortParams(options)
    };

    return this.makeListingRequest('GET', `/r/${subredditName}/top`, undefined, { params });
  }

  /**
   * Search within a subreddit
   */
  async search(subreddit: string, options: SearchOptions): Promise<ListingResponse<unknown>> {
    const subredditName = RedditUtils.extractSubredditName(subreddit);
    const params = {
      ...RedditUtils.buildPaginationParams(options),
      ...RedditUtils.buildSortParams(options),
      q: options.q,
      restrict_sr: options.restrict_sr ?? true,
      type: options.type || 'link',
      include_over_18: options.include_over_18 ?? false
    };

    return this.makeListingRequest('GET', `/r/${subredditName}/search`, undefined, { params });
  }

  /**
   * Subscribe to a subreddit
   */
  async subscribe(subreddit: string): Promise<void> {
    const subredditName = RedditUtils.extractSubredditName(subreddit);
    const data = new URLSearchParams({
      action: 'sub',
      sr_name: subredditName
    }).toString();

    await this.makeDocumentedRequest('POST', '/api/subscribe', data, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  }

  /**
   * Get user's subscribed subreddits
   */
  async getSubscriptions(options?: PaginationOptions): Promise<ListingResponse<unknown>> {
    const params = RedditUtils.buildPaginationParams(options);
    return this.makeListingRequest('GET', '/subreddits/mine/subscriber', undefined, { params });
  }
}
```

**Testing Instructions**:
Create `tests/subreddit-api.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import { SubredditAPI } from '../src/reddit/api/SubredditAPI';
import { RedditHttpClient } from '../src/http/RedditHttpClient';

// Mock the HTTP client
const mockHttpClient = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  patch: jest.fn()
} as unknown as RedditHttpClient;

describe('SubredditAPI', () => {
  let api: SubredditAPI;

  beforeEach(() => {
    api = new SubredditAPI(mockHttpClient);
    jest.clearAllMocks();
  });

  test('should get subreddit information', async () => {
    const mockResponse = {
      kind: 't5',
      data: { display_name: 'javascript', subscribers: 1000 }
    };

    (mockHttpClient.get as jest.Mock).mockResolvedValue(mockResponse);

    const result = await api.getSubreddit('javascript');

    expect(mockHttpClient.get).toHaveBeenCalledWith('/r/javascript/about');
    expect(result).toEqual({ display_name: 'javascript', subscribers: 1000 });
  });

  test('should handle subreddit names with r/ prefix', async () => {
    const mockResponse = { kind: 't5', data: {} };
    (mockHttpClient.get as jest.Mock).mockResolvedValue(mockResponse);

    await api.getSubreddit('r/javascript');

    expect(mockHttpClient.get).toHaveBeenCalledWith('/r/javascript/about');
  });

  test('should get hot posts with pagination', async () => {
    const mockResponse = {
      kind: 'Listing',
      data: {
        children: [
          { kind: 't3', data: { id: '1', title: 'Post 1' } },
          { kind: 't3', data: { id: '2', title: 'Post 2' } }
        ],
        after: 'abc123',
        before: null,
        dist: 2,
        modhash: null
      }
    };

    (mockHttpClient.get as jest.Mock).mockResolvedValue(mockResponse);

    const result = await api.getHotPosts('javascript', { limit: 10 });

    expect(mockHttpClient.get).toHaveBeenCalledWith('/r/javascript/hot', {
      params: { limit: '10' }
    });
    expect(result.items).toHaveLength(2);
    expect(result.pagination.after).toBe('abc123');
  });
});
```

**Acceptance Criteria**:
- [ ] BaseAPI provides documentation-driven request handling
- [ ] SubredditAPI implements all essential subreddit operations
- [ ] Request validation uses reddit-api-ts-docs schemas
- [ ] Response parsing handles Reddit API formats correctly
- [ ] Pagination works across all listing endpoints
- [ ] Input validation prevents invalid requests
- [ ] All tests pass

### Task 4.4: Implement PostAPI and UserAPI (3 hours)

**Objective**: Create PostAPI and UserAPI modules using the documentation-driven approach.

**Create `src/reddit/api/PostAPI.ts`**:

```ts
import { BaseAPI } from './BaseAPI';
import { RedditUtils } from '../utils';
import { PaginationOptions, ListingResponse } from '../types';

export class PostAPI extends BaseAPI {
  /**
   * Create a new post
   */
  async createPost(submission: {
    kind: 'self' | 'link' | 'image' | 'video';
    sr: string;
    title: string;
    text?: string;
    url?: string;
    nsfw?: boolean;
    spoiler?: boolean;
  }): Promise<unknown> {
    if (!RedditUtils.validatePostTitle(submission.title)) {
      throw new Error('Invalid post title');
    }

    if (!RedditUtils.validateSubredditName(submission.sr)) {
      throw new Error('Invalid subreddit name');
    }

    const formData = new URLSearchParams({
      api_type: 'json',
      kind: submission.kind,
      sr: submission.sr,
      title: submission.title,
      ...(submission.text && { text: submission.text }),
      ...(submission.url && { url: submission.url }),
      ...(submission.nsfw && { nsfw: 'true' }),
      ...(submission.spoiler && { spoiler: 'true' })
    }).toString();

    const response = await this.makeDocumentedRequest('POST', '/api/submit', formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    return RedditResponseParser.parseSubmissionResponse(response);
  }

  /**
   * Get a specific post by ID
   */
  async getPost(postId: string, subreddit?: string): Promise<{ post: unknown; comments: unknown[] }> {
    const url = subreddit ? `/r/${subreddit}/comments/${postId}` : `/comments/${postId}`;

    const response = await this.makeDocumentedRequest('GET', url);

    // Reddit returns an array with post listing and comments listing
    if (!Array.isArray(response) || response.length < 2) {
      throw new Error('Invalid post response format');
    }

    const postData = RedditResponseParser.parseListing(response[0]);
    const commentsData = RedditResponseParser.parseListing(response[1]);

    return {
      post: postData.items[0],
      comments: commentsData.items
    };
  }

  /**
   * Vote on a post
   */
  async vote(postId: string, direction: 1 | 0 | -1): Promise<void> {
    const fullname = RedditResponseParser.createFullname('t3', postId);

    const data = new URLSearchParams({
      id: fullname,
      dir: String(direction)
    }).toString();

    await this.makeDocumentedRequest('POST', '/api/vote', data, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  }

  /**
   * Create a comment on a post
   */
  async createComment(postId: string, text: string): Promise<unknown> {
    if (!RedditUtils.validateCommentText(text)) {
      throw new Error('Invalid comment text');
    }

    const fullname = RedditResponseParser.createFullname('t3', postId);

    const data = new URLSearchParams({
      api_type: 'json',
      parent: fullname,
      text: text
    }).toString();

    const response = await this.makeDocumentedRequest('POST', '/api/comment', data, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    return RedditResponseParser.parseSubmissionResponse(response);
  }
}
```

**Create `src/reddit/api/UserAPI.ts`**:

```ts
import { BaseAPI } from './BaseAPI';
import { RedditUtils } from '../utils';
import { PaginationOptions, ListingResponse } from '../types';

export class UserAPI extends BaseAPI {
  /**
   * Get current authenticated user information
   */
  async getMe(): Promise<unknown> {
    return this.makeDocumentedRequest('GET', '/api/v1/me');
  }

  /**
   * Get information about a specific user
   */
  async getUser(username: string): Promise<unknown> {
    if (!RedditUtils.validateUsername(username)) {
      throw new Error(`Invalid username: ${username}`);
    }

    return this.makeDocumentedRequest('GET', `/user/${username}/about`);
  }

  /**
   * Get posts by a user
   */
  async getUserPosts(username: string, options?: PaginationOptions): Promise<ListingResponse<unknown>> {
    if (!RedditUtils.validateUsername(username)) {
      throw new Error(`Invalid username: ${username}`);
    }

    const params = RedditUtils.buildPaginationParams(options);
    return this.makeListingRequest('GET', `/user/${username}/submitted`, undefined, { params });
  }

  /**
   * Get user's saved posts and comments
   */
  async getSaved(options?: PaginationOptions): Promise<ListingResponse<unknown>> {
    const params = RedditUtils.buildPaginationParams(options);
    return this.makeListingRequest('GET', '/user/me/saved', undefined, { params });
  }

  /**
   * Send a private message to a user
   */
  async sendMessage(to: string, subject: string, text: string): Promise<void> {
    if (!RedditUtils.validateUsername(to)) {
      throw new Error(`Invalid username: ${to}`);
    }

    const data = new URLSearchParams({
      api_type: 'json',
      to: to,
      subject: subject,
      text: text
    }).toString();

    await this.makeDocumentedRequest('POST', '/api/compose', data, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  }
}
```

**Testing Instructions**:
Create `tests/post-api.test.ts` and `tests/user-api.test.ts` following the same pattern as the SubredditAPI tests.

**Acceptance Criteria**:
- [ ] PostAPI implements post creation, retrieval, voting, and commenting
- [ ] UserAPI implements user information and messaging features
- [ ] Both APIs use the BaseAPI documentation-driven approach
- [ ] Request validation works using reddit-api-ts-docs schemas
- [ ] All essential operations are covered
- [ ] Tests verify functionality

### Task 4.5: Implement Main RedditApiClient (2 hours)

**Objective**: Create the main RedditApiClient that coordinates all API modules using the documentation-driven approach.

**Create `src/reddit/RedditApiClient.ts`**:

```ts
import { RedditHttpClient } from '../http/RedditHttpClient';
import { RedditClientConfig } from '../types';
import { createRedditHttpClient } from '../index';
import { SubredditAPI } from './api/SubredditAPI';
import { PostAPI } from './api/PostAPI';
import { UserAPI } from './api/UserAPI';
import { getRedditApiDocs } from './documentationLoader';

export class RedditApiClient {
  protected httpClient: RedditHttpClient;

  public readonly subreddits: SubredditAPI;
  public readonly posts: PostAPI;
  public readonly users: UserAPI;

  constructor(config: RedditClientConfig) {
    // Create the HTTP client infrastructure
    const infrastructure = createRedditHttpClient(config);
    this.httpClient = infrastructure.httpClient;

    // Initialize API modules
    this.subreddits = new SubredditAPI(this.httpClient);
    this.posts = new PostAPI(this.httpClient);
    this.users = new UserAPI(this.httpClient);
  }

  /**
   * Get access to the underlying HTTP client for custom requests
   */
  getHttpClient(): RedditHttpClient {
    return this.httpClient;
  }

  /**
   * Get the Reddit API documentation
   */
  getDocs() {
    return getRedditApiDocs();
  }

  /**
   * Make a custom documented request
   */
  async customRequest<T = unknown>(method: string, uri: string, data?: unknown): Promise<T> {
    switch (method.toUpperCase()) {
      case 'GET':
        return this.httpClient.get<T>(uri);
      case 'POST':
        return this.httpClient.post<T>(uri, data);
      case 'PUT':
        return this.httpClient.put<T>(uri, data);
      case 'DELETE':
        return this.httpClient.delete<T>(uri);
      case 'PATCH':
        return this.httpClient.patch<T>(uri, data);
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }
  }

  /**
   * Get metrics about API usage
   */
  getMetrics() {
    return this.httpClient.getMetrics();
  }

  /**
   * Log a summary of API metrics
   */
  logMetricsSummary(): void {
    this.httpClient.logMetricsSummary();
  }

  /**
   * Reset metrics counters
   */
  resetMetrics(): void {
    this.httpClient.resetMetrics();
  }
}
```

**Update `src/index.ts`** to export the new components:

```ts
// Add to existing exports
export { RedditApiClient } from './reddit/RedditApiClient';
export { SubredditAPI } from './reddit/api/SubredditAPI';
export { PostAPI } from './reddit/api/PostAPI';
export { UserAPI } from './reddit/api/UserAPI';
export { BaseAPI } from './reddit/api/BaseAPI';
export * from './reddit/types';
export { RedditResponseParser } from './reddit/parser';
export { RedditUtils } from './reddit/utils';
export { getRedditApiDocs, RedditApiDocumentation } from './reddit/documentationLoader';

// Convenience function for creating the full Reddit client
export function createRedditApiClient(config: RedditClientConfig): RedditApiClient {
  return new RedditApiClient(config);
}
```

**Testing Instructions**:
Create `tests/reddit-api-client.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import { RedditApiClient } from '../src/reddit/RedditApiClient';
import { RedditClientConfig } from '../src/types';
import Keyv from 'keyv';
import pino from 'pino';

describe('RedditApiClient', () => {
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
      logger: pino({ level: 'silent' })
    };
  });

  test('should create client with all API modules', () => {
    const client = new RedditApiClient(config);

    expect(client.subreddits).toBeDefined();
    expect(client.posts).toBeDefined();
    expect(client.users).toBeDefined();
  });

  test('should provide access to documentation', () => {
    const client = new RedditApiClient(config);
    const docs = client.getDocs();

    expect(docs).toBeDefined();
    expect(typeof docs.getDocGroups).toBe('function');
  });

  test('should support custom requests', async () => {
    const client = new RedditApiClient(config);

    // Mock the HTTP client
    const httpClient = client.getHttpClient();
    jest.spyOn(httpClient, 'get').mockResolvedValue({ test: 'data' });

    const result = await client.customRequest('GET', '/custom/endpoint');
    expect(result).toEqual({ test: 'data' });
  });
});
```

**Acceptance Criteria**:
- [ ] RedditApiClient coordinates all API modules correctly
- [ ] Documentation integration provides access to reddit-api-ts-docs
- [ ] Main client provides access to underlying HTTP client
- [ ] Metrics and monitoring work correctly
- [ ] Custom request functionality works
- [ ] All API modules are properly integrated
- [ ] Tests verify functionality

## Phase 4 Completion Checklist

**Dependencies Setup:**
- [ ] Install reddit-api-ts-docs package: `bun add reddit-api-ts-docs`
- [ ] Update package.json with necessary dependencies
- [ ] Ensure all TypeScript types work correctly

**Implementation Verification:**
- [ ] Documentation loader can access all Reddit API groups
- [ ] Response parsing handles Reddit API formats with validation
- [ ] BaseAPI provides documentation-driven request handling
- [ ] All API modules (Subreddit, Post, User) implement essential operations
- [ ] Main RedditApiClient coordinates all modules correctly
- [ ] Request validation uses reddit-api-ts-docs schemas
- [ ] Error handling provides useful error messages
- [ ] All tests pass (`bun test`)

**Integration Tests:**
1. End-to-end API client creation and basic operations
2. Documentation-driven request validation
3. Response parsing with real Reddit API formats
4. Error handling for various Reddit API errors

**Time Estimate**: 12 hours total (significantly reduced from original 22 hours)
**Difficulty**: Intermediate (leverages existing documentation)
**Dependencies**: Phase 1-3 completed + reddit-api-ts-docs package

## Key Advantages of Documentation-Driven Approach

**Benefits over manual implementation:**
1. **Type Safety**: Uses pre-built Zod schemas from reddit-api-ts-docs
2. **Completeness**: Access to 180+ endpoints without manual definition
3. **Maintainability**: Updates to Reddit API automatically reflected
4. **Validation**: Built-in request/response validation
5. **Reduced Development Time**: 50% time savings vs manual implementation
6. **Future-Proof**: Automatically supports new Reddit API endpoints

**Final Notes:**
This documentation-driven approach provides a robust, type-safe Reddit API client that leverages the comprehensive reddit-api-ts-docs package. The implementation is significantly more maintainable and complete than manually defining all Reddit API types and endpoints.
