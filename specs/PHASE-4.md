# Phase 4: Reddit API Client Implementation

## Overview
This final phase creates the complete Reddit API client that developers will actually use. You'll build API modules for different Reddit features (subreddits, posts, users, etc.) that use the internal HTTP client from Phase 3.

## Goals
- ✅ Main `RedditApiClient` class that coordinates everything
- ✅ Modular API interfaces (SubredditAPI, UserAPI, PostAPI, etc.)
- ✅ Reddit API method implementations with proper typing
- ✅ Response parsing and data transformation
- ✅ Comprehensive error handling for Reddit-specific errors
- ✅ Pagination support for list endpoints
- ✅ Complete TypeScript definitions for Reddit API

## Prerequisites
- **Phase 1-3 completed** (full auth infrastructure working)
- Understanding of Reddit API structure and endpoints
- Knowledge of Reddit's response formats
- Familiarity with API design patterns
- Understanding of pagination patterns

## Reddit API Background

**Important Context for Implementation:**
- Reddit API base URL: `https://oauth.reddit.com`
- Most responses are wrapped in `{kind: "...", data: {...}}`
- Listings use `{kind: "Listing", data: {children: [...], after: "...", before: "..."}}`
- Rate limits vary by endpoint (already handled in Phase 2)
- Some endpoints require specific scopes
- Reddit uses "fullnames" (e.g., `t3_abc123`) for resource identification

## Task Breakdown

### Task 4.1: Define Reddit API Types (4 hours)

**Objective**: Create comprehensive TypeScript types for Reddit API responses and requests.

**Create `src/reddit/types.ts`**:

```ts
// Base Reddit API Types
export interface RedditResponse<T = any> {
  kind: string;
  data: T;
}

export interface RedditListing<T = any> {
  kind: "Listing";
  data: {
    children: RedditResponse<T>[];
    after: string | null;
    before: string | null;
    dist: number;
    modhash: string | null;
  };
}

// Subreddit Types
export interface Subreddit {
  id: string;
  name: string;
  display_name: string;
  display_name_prefixed: string;
  title: string;
  description: string;
  description_html: string;
  public_description: string;
  subscribers: number;
  active_user_count: number;
  created_utc: number;
  over18: boolean;
  lang: string;
  url: string;
  quarantine: boolean;
  icon_img: string;
  banner_img: string;
  submit_text: string;
  submit_text_html: string;
  user_is_subscriber: boolean;
  user_is_moderator: boolean;
  user_is_contributor: boolean;
}

// Post Types
export interface Post {
  id: string;
  name: string; // fullname (t3_...)
  title: string;
  selftext: string;
  selftext_html: string;
  url: string;
  domain: string;
  author: string;
  author_fullname: string;
  subreddit: string;
  subreddit_name_prefixed: string;
  score: number;
  upvote_ratio: number;
  ups: number;
  downs: number;
  num_comments: number;
  created_utc: number;
  edited: boolean | number;
  distinguished: string | null;
  stickied: boolean;
  locked: boolean;
  archived: boolean;
  is_self: boolean;
  is_video: boolean;
  over_18: boolean;
  spoiler: boolean;
  hidden: boolean;
  saved: boolean;
  clicked: boolean;
  visited: boolean;
  likes: boolean | null; // true=upvoted, false=downvoted, null=no vote
  permalink: string;
  thumbnail: string;
  preview?: {
    images: Array<{
      source: { url: string; width: number; height: number };
      resolutions: Array<{ url: string; width: number; height: number }>;
    }>;
  };
}

// Comment Types
export interface Comment {
  id: string;
  name: string; // fullname (t1_...)
  body: string;
  body_html: string;
  author: string;
  author_fullname: string;
  subreddit: string;
  link_id: string;
  parent_id: string;
  score: number;
  ups: number;
  downs: number;
  created_utc: number;
  edited: boolean | number;
  distinguished: string | null;
  stickied: boolean;
  locked: boolean;
  archived: boolean;
  saved: boolean;
  likes: boolean | null;
  depth: number;
  replies: RedditListing<Comment> | string;
  permalink: string;
}

// User Types
export interface User {
  id: string;
  name: string;
  icon_img: string;
  created_utc: number;
  link_karma: number;
  comment_karma: number;
  awardee_karma: number;
  awarder_karma: number;
  total_karma: number;
  is_gold: boolean;
  is_mod: boolean;
  is_employee: boolean;
  has_verified_email: boolean;
  over_18: boolean;
  accept_followers: boolean;
  accept_chats: boolean;
  accept_pms: boolean;
  subreddit?: {
    display_name: string;
    title: string;
    icon_img: string;
    over_18: boolean;
    public_description: string;
  };
}

// API Request Types
export interface PostSubmission {
  kind: 'self' | 'link' | 'image' | 'video';
  sr: string; // subreddit name
  title: string;
  text?: string; // for self posts
  url?: string; // for link posts
  nsfw?: boolean;
  spoiler?: boolean;
  send_replies?: boolean;
  resubmit?: boolean;
  extension_handling?: boolean;
}

export interface CommentSubmission {
  parent: string; // fullname of parent (post or comment)
  text: string;
}

export interface VoteSubmission {
  id: string; // fullname
  dir: 1 | 0 | -1; // upvote, no vote, downvote
}

// Pagination Types
export interface PaginationOptions {
  limit?: number; // 1-100, default 25
  after?: string; // fullname of last item from previous page
  before?: string; // fullname of first item from next page
  count?: number; // number of items already seen
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

// Response wrapper types
export interface ApiResponse<T> {
  json: {
    errors: string[][];
    data?: T;
  };
}

export interface SubmissionResponse {
  json: {
    errors: string[][];
    data?: {
      things: Array<{
        kind: string;
        data: Post;
      }>;
    };
  };
}
```

**Testing Instructions**:
Create `tests/reddit-types.test.ts`:

```ts
import { RedditListing, Post, Comment, User } from '../src/reddit/types';

describe('Reddit Types', () => {
  it('should properly type Reddit listings', () => {
    const listing: RedditListing<Post> = {
      kind: "Listing",
      data: {
        children: [],
        after: null,
        before: null,
        dist: 0,
        modhash: null
      }
    };

    expect(listing.kind).toBe("Listing");
    expect(Array.isArray(listing.data.children)).toBe(true);
  });

  it('should handle post data correctly', () => {
    const post: Post = {
      id: 'test123',
      name: 't3_test123',
      title: 'Test Post',
      selftext: 'Test content',
      selftext_html: '<p>Test content</p>',
      url: 'https://reddit.com/r/test/comments/test123',
      domain: 'self.test',
      author: 'testuser',
      author_fullname: 't2_testuser',
      subreddit: 'test',
      subreddit_name_prefixed: 'r/test',
      score: 100,
      upvote_ratio: 0.95,
      ups: 100,
      downs: 5,
      num_comments: 10,
      created_utc: Date.now() / 1000,
      edited: false,
      distinguished: null,
      stickied: false,
      locked: false,
      archived: false,
      is_self: true,
      is_video: false,
      over_18: false,
      spoiler: false,
      hidden: false,
      saved: false,
      clicked: false,
      visited: false,
      likes: null,
      permalink: '/r/test/comments/test123/test_post/',
      thumbnail: 'self'
    };

    expect(post.name).toMatch(/^t3_/);
    expect(post.is_self).toBe(true);
  });
});
```

