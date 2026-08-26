/**
 * Type definitions for Sendforge Serverless Edge Write Gateway (Cloudflare Pages Functions).
 */

export interface AuthorInput {
  readonly name: string;
  readonly email?: string | undefined;
}

export interface AuthorRecord {
  readonly name: string;
  readonly email: string;
}

export interface IssueSubmitPayload {
  readonly repo?: string | undefined;
  readonly title: string;
  readonly description?: string | undefined;
  readonly author?: string | AuthorInput | undefined;
  readonly labels?: readonly string[] | undefined;
  readonly custom_id?: string | number | undefined;
  readonly id?: string | number | undefined;
}

export interface IssueRecord {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly author: AuthorRecord;
  readonly status: 'open' | 'closed';
  readonly created_at: number;
  readonly updated_at: number;
  readonly labels: readonly string[];
  readonly comments: readonly unknown[];
}

export interface IssueSubmitResponse {
  readonly success: boolean;
  readonly issue?: IssueRecord | undefined;
  readonly ref?: string | undefined;
  readonly oid?: string | undefined;
  readonly error?: string | undefined;
}

export interface PRSubmitPayload {
  readonly repo?: string | undefined;
  readonly title: string;
  readonly description?: string | undefined;
  readonly author?: string | AuthorInput | undefined;
  readonly source_branch?: string | undefined;
  readonly sourceBranch?: string | undefined;
  readonly target_branch?: string | undefined;
  readonly targetBranch?: string | undefined;
  readonly head_commit?: string | undefined;
  readonly headCommit?: string | undefined;
  readonly patch?: string | undefined;
  readonly labels?: readonly string[] | undefined;
  readonly custom_id?: string | number | undefined;
  readonly id?: string | number | undefined;
}

export interface PullRequestRecord {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly author: AuthorRecord;
  readonly target_branch: string;
  readonly source_branch: string;
  readonly head_commit: string;
  readonly status: 'open' | 'merged' | 'closed';
  readonly created_at: number;
  readonly updated_at: number;
  readonly labels: readonly string[];
  readonly comments: readonly unknown[];
}

export interface PRSubmitResponse {
  readonly success: boolean;
  readonly pull?: PullRequestRecord | undefined;
  readonly ref?: string | undefined;
  readonly meta_ref?: string | undefined;
  readonly oid?: string | undefined;
  readonly error?: string | undefined;
}

export interface R2ObjectLike {
  readonly key: string;
  readonly size: number;
}

export interface R2ObjectBodyLike {
  readonly body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
}

export interface R2BucketLike {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: {
      httpMetadata?: {
        contentType?: string | undefined;
      };
    }
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  delete(keys: string | readonly string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{
    readonly objects: readonly R2ObjectLike[];
  }>;
}

export interface KVNamespaceLike {
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: { expirationTtl?: number }
  ): Promise<void>;
  get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<string | null>;
  get(key: string, type: 'text'): Promise<string | null>;
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  get<T>(key: string, type: 'json'): Promise<T | null>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{
    readonly keys: readonly { readonly name: string }[];
  }>;
}

export interface EdgeEnv {
  readonly STORAGE_BUCKET?: R2BucketLike | undefined;
  readonly STORAGE_KV?: KVNamespaceLike | undefined;
  readonly [key: string]: unknown;
}

export interface PagesFunctionContext<Env = EdgeEnv> {
  readonly request: Request;
  readonly env: Env;
  readonly params?: Record<string, string | string[]> | undefined;
  readonly waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
  readonly next?: ((input?: Request | string, init?: RequestInit) => Promise<Response>) | undefined;
  readonly data?: Record<string, unknown> | undefined;
}