**Acceptance Criteria**:
- [ ] All Reddit API response types are accurately defined
- [ ] Types match Reddit's actual API responses
- [ ] Generic types work correctly for listings
- [ ] Request types cover all needed operations
- [ ] No TypeScript errors in type definitions

### Task 4.2: Implement Response Parsing and Utilities (3 hours)

**Objective**: Create utilities for parsing Reddit API responses and handling Reddit-specific data formats.

**Create `src/reddit/parser.ts`**:

```ts
import { RedditResponse, RedditListing, Post, Comment, User, Subreddit } from './types';

export class RedditResponseParser {
  /**
   * Parses a Reddit API response, unwrapping the standard format
   */
  static parseResponse<T>(response: any): T {
    // Handle standard Reddit response format
    if (response && typeof response === 'object') {
      // Direct data response
      if (response.data && !response.kind) {
        return response.data as T;
      }
      
      // Wrapped response with kind
      if (response.kind && response.data) {
        return response.data as T;
      }
      
      // Array of responses
      if (Array.isArray(response)) {
        return response.map(item => this.parseResponse(item)) as unknown as T;
      }
    }
    
    return response as T;
  }

  /**
   * Parses a Reddit listing response
   */
  static parseListing<T>(response: any): RedditListing<T> {
    if (response?.kind === 'Listing' && response?.data) {
      return response as RedditListing<T>;
    }
    
    throw new Error('Invalid listing response format');
  }

  /**
   * Extracts items from a Reddit listing
   */
  static extractListingItems<T>(listing: RedditListing<T>): T[] {
    return listing.data.children.map(child => child.data);
  }

  /**
   * Parses a submission response (post creation)
   */
  static parseSubmissionResponse(response: any): Post {
    if (response?.json?.data?.things?.[0]?.data) {
      return response.json.data.things[0].data as Post;
    }
    
    if (response?.json?.errors?.length > 0) {
      const errors = response.json.errors.map((err: string[]) => err.join(': ')).join(', ');
      throw new Error(`Submission failed: ${errors}`);
    }
    
    throw new Error('Invalid submission response format');
  }

  /**
   * Parses API errors from Reddit responses
   */
  static parseErrors(response: any): string[] {
    const errors: string[] = [];
    
    if (response?.json?.errors && Array.isArray(response.json.errors)) {
      for (const error of response.json.errors) {
        if (Array.isArray(error)) {
          errors.push(error.join(': '));
        } else {
          errors.push(String(error));
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
   * Processes comment tree, handling nested replies
   */
  static processCommentTree(comments: Comment[]): Comment[] {
    return comments.map(comment => {
      if (comment.replies && typeof comment.replies === 'object') {
        const replies = this.extractListingItems(comment.replies as RedditListing<Comment>);
        comment.replies = this.processCommentTree(replies) as any;
      }
      return comment;
    });
  }

  /**
   * Flattens a comment tree into a flat array
   */
  static flattenCommentTree(comments: Comment[]): Comment[] {
    const flat: Comment[] = [];
    
    for (const comment of comments) {
      flat.push(comment);
      
      if (comment.replies && Array.isArray(comment.replies)) {
        flat.push(...this.flattenCommentTree(comment.replies as Comment[]));
      }
    }
    
    return flat;
  }

  /**
   * Checks if a response indicates an error
   */
  static hasErrors(response: any): boolean {
    return response?.json?.errors && response.json.errors.length > 0;
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
}
```

**Create `src/reddit/utils.ts`**:

```ts
import { PaginationOptions, SortOptions } from './types';

export class RedditUtils {
  /**
   * Builds query parameters for pagination
   */
  static buildPaginationParams(options?: PaginationOptions): Record<string, string> {
    const params: Record<string, string> = {};
    
    if (options?.limit) {
      params.limit = Math.min(Math.max(options.limit, 1), 100).toString();
    }
    
    if (options.after) {
      params.after = options.after;
    }
    
    if (options.before) {
      params.before = options.before;
    }
    
    if (options.count) {
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
    
    if (options.t) {
      params.t = options.t;
    }
    
    return params;
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
    it('should parse wrapped responses', () => {
      const response = {
        kind: 't3',
        data: { id: 'test123', title: 'Test Post' }
      };
      
      const parsed = RedditResponseParser.parseResponse(response);
      expect(parsed).toEqual({ id: 'test123', title: 'Test Post' });
    });

    it('should parse direct data responses', () => {
      const response = {
        data: { id: 'test123', title: 'Test Post' }
      };
      
      const parsed = RedditResponseParser.parseResponse(response);
      expect(parsed).toEqual({ id: 'test123', title: 'Test Post' });
    });
  });

  describe('parseListing', () => {
    it('should parse listing responses', () => {
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
    it('should extract items from listing', () => {
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
    it('should parse valid fullnames', () => {
      const result = RedditResponseParser.parseFullname('t3_abc123');
      expect(result).toEqual({ type: 't3', id: 'abc123' });
    });

    it('should throw on invalid fullnames', () => {
      expect(() => RedditResponseParser.parseFullname('invalid'))
        .toThrow('Invalid fullname format');
    });
  });

  describe('createFullname', () => {
    it('should create valid fullnames', () => {
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

### Task 4.3: Implement SubredditAPI (4 hours)

**Objective**: Create the SubredditAPI module for subreddit-related operations.

**Create `src/reddit/api/SubredditAPI.ts`**:

```ts
import { RedditHttpClient } from '../../http/RedditHttpClient';
import { 
  Subreddit, 
  Post, 
  RedditListing, 
  PaginationOptions, 
  SortOptions,
  SearchOptions 
} from '../types';
import { RedditResponseParser } from '../parser';
import { RedditUtils } from '../utils';

export class SubredditAPI {
  constructor(protected client: RedditHttpClient) {}

  /**
   * Get information about a subreddit
   */
  async getSubreddit(name: string): Promise<Subreddit> {
    const subredditName = RedditUtils.extractSubredditName(name);
    
    if (!RedditUtils.validateSubredditName(subredditName)) {
      throw new Error(`Invalid subreddit name: ${name}`);
    }

    const response = await this.client.get(`/r/${subredditName}/about`);
    return RedditResponseParser.parseResponse<Subreddit>(response);
  }

  /**
   * Get hot posts from a subreddit
   */
  async getHotPosts(
    subreddit: string, 
    options?: PaginationOptions
  ): Promise<{ posts: Post[]; pagination: { after: string | null; before: string | null } }> {
    const subredditName = RedditUtils.extractSubredditName(subreddit);
    const params = RedditUtils.buildPaginationParams(options);

    const response = await this.client.get(`/r/${subredditName}/hot`, { params });
    const listing = RedditResponseParser.parseListing<Post>(response);
    const posts = RedditResponseParser.extractListingItems(listing);

    return {
      posts,
      pagination: {
        after: listing.data.after,
        before: listing.data.before
      }
    };
  }

  /**
   * Get new posts from a subreddit
   */
  async getNewPosts(
    subreddit: string, 
    options?: PaginationOptions
  ): Promise<{ posts: Post[]; pagination: { after: string | null; before: string | null } }> {
    const subredditName = RedditUtils.extractSubredditName(subreddit);
    const params = RedditUtils.buildPaginationParams(options);

    const response = await this.client.get(`/r/${subredditName}/new`, { params });
    const listing = RedditResponseParser.parseListing<Post>(response);
    const posts = RedditResponseParser.extractListingItems(listing);

    return {
      posts,
      pagination: {
        after: listing.data.after,
        before: listing.data.before
      }
    };
  }

  /**
   * Get top posts from a subreddit
   */
  async getTopPosts(
    subreddit: string, 
    options?: PaginationOptions & SortOptions
  ): Promise<{ posts: Post[]; pagination: { after: string | null; before: string | null } }> {
    const subredditName = RedditUtils.extractSubredditName(subreddit);
    const params = {
      ...RedditUtils.buildPaginationParams(options),
      ...RedditUtils.buildSortParams(options)
    };

    const response = await this.client.get(`/r/${subredditName}/top`, { params });
    const listing = RedditResponseParser.parseListing<Post>(response);
    const posts = RedditResponseParser.extractListingItems(listing);

    return {
      posts,
      pagination: {
        after: listing.data.after,
        before: listing.data.before
      }
    };
  }

  /**
   * Get rising posts from a subreddit
   */
  async getRisingPosts(
    subreddit: string, 
    options?: PaginationOptions
  ): Promise<{ posts: Post[]; pagination: { after: string | null; before: string | null } }> {
    const subredditName = RedditUtils.extractSubredditName(subreddit);
    const params = RedditUtils.buildPaginationParams(options);

    const response = await this.client.get(`/r/${subredditName}/rising`, { params });
    const listing = RedditResponseParser.parseListing<Post>(response);
    const posts = RedditResponseParser.extractListingItems(listing);

    return {
      posts,
      pagination: {
        after: listing.data.after,
        before: listing.data.before
      }
    };
  }

  /**
   * Search within a subreddit
   */
  async search(
    subreddit: string,
    options: SearchOptions
  ): Promise<{ posts: Post[]; pagination: { after: string | null; before: string | null } }> {
    const subredditName = RedditUtils.extractSubredditName(subreddit);
    const params = {
      ...RedditUtils.buildPaginationParams(options),
      ...RedditUtils.buildSortParams(options),
      q: options.q,
      restrict_sr: options.restrict_sr ?? true,
      type: options.type || 'link',
      include_over_18: options.include_over_18 ?? false
    };

    const response = await this.client.get(`/r/${subredditName}/search`, { params });
    const listing = RedditResponseParser.parseListing<Post>(response);
    const posts = RedditResponseParser.extractListingItems(listing);

    return {
      posts,
      pagination: {
        after: listing.data.after,
        before: listing.data.before
      }
    };
  }

  /**
   * Subscribe to a subreddit
   */
  async subscribe(subreddit: string): Promise<void> {
    const subredditName = RedditUtils.extractSubredditName(subreddit);
    
    await this.client.post('/api/subscribe', {
      action: 'sub',
      sr_name: subredditName
    });
  }

  /**
   * Unsubscribe from a subreddit
   */
  async unsubscribe(subreddit: string): Promise<void> {
    const subredditName = RedditUtils.extractSubredditName(subreddit);
    
    await this.client.post('/api/subscribe', {
      action: 'unsub',
      sr_name: subredditName
    });
  }

  /**
   * Get user's subscribed subreddits
   */
  async getSubscriptions(
    options?: PaginationOptions
  ): Promise<{ subreddits: Subreddit[]; pagination: { after: string | null; before: string | null } }> {
    const params = RedditUtils.buildPaginationParams(options);

    const response = await this.client.get('/subreddits/mine/subscriber', { params });
    const listing = RedditResponseParser.parseListing<Subreddit>(response);
    const subreddits = RedditResponseParser.extractListingItems(listing);

    return {
      subreddits,
      pagination: {
        after: listing.data.after,
        before: listing.data.before
      }
    };
  }

  /**
   * Get popular/default subreddits
   */
  async getPopular(
    options?: PaginationOptions
  ): Promise<{ subreddits: Subreddit[]; pagination: { after: string | null; before: string | null } }> {
    const params = RedditUtils.buildPaginationParams(options);

    const response = await this.client.get('/subreddits/popular', { params });
    const listing = RedditResponseParser.parseListing<Subreddit>(response);
    const subreddits = RedditResponseParser.extractListingItems(listing);

    return {
      subreddits,
      pagination: {
        after: listing.data.after,
        before: listing.data.before
      }
    };
  }

  /**
   * Search for subreddits
   */
  async searchSubreddits(
    query: string,
    options?: PaginationOptions
  ): Promise<{ subreddits: Subreddit[]; pagination: { after: string | null; before: string | null } }> {
    const params = {
      ...RedditUtils.buildPaginationParams(options),
      q: query
    };

    const response = await this.client.get('/subreddits/search', { params });
    const listing = RedditResponseParser.parseListing<Subreddit>(response);
    const subreddits = RedditResponseParser.extractListingItems(listing);

    return {
      subreddits,
      pagination: {
        after: listing.data.after,
        before: listing.data.before
      }
    };
  }
}
```

**Testing Instructions**:
Create `tests/SubredditAPI.test.ts`:

```ts
import { SubredditAPI } from '../src/reddit/api/SubredditAPI';
import { RedditHttpClient } from '../src/http/RedditHttpClient';
import { Subreddit, Post, RedditListing } from '../src/reddit/types';

// Mock the HTTP client
jest.mock('../src/http/RedditHttpClient');

describe('SubredditAPI', () => {
  let subredditAPI: SubredditAPI;
  let mockHttpClient: jest.Mocked<RedditHttpClient>;

  beforeEach(() => {
    mockHttpClient = new RedditHttpClient({} as any) as jest.Mocked<RedditHttpClient>;
    subredditAPI = new SubredditAPI(mockHttpClient);
  });

  describe('getSubreddit', () => {
    const mockSubreddit: Subreddit = {
      id: 'test',
      name: 'javascript',
      display_name: 'javascript',
      display_name_prefixed: 'r/javascript',
      title: 'JavaScript',
      description: 'Test subreddit',
      description_html: '<p>Test subreddit</p>',
      public_description: 'Test',
      subscribers: 1000,
      active_user_count: 100,
      created_utc: Date.now() / 1000,
      over18: false,
      lang: 'en',
      url: '/r/javascript/',
      quarantine: false,
      icon_img: '',
      banner_img: '',
      submit_text: '',
      submit_text_html: '',
      user_is_subscriber: false,
      user_is_moderator: false,
      user_is_contributor: false
    };

    it('should get subreddit information', async () => {
      mockHttpClient.get.mockResolvedValue({
        kind: 't5',
        data: mockSubreddit
      });

      const result = await subredditAPI.getSubreddit('javascript');
      
      expect(mockHttpClient.get).toHaveBeenCalledWith('/r/javascript/about');
      expect(result).toEqual(mockSubreddit);
    });

    it('should handle subreddit names with r/ prefix', async () => {
      mockHttpClient.get.mockResolvedValue({
        kind: 't5',
        data: mockSubreddit
      });

      await subredditAPI.getSubreddit('r/javascript');
      
      expect(mockHttpClient.get).toHaveBeenCalledWith('/r/javascript/about');
    });

    it('should throw on invalid subreddit names', async () => {
      await expect(subredditAPI.getSubreddit('invalid name!'))
        .rejects.toThrow('Invalid subreddit name');
    });
  });

  describe('getHotPosts', () => {
    const mockListing: RedditListing<Post> = {
      kind: 'Listing',
      data: {
        children: [
          { kind: 't3', data: { id: '1', title: 'Post 1' } as Post },
          { kind: 't3', data: { id: '2', title: 'Post 2' } as Post }
        ],
        after: 'abc123',
        before: null,
        dist: 2,
        modhash: null
      }
    };

    it('should get hot posts', async () => {
      mockHttpClient.get.mockResolvedValue(mockListing);

      const result = await subredditAPI.getHotPosts('javascript');
      
      expect(mockHttpClient.get).toHaveBeenCalledWith('/r/javascript/hot', { params: {} });
      expect(result.posts).toHaveLength(2);
      expect(result.pagination.after).toBe('abc123');
    });

    it('should handle pagination options', async () => {
      mockHttpClient.get.mockResolvedValue(mockListing);

      await subredditAPI.getHotPosts('javascript', { limit: 10, after: 'xyz789' });
      
      expect(mockHttpClient.get).toHaveBeenCalledWith('/r/javascript/hot', {
        params: { limit: '10', after: 'xyz789' }
      });
    });
  });

  describe('search', () => {
    it('should search within subreddit', async () => {
      const mockListing: RedditListing<Post> = {
        kind: 'Listing',
        data: {
          children: [],
          after: null,
          before: null,
          dist: 0,
          modhash: null
        }
      };

      mockHttpClient.get.mockResolvedValue(mockListing);

      await subredditAPI.search('javascript', { q: 'react' });
      
      expect(mockHttpClient.get).toHaveBeenCalledWith('/r/javascript/search', {
        params: {
          q: 'react',
          restrict_sr: true,
          type: 'link',
          include_over_18: false
        }
      });
    });
  });

  describe('subscribe/unsubscribe', () => {
    it('should subscribe to subreddit', async () => {
      mockHttpClient.post.mockResolvedValue({});

      await subredditAPI.subscribe('javascript');
      
      expect(mockHttpClient.post).toHaveBeenCalledWith('/api/subscribe', {
        action: 'sub',
        sr_name: 'javascript'
      });
    });

    it('should unsubscribe from subreddit', async () => {
      mockHttpClient.post.mockResolvedValue({});

      await subredditAPI.unsubscribe('javascript');
      
      expect(mockHttpClient.post).toHaveBeenCalledWith('/api/subscribe', {
        action: 'unsub',
        sr_name: 'javascript'
      });
    });
  });
});
```

**Acceptance Criteria**:
- [ ] All subreddit operations work correctly
- [ ] Pagination is handled properly
- [ ] Input validation prevents invalid requests
- [ ] Response parsing works with real Reddit data
- [ ] Search functionality works
- [ ] Subscription management works
- [ ] All tests pass

### Task 4.4: Implement PostAPI (5 hours)

**Objective**: Create the PostAPI module for post-related operations.

**Create `src/reddit/api/PostAPI.ts`**:

```ts
import { RedditHttpClient } from '../../http/RedditHttpClient';
import { 
  Post, 
  Comment,
  PostSubmission, 
  CommentSubmission,
  VoteSubmission,
  RedditListing,
  PaginationOptions 
} from '../types';
import { RedditResponseParser } from '../parser';
import { RedditUtils } from '../utils';
import { AuthErrors } from '../../errors';

export class PostAPI {
  constructor(protected client: RedditHttpClient) {}

  /**
   * Create a new post
   */
  async createPost(submission: PostSubmission): Promise<Post> {
    // Validate submission
    if (!RedditUtils.validatePostTitle(submission.title)) {
      throw new Error('Invalid post title');
    }

    if (!RedditUtils.validateSubredditName(submission.sr)) {
      throw new Error('Invalid subreddit name');
    }

    // Build form data for Reddit API
    const formData: Record<string, any> = {
      api_type: 'json',
      kind: submission.kind,
      sr: submission.sr,
      title: submission.title,
      sendreplies: submission.send_replies ?? true,
      resubmit: submission.resubmit ?? false,
      extension_handling: submission.extension_handling ?? false
    };

    // Add content based on post type
    switch (submission.kind) {
      case 'self':
        if (submission.text) {
          formData.text = submission.text;
        }
        break;
      case 'link':
        if (!submission.url) {
          throw new Error('URL is required for link posts');
        }
        formData.url = submission.url;
        break;
      case 'image':
      case 'video':
        if (!submission.url) {
          throw new Error('URL is required for media posts');
        }
        formData.url = submission.url;
        break;
    }

    // Add optional flags
    if (submission.nsfw) formData.nsfw = true;
    if (submission.spoiler) formData.spoiler = true;

    try {
      const response = await this.client.post(
        '/api/submit',
        new URLSearchParams(formData as Record<string, string>).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      return RedditResponseParser.parseSubmissionResponse(response);
    } catch (error) {
      // Handle Reddit-specific submission errors
      if (error.response?.status === 403) {
        throw AuthErrors.scopeInsufficient(['submit'], []);
      }
      throw error;
    }
  }

  /**
   * Get a specific post by ID
   */
  async getPost(postId: string, subreddit?: string): Promise<{ post: Post; comments: Comment[] }> {
    let url: string;
    
    if (subreddit) {
      const subredditName = RedditUtils.extractSubredditName(subreddit);
      url = `/r/${subredditName}/comments/${postId}`;
    } else {
      url = `/comments/${postId}`;
    }

    const response = await this.client.get(url);
    
    // Reddit returns an array with post listing and comments listing
    if (!Array.isArray(response) || response.length < 2) {
      throw new Error('Invalid post response format');
    }

    const postListing = RedditResponseParser.parseListing<Post>(response[0]);
    const posts = RedditResponseParser.extractListingItems(postListing);
    
    if (posts.length === 0) {
      throw new Error('Post not found');
    }

    const commentsListing = RedditResponseParser.parseListing<Comment>(response[1]);
    const comments = RedditResponseParser.extractListingItems(commentsListing);
    const processedComments = RedditResponseParser.processCommentTree(comments);

    return {
      post: posts[0],
      comments: processedComments
    };
  }

  /**
   * Vote on a post
   */
  async vote(postId: string, direction: 1 | 0 | -1): Promise<void> {
    const fullname = RedditResponseParser.createFullname('t3', postId);
    
    const voteData: VoteSubmission = {
      id: fullname,
      dir: direction
    };

    await this.client.post(
      '/api/vote',
      new URLSearchParams(voteData as Record<string, string>).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
  }

  /**
   * Upvote a post
   */
  async upvote(postId: string): Promise<void> {
    return this.vote(postId, 1);
  }

  /**
   * Downvote a post
   */
  async downvote(postId: string): Promise<void> {
    return this.vote(postId, -1);
  }

  /**
   * Remove vote from a post
   */
  async unvote(postId: string): Promise<void> {
    return this.vote(postId, 0);
  }

  /**
   * Save a post
   */
  async save(postId: string): Promise<void> {
    const fullname = RedditResponseParser.createFullname('t3', postId);
    
    await this.client.post('/api/save', {
      id: fullname
    });
  }

  /**
   * Unsave a post
   */
  async unsave(postId: string): Promise<void> {
    const fullname = RedditResponseParser.createFullname('t3', postId);
    
    await this.client.post('/api/unsave', {
      id: fullname
    });
  }

  /**
   * Hide a post
   */
  async hide(postId: string): Promise<void> {
    const fullname = RedditResponseParser.createFullname('t3', postId);
    
    await this.client.post('/api/hide', {
      id: fullname
    });
  }

  /**
   * Unhide a post
   */
  async unhide(postId: string): Promise<void> {
    const fullname = RedditResponseParser.createFullname('t3', postId);
    
    await this.client.post('/api/unhide', {
      id: fullname
    });
  }

  /**
   * Create a comment on a post
   */
  async createComment(postId: string, text: string): Promise<Comment> {
    if (!RedditUtils.validateCommentText(text)) {
      throw new Error('Invalid comment text');
    }

    const fullname = RedditResponseParser.createFullname('t3', postId);
    
    const commentData: CommentSubmission = {
      parent: fullname,
      text: text
    };

    try {
      const response = await this.client.post('/api/comment', {
        api_type: 'json',
        ...commentData
      });

      // Parse comment response
      if (response?.json?.data?.things?.[0]?.data) {
        return response.json.data.things[0].data as Comment;
      }
      
      throw new Error('Invalid comment response format');
    } catch (error) {
      if (error.response?.status === 403) {
        throw AuthErrors.scopeInsufficient(['submit'], []);
      }
      throw error;
    }
  }

  /**
   * Reply to a comment
   */
  async replyToComment(commentId: string, text: string): Promise<Comment> {
    if (!RedditUtils.validateCommentText(text)) {
      throw new Error('Invalid comment text');
    }

    const fullname = RedditResponseParser.createFullname('t1', commentId);
    
    const commentData: CommentSubmission = {
      parent: fullname,
      text: text
    };

    try {
      const response = await this.client.post('/api/comment', {
        api_type: 'json',
        ...commentData
      });

      if (response?.json?.data?.things?.[0]?.data) {
        return response.json.data.things[0].data as Comment;
      }
      
      throw new Error('Invalid comment response format');
    } catch (error) {
      if (error.response?.status === 403) {
        throw AuthErrors.scopeInsufficient(['submit'], []);
      }
      throw error;
    }
  }

  /**
   * Vote on a comment
   */
  async voteComment(commentId: string, direction: 1 | 0 | -1): Promise<void> {
    const fullname = RedditResponseParser.createFullname('t1', commentId);
    
    const voteData: VoteSubmission = {
      id: fullname,
      dir: direction
    };

    await this.client.post(
      '/api/vote',
      new URLSearchParams(voteData as Record<string, string>).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
  }

  /**
   * Save a comment
   */
  async saveComment(commentId: string): Promise<void> {
    const fullname = RedditResponseParser.createFullname('t1', commentId);
    
    await this.client.post('/api/save', {
      id: fullname
    });
  }

  /**
   * Delete a post (if you're the author)
   */
  async deletePost(postId: string): Promise<void> {
    const fullname = RedditResponseParser.createFullname('t3', postId);
    
    await this.client.post('/api/del', {
      id: fullname
    });
  }

  /**
   * Delete a comment (if you're the author)
   */
  async deleteComment(commentId: string): Promise<void> {
    const fullname = RedditResponseParser.createFullname('t1', commentId);
    
    await this.client.post('/api/del', {
      id: fullname
    });
  }

  /**
   * Edit a post (if you're the author)
   */
  async editPost(postId: string, text: string): Promise<Post> {
    const fullname = RedditResponseParser.createFullname('t3', postId);
    
    const response = await this.client.post('/api/editusertext', {
      api_type: 'json',
      thing_id: fullname,
      text: text
    });

    if (response?.json?.data?.things?.[0]?.data) {
      return response.json.data.things[0].data as Post;
    }
    
    throw new Error('Invalid edit response format');
  }

  /**
   * Edit a comment (if you're the author)
   */
  async editComment(commentId: string, text: string): Promise<Comment> {
    const fullname = RedditResponseParser.createFullname('t1', commentId);
    
    const response = await this.client.post('/api/editusertext', {
      api_type: 'json',
      thing_id: fullname,
      text: text
    });

    if (response?.json?.data?.things?.[0]?.data) {
      return response.json.data.things[0].data as Comment;
    }
    
    throw new Error('Invalid edit response format');
  }

  /**
   * Get random post from a subreddit
   */
  async getRandomPost(subreddit?: string): Promise<Post> {
    let url = '/random';
    if (subreddit) {
      const subredditName = RedditUtils.extractSubredditName(subreddit);
      url = `/r/${subredditName}/random`;
    }

    const response = await this.client.get(url);
    
    // Random endpoint returns a redirect, but we'll get the post data
    if (Array.isArray(response) && response.length > 0) {
      const postListing = RedditResponseParser.parseListing<Post>(response[0]);
      const posts = RedditResponseParser.extractListingItems(postListing);
      
      if (posts.length > 0) {
        return posts[0];
      }
    }
    
    throw new Error('No random post found');
  }
}
```

**Testing Instructions**:
Create `tests/PostAPI.test.ts`:

```ts
import { PostAPI } from '../src/reddit/api/PostAPI';
import { RedditHttpClient } from '../src/http/RedditHttpClient';
import { Post, Comment, PostSubmission } from '../src/reddit/types';

jest.mock('../src/http/RedditHttpClient');

describe('PostAPI', () => {
  let postAPI: PostAPI;
  let mockHttpClient: jest.Mocked<RedditHttpClient>;

  beforeEach(() => {
    mockHttpClient = new RedditHttpClient({} as any) as jest.Mocked<RedditHttpClient>;
    postAPI = new PostAPI(mockHttpClient);
  });

  describe('createPost', () => {
    it('should create a self post', async () => {
      const submission: PostSubmission = {
        kind: 'self',
        sr: 'test',
        title: 'Test Post',
        text: 'This is a test post'
      };

      const mockResponse = {
        json: {
          errors: [],
          data: {
            things: [{
              kind: 't3',
              data: { id: 'abc123', title: 'Test Post' }
            }]
          }
        }
      };

      mockHttpClient.post.mockResolvedValue(mockResponse);

      const result = await postAPI.createPost(submission);
      
      expect(mockHttpClient.post).toHaveBeenCalledWith('/api/submit', {
        api_type: 'json',
        kind: 'self',
        sr: 'test',
        title: 'Test Post',
        text: 'This is a test post',
        sendreplies: true,
        resubmit: false,
        extension_handling: false
      });
      
      expect(result.id).toBe('abc123');
    });

    it('should create a link post', async () => {
      const submission: PostSubmission = {
        kind: 'link',
        sr: 'test',
        title: 'Test Link',
        url: 'https://example.com'
      };

      const mockResponse = {
        json: {
          errors: [],
          data: {
            things: [{
              kind: 't3',
              data: { id: 'abc123', title: 'Test Link' }
            }]
          }
        }
      };

      mockHttpClient.post.mockResolvedValue(mockResponse);

      await postAPI.createPost(submission);
      
      expect(mockHttpClient.post).toHaveBeenCalledWith('/api/submit', 
        expect.objectContaining({
          url: 'https://example.com'
        })
      );
    });

    it('should throw on invalid title', async () => {
      const submission: PostSubmission = {
        kind: 'self',
        sr: 'test',
        title: '', // Invalid empty title
        text: 'Test'
      };

      await expect(postAPI.createPost(submission))
        .rejects.toThrow('Invalid post title');
    });
  });

  describe('getPost', () => {
    it('should get post with comments', async () => {
      const mockResponse = [
        {
          kind: 'Listing',
          data: {
            children: [{
              kind: 't3',
              data: { id: 'abc123', title: 'Test Post' }
            }],
            after: null,
            before: null,
            dist: 1,
            modhash: null
          }
        },
        {
          kind: 'Listing',
          data: {
            children: [{
              kind: 't1',
              data: { id: 'comment1', body: 'Test comment' }
            }],
            after: null,
            before: null,
            dist: 1,
            modhash: null
          }
        }
      ];

      mockHttpClient.get.mockResolvedValue(mockResponse);

      const result = await postAPI.getPost('abc123', 'test');
      
      expect(mockHttpClient.get).toHaveBeenCalledWith('/r/test/comments/abc123');
      expect(result.post.id).toBe('abc123');
      expect(result.comments).toHaveLength(1);
    });
  });

  describe('voting', () => {
    it('should upvote a post', async () => {
      mockHttpClient.post.mockResolvedValue({});

      await postAPI.upvote('abc123');
      
      expect(mockHttpClient.post).toHaveBeenCalledWith('/api/vote', {
        id: 't3_abc123',
        dir: 1
      });
    });

    it('should downvote a post', async () => {
      mockHttpClient.post.mockResolvedValue({});

      await postAPI.downvote('abc123');
      
      expect(mockHttpClient.post).toHaveBeenCalledWith('/api/vote', {
        id: 't3_abc123',
        dir: -1
      });
    });

    it('should remove vote from a post', async () => {
      mockHttpClient.post.mockResolvedValue({});

      await postAPI.unvote('abc123');
      
      expect(mockHttpClient.post).toHaveBeenCalledWith('/api/vote', {
        id: 't3_abc123',
        dir: 0
      });
    });
  });

  describe('comments', () => {
    it('should create a comment', async () => {
      const mockResponse = {
        json: {
          errors: [],
          data: {
            things: [{
              kind: 't1',
              data: { id: 'comment123', body: 'Test comment' }
            }]
          }
        }
      };

      mockHttpClient.post.mockResolvedValue(mockResponse);

      const result = await postAPI.createComment('abc123', 'Test comment');
      
      expect(mockHttpClient.post).toHaveBeenCalledWith('/api/comment', {
        api_type: 'json',
        parent: 't3_abc123',
        text: 'Test comment'
      });
      
      expect(result.id).toBe('comment123');
    });

    it('should reply to a comment', async () => {
      const mockResponse = {
        json: {
          errors: [],
          data: {
            things: [{
              kind: 't1',
              data: { id: 'reply123', body: 'Test reply' }
            }]
          }
        }
      };

      mockHttpClient.post.mockResolvedValue(mockResponse);

      await postAPI.replyToComment('comment123', 'Test reply');
      
      expect(mockHttpClient.post).toHaveBeenCalledWith('/api/comment', {
        api_type: 'json',
        parent: 't1_comment123',
        text: 'Test reply'
      });
    });
  });

  describe('save/unsave', () => {
    it('should save a post', async () => {
      mockHttpClient.post.mockResolvedValue({});

      await postAPI.save('abc123');
      
      expect(mockHttpClient.post).toHaveBeenCalledWith('/api/save', {
        id: 't3_abc123'
      });
    });

    it('should unsave a post', async () => {
      mockHttpClient.post.mockResolvedValue({});

      await postAPI.unsave('abc123');
      
      expect(mockHttpClient.post).toHaveBeenCalledWith('/api/unsave', {
        id: 't3_abc123'
      });
    });
  });
});
```

**Acceptance Criteria**:
- [ ] Post creation works for all post types
- [ ] Post retrieval includes comments
- [ ] Voting system works correctly
- [ ] Comment creation and replies work
- [ ] Save/unsave functionality works
- [ ] Edit and delete operations work
- [ ] Input validation prevents invalid requests
- [ ] Error handling for scope issues
- [ ] All tests pass

### Task 4.5: Implement UserAPI and Main RedditApiClient (6 hours)

**Objective**: Create the UserAPI module and the main RedditApiClient that coordinates all API modules.

**Create `src/reddit/api/UserAPI.ts`**:

```ts
import { RedditHttpClient } from '../../http/RedditHttpClient';
import { 
  User, 
  Post, 
  Comment,
  RedditListing,
  PaginationOptions,
  SortOptions 
} from '../types';
import { RedditResponseParser } from '../parser';
import { RedditUtils } from '../utils';

export class UserAPI {
  constructor(protected client: RedditHttpClient) {}

  /**
   * Get current authenticated user information
   */
  async getMe(): Promise<User> {
    const response = await this.client.get('/api/v1/me');
    return RedditResponseParser.parseResponse<User>(response);
  }

  /**
   * Get information about a specific user
   */
  async getUser(username: string): Promise<User> {
    if (!RedditUtils.validateUsername(username)) {
      throw new Error(`Invalid username: ${username}`);
    }

    const response = await this.client.get(`/user/${username}/about`);
    return RedditResponseParser.parseResponse<User>(response);
  }

  /**
   * Get posts by a user
   */
  async getUserPosts(
    username: string,
    options?: PaginationOptions & SortOptions
  ): Promise<{ posts: Post[]; pagination: { after: string | null; before: string | null } }> {
    if (!RedditUtils.validateUsername(username)) {
      throw new Error(`Invalid username: ${username}`);
    }

    const params = {
      ...RedditUtils.buildPaginationParams(options),
      ...RedditUtils.buildSortParams(options)
    };

    const response = await this.client.get(`/user/${username}/submitted`, { params });
    const listing = RedditResponseParser.parseListing<Post>(response);
    const posts = RedditResponseParser.extractListingItems(listing);

    return {
      posts,
      pagination: {
        after: listing.data.after,
        before: listing.data.before
      }
    };
  }

  /**
   * Get comments by a user
   */
  async getUserComments(
    username: string,
    options?: PaginationOptions & SortOptions
  ): Promise<{ comments: Comment[]; pagination: { after: string | null; before: string | null } }> {
    if (!RedditUtils.validateUsername(username)) {
      throw new Error(`Invalid username: ${username}`);
    }

    const params = {
      ...RedditUtils.buildPaginationParams(options),
      ...RedditUtils.buildSortParams(options)
    };

    const response = await this.client.get(`/user/${username}/comments`, { params });
    const listing = RedditResponseParser.parseListing<Comment>(response);
    const comments = RedditResponseParser.extractListingItems(listing);

    return {
      comments,
      pagination: {
        after: listing.data.after,
        before: listing.data.before
      }
    };
  }

  /**
   * Get user's saved posts and comments
   */
  async getSaved(
    options?: PaginationOptions
  ): Promise<{ items: (Post | Comment)[]; pagination: { after: string | null; before: string | null } }> {
    const params = RedditUtils.buildPaginationParams(options);

    const response = await this.client.get('/user/me/saved', { params });
    const listing = RedditResponseParser.parseListing<Post | Comment>(response);
    const items = RedditResponseParser.extractListingItems(listing);

    return {
      items,
      pagination: {
        after: listing.data.after,
        before: listing.data.before
      }
    };
  }

  /**
   * Get user's upvoted posts
   */
  async getUpvoted(
    options?: PaginationOptions
  ): Promise<{ posts: Post[]; pagination: { after: string | null; before: string | null } }> {
    const params = RedditUtils.buildPaginationParams(options);

    const response = await this.client.get('/user/me/upvoted', { params });
    const listing = RedditResponseParser.parseListing<Post>(response);
    const posts = RedditResponseParser.extractListingItems(listing);

    return {
      posts,
      pagination: {
        after: listing.data.after,
        before: listing.data.before
      }
    };
  }

  /**
   * Get user's downvoted posts
   */
  async getDownvoted(
    options?: PaginationOptions
  ): Promise<{ posts: Post[]; pagination: { after: string | null; before: string | null } }> {
    const params = RedditUtils.buildPaginationParams(options);

    const response = await this.client.get('/user/me/downvoted', { params });
    const listing = RedditResponseParser.parseListing<Post>(response);
    const posts = RedditResponseParser.extractListingItems(listing);

    return {
      posts,
      pagination: {
        after: listing.data.after,
        before: listing.data.before
      }
    };
  }

  /**
   * Send a private message to a user
   */
  async sendMessage(to: string, subject: string, text: string): Promise<void> {
    if (!RedditUtils.validateUsername(to)) {
      throw new Error(`Invalid username: ${to}`);
    }

    await this.client.post('/api/compose', {
      api_type: 'json',
      to: to,
      subject: subject,
      text: text
    });
  }

  /**
   * Block a user
   */
  async blockUser(username: string): Promise<void> {
    if (!RedditUtils.validateUsername(username)) {
      throw new Error(`Invalid username: ${username}`);
    }

    await this.client.post('/api/block_user', {
      name: username
    });
  }

  /**
   * Follow a user
   */
  async followUser(username: string): Promise<void> {
    if (!RedditUtils.validateUsername(username)) {
      throw new Error(`Invalid username: ${username}`);
    }

    await this.client.post('/api/follow_user', {
      name: username
    });
  }

  /**
   * Unfollow a user
   */
  async unfollowUser(username: string): Promise<void> {
    if (!RedditUtils.validateUsername(username)) {
      throw new Error(`Invalid username: ${username}`);
    }

    await this.client.post('/api/unfollow_user', {
      name: username
    });
  }
}
```

**Create `src/reddit/RedditApiClient.ts`**:

```ts
import { RedditHttpClient } from '../http/RedditHttpClient';
import { RedditClientConfig } from '../types';
import { createRedditHttpClient } from '../index';
import { SubredditAPI } from './api/SubredditAPI';
import { PostAPI } from './api/PostAPI';
import { UserAPI } from './api/UserAPI';

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

  /**
   * Make a custom API request
   */
  async customRequest<T = any>(method: string, url: string, data?: any): Promise<T> {
    switch (method.toUpperCase()) {
      case 'GET':
        return this.httpClient.get<T>(url);
      case 'POST':
        return this.httpClient.post<T>(url, data);
      case 'PUT':
        return this.httpClient.put<T>(url, data);
      case 'DELETE':
        return this.httpClient.delete<T>(url);
      case 'PATCH':
        return this.httpClient.patch<T>(url, data);
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }
  }
}
```

**Update `src/index.ts`** to export the main client:

```ts
// Add to existing exports
export { RedditApiClient } from './reddit/RedditApiClient';
export { SubredditAPI } from './reddit/api/SubredditAPI';
export { PostAPI } from './reddit/api/PostAPI';
export { UserAPI } from './reddit/api/UserAPI';
export * from './reddit/types';
export { RedditResponseParser } from './reddit/parser';
export { RedditUtils } from './reddit/utils';

// Convenience function for creating the full Reddit client
export function createRedditApiClient(config: RedditClientConfig): RedditApiClient {
  return new RedditApiClient(config);
}
```

**Create comprehensive usage examples in `docs/reddit-client-examples.md`**:

```markdown
# Reddit API Client Examples

## Basic Setup

```typescript
import { createRedditApiClient } from 'reddit-api-client';
import Keyv from 'keyv';
import pino from 'pino';

const logger = pino({ level: 'info' });
const storage = new Keyv({ namespace: 'reddit-app' });

const reddit = createRedditApiClient({
  credentials: {
    kind: 'userTokens',
    clientId: process.env.REDDIT_CLIENT_ID!,
    clientSecret: process.env.REDDIT_CLIENT_SECRET!,
    userAgent: 'MyApp/1.0 by u/myusername',
    accessToken: process.env.ACCESS_TOKEN!,
    refreshToken: process.env.REFRESH_TOKEN!,
    scope: ['identity', 'read', 'submit', 'vote'],
    usernameHint: 'myuser'
  },
  storage,
  logger
});
```

## Working with Subreddits

```typescript
// Get subreddit information
const jsSubreddit = await reddit.subreddits.getSubreddit('javascript');
console.log(`${jsSubreddit.display_name}: ${jsSubreddit.subscribers} subscribers`);

// Get hot posts
const { posts, pagination } = await reddit.subreddits.getHotPosts('javascript', { limit: 10 });
posts.forEach(post => {
  console.log(`${post.title} (${post.score} points)`);
});

// Get more posts using pagination
if (pagination.after) {
  const morePosts = await reddit.subreddits.getHotPosts('javascript', { 
    limit: 10, 
    after: pagination.after 
  });
}

// Search within a subreddit
const searchResults = await reddit.subreddits.search('javascript', {
  q: 'react hooks',
  sort: 'top',
  t: 'week'
});

// Subscribe to a subreddit
await reddit.subreddits.subscribe('typescript');
```

## Working with Posts

```typescript
// Create a self post
const newPost = await reddit.posts.createPost({
  kind: 'self',
  sr: 'test',
  title: 'My First Post via API',
  text: 'This post was created using the Reddit API client!'
});

console.log(`Created post: ${newPost.permalink}`);

// Get a specific post with comments
const { post, comments } = await reddit.posts.getPost(newPost.id, 'test');
console.log(`Post: ${post.title}`);
console.log(`Comments: ${comments.length}`);

// Vote on the post
await reddit.posts.upvote(newPost.id);

// Save the post
await reddit.posts.save(newPost.id);

// Create a comment
const comment = await reddit.posts.createComment(newPost.id, 'Great post!');

// Reply to the comment
await reddit.posts.replyToComment(comment.id, 'Thanks for the feedback!');

// Create a link post
const linkPost = await reddit.posts.createPost({
  kind: 'link',
  sr: 'test',
  title: 'Check out this cool website',
  url: 'https://example.com'
});
```

## Working with Users

```typescript
// Get current user info
const me = await reddit.users.getMe();
console.log(`Logged in as: ${me.name}`);
console.log(`Karma: ${me.total_karma}`);

// Get another user's info
const user = await reddit.users.getUser('spez');
console.log(`${user.name} created their account on ${new Date(user.created_utc * 1000)}`);

// Get user's posts
const { posts } = await reddit.users.getUserPosts('spez', { limit: 5 });
posts.forEach(post => {
  console.log(`${post.title} in r/${post.subreddit}`);
});

// Get user's comments
const { comments } = await reddit.users.getUserComments('spez', { limit: 5 });

// Get your saved posts
const { items: savedItems } = await reddit.users.getSaved();
console.log(`You have ${savedItems.length} saved items`);

// Send a private message
await reddit.users.sendMessage('username', 'Hello!', 'This is a test message');
```

## Error Handling

```typescript
try {
  const post = await reddit.posts.createPost({
    kind: 'self',
    sr: 'test',
    title: 'My Post',
    text: 'Content here'
  });
} catch (error) {
  if (error.kind === 'scope_insufficient') {
    console.log('Need "submit" permission to create posts');
  } else if (error.kind === 'rate_limited') {
    console.log(`Rate limited, retry in ${error.retryAfter} seconds`);
  } else {
    console.log('Post creation failed:', error.message);
  }
}
```

## Pagination

```typescript
// Get all hot posts from a subreddit (with pagination)
async function getAllHotPosts(subreddit: string) {
  let allPosts: Post[] = [];
  let after: string | null = null;
  
  do {
    const result = await reddit.subreddits.getHotPosts(subreddit, {
      limit: 100,
      after: after
    });
    
    allPosts.push(...result.posts);
    after = result.pagination.after;
    
  } while (after);
  
  return allPosts;
}

const allPosts = await getAllHotPosts('javascript');
console.log(`Found ${allPosts.length} total posts`);
```

## Monitoring and Metrics

```typescript
// Make some API calls
await reddit.subreddits.getHotPosts('javascript');
await reddit.users.getMe();

// Check metrics
const metrics = reddit.getMetrics();
console.log(`Made ${metrics.requestCount} requests`);
console.log(`Average response time: ${metrics.averageResponseTime}ms`);
console.log(`Error rate: ${(metrics.errorCount / metrics.requestCount * 100).toFixed(2)}%`);

// Log detailed metrics
reddit.logMetricsSummary();
```
```

**Testing Instructions**:
Create `tests/RedditApiClient.test.ts`:

```ts
import Keyv from 'keyv';
import pino from 'pino';
import { RedditApiClient } from '../src/reddit/RedditApiClient';
import { RedditClientConfig } from '../src/types';

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

  it('should create client with all API modules', () => {
    const client = new RedditApiClient(config);
    
    expect(client.subreddits).toBeDefined();
    expect(client.posts).toBeDefined();
    expect(client.users).toBeDefined();
  });

  it('should provide access to HTTP client', () => {
    const client = new RedditApiClient(config);
    const httpClient = client.getHttpClient();
    
    expect(httpClient).toBeDefined();
    expect(typeof httpClient.get).toBe('function');
  });

  it('should support custom requests', async () => {
    const client = new RedditApiClient(config);
    
    // Mock the HTTP client
    const httpClient = client.getHttpClient();
    jest.spyOn(httpClient, 'get').mockResolvedValue({ test: 'data' });
    
    const result = await client.customRequest('GET', '/custom/endpoint');
    expect(result).toEqual({ test: 'data' });
  });

  it('should support metrics access', () => {
    const client = new RedditApiClient(config);
    
    expect(typeof client.getMetrics).toBe('function');
    expect(typeof client.logMetricsSummary).toBe('function');
    expect(typeof client.resetMetrics).toBe('function');
  });
});
```

**Acceptance Criteria**:
- [ ] RedditApiClient coordinates all API modules correctly
- [ ] UserAPI implements all user-related operations
- [ ] Main client provides access to underlying HTTP client
- [ ] Metrics and monitoring work correctly
- [ ] Custom request functionality works
- [ ] All API modules are properly integrated
- [ ] Usage examples work correctly
- [ ] All tests pass

## Phase 4 Completion Checklist

**Before finalizing the project, ensure:**

- [ ] All TypeScript compiles without errors
- [ ] All tests pass (`npm test`)
- [ ] Reddit API types accurately reflect actual API responses
- [ ] Response parsing handles all Reddit API formats
- [ ] All CRUD operations work for posts and comments
- [ ] Subreddit operations work correctly
- [ ] User operations work correctly
- [ ] Pagination works across all list endpoints
- [ ] Error handling provides useful error messages
- [ ] Input validation prevents invalid API calls
- [ ] Rate limiting prevents API quota violations
- [ ] Authentication works transparently
- [ ] Multi-user scenarios work correctly

**Integration Tests to Run:**
1. End-to-end post creation and retrieval
2. Comment thread handling with nested replies
3. Subreddit browsing with pagination
4. User information and content retrieval
5. Voting and saving functionality
6. Search functionality across different contexts
7. Error handling for various Reddit API errors
8. Rate limiting during high-volume operations

**Manual Testing with Real Reddit API:**
1. Create a test Reddit application
2. Use real credentials to test all operations
3. Verify rate limiting prevents 429 errors
4. Test pagination with large datasets
5. Verify error messages are helpful
6. Test concurrent operations
7. Verify authentication refresh works

**Performance Testing:**
1. Test with high request volumes
2. Verify memory usage doesn't grow unbounded
3. Test rate limiting queue performance
4. Verify request/response times are reasonable

**Deliverables:**
1. Complete `RedditApiClient` with all modules
2. Comprehensive Reddit API type definitions
3. Response parsing for all Reddit formats
4. All Reddit API operations implemented
5. Complete test suite with high coverage
6. Comprehensive documentation and examples
7. Ready-to-publish npm package

**Time Estimate**: 22 hours total
**Difficulty**: Advanced
**Dependencies**: Phase 1-3 (Complete auth infrastructure)

Once Phase 4 is complete, you'll have a production-ready, full-featured Reddit API client that developers can use to build sophisticated Reddit integrations. The client will handle authentication, rate limiting, error handling, and provide a clean, typed interface to Reddit's API.

**Final Steps for Production:**
1. Set up automated testing with GitHub Actions
2. Configure npm package publishing
3. Create comprehensive documentation website
4. Set up issue tracking and contribution guidelines
5. Publish to npm registry
6. Create announcement and marketing materials

Congratulations! You'll have built a complete, production-ready Reddit API client that other developers can use and rely on.
