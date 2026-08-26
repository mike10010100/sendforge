/**
 * Git loose object synthesis, ref updates, and multi-backend storage layer
 * for Sendforge Serverless Edge Write Gateway.
 */

import type {
  EdgeEnv,
  IssueRecord,
  KVNamespaceLike,
  PullRequestRecord,
  R2BucketLike,
} from './types.js';

/**
 * Computes standard SHA-1 hash of a byte array and formats as a 40-character lowercase hex string.
 */
export async function computeSha1(data: Uint8Array): Promise<string> {
  try {
    const copy = new Uint8Array(data.length);
    copy.set(data);
    const hashBuffer = await crypto.subtle.digest('SHA-1', copy);
    const hashBytes = new Uint8Array(hashBuffer);
    let hex = '';
    for (const b of hashBytes) {
      hex += b.toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    // Fallback for environments without crypto.subtle (e.g. older Node)
    try {
      const nodeCrypto = await import('node:crypto');
      return nodeCrypto.createHash('sha1').update(data).digest('hex').toLowerCase();
    } catch {
      throw new Error('No cryptographic SHA-1 provider available in current runtime environment.');
    }
  }
}

export interface SynthesizedGitBlob {
  readonly oid: string;
  readonly rawBlob: Uint8Array;
  readonly contentBytes: Uint8Array;
  readonly size: number;
}

/**
 * Synthesizes a standard Git loose blob object (`blob <size>\0<content>`)
 * and computes its canonical 40-character SHA-1 Git OID.
 */
export async function synthesizeGitBlob(
  content: string | Uint8Array
): Promise<SynthesizedGitBlob> {
  const contentBytes = typeof content === 'string'
    ? new TextEncoder().encode(content)
    : content;

  const header = new TextEncoder().encode(`blob ${contentBytes.length}\0`);
  const rawBlob = new Uint8Array(header.length + contentBytes.length);
  rawBlob.set(header, 0);
  rawBlob.set(contentBytes, header.length);

  const oid = await computeSha1(rawBlob);

  return {
    oid,
    rawBlob,
    contentBytes,
    size: contentBytes.length,
  };
}

/**
 * Checks for path traversal attempts (e.g. `..`, null bytes, control characters).
 */
export function isPathTraversal(path: string): boolean {
  if (path.includes('\0')) return true;
  if (path.includes('..')) return true;
  if (/%2e%2e/i.test(path)) return true;
  if (path.startsWith('/') || path.startsWith('\\')) return true;
  return false;
}

/**
 * Sanitizes an issue or PR identifier matching Sendforge conventions (`[a-zA-Z0-9._-]`).
 * Strips path traversal characters and replaces illegal characters with `_`.
 */
export function sanitizeId(
  id: string | number | undefined,
  fallback = '1'
): string {
  if (id === undefined) {
    return fallback;
  }
  const raw = String(id).trim();
  // Strip .. and path separators
  const stripped = raw.replace(/\.\./g, '').replace(/[/\\]/g, '');
  // Replace illegal characters
  const sanitized = stripped.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  return sanitized.length > 0 ? sanitized : fallback;
}

/**
 * Validates a repository identifier (e.g. `owner/repo` or `repo-name`).
 */
export function validateRepoName(repo: string | undefined): {
  readonly valid: boolean;
  readonly normalized: string;
  readonly error?: string;
} {
  if (!repo || repo.trim().length === 0) {
    return { valid: true, normalized: '' };
  }
  const trimmed = repo.trim();

  if (isPathTraversal(trimmed)) {
    return { valid: false, normalized: '', error: 'Malicious path traversal detected in repository name' };
  }

  // Ensure repository follows alphanumeric and safe separator rules
  const segments = trimmed.split('/');
  if (segments.length > 3) {
    return { valid: false, normalized: '', error: 'Repository path exceeds maximum segment depth' };
  }

  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || !/^[a-zA-Z0-9._-]+$/.test(seg)) {
      return { valid: false, normalized: '', error: `Invalid repository path segment: "${seg}"` };
    }
  }

  return { valid: true, normalized: trimmed.replace(/^\/+|\/+$/g, '') };
}

/**
 * Validates a Git reference name (e.g. `refs/issues/1`, `refs/pull/42/head`).
 */
export function validateRefName(ref: string): {
  readonly valid: boolean;
  readonly normalized: string;
  readonly error?: string;
} {
  const trimmed = ref.trim();
  if (!trimmed.startsWith('refs/')) {
    return { valid: false, normalized: '', error: 'Git reference must begin with "refs/"' };
  }
  if (isPathTraversal(trimmed)) {
    return { valid: false, normalized: '', error: 'Malicious path traversal in Git reference' };
  }
  // Check for forbidden Git ref patterns and control characters
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 32 || code === 127) {
      return { valid: false, normalized: '', error: `Invalid Git reference name: "${trimmed}"` };
    }
  }
  if (
    trimmed.includes('//') ||
    trimmed.includes('..') ||
    trimmed.endsWith('/') ||
    trimmed.endsWith('.lock') ||
    /[ ~^:?*[@\\]/.test(trimmed)
  ) {
    return { valid: false, normalized: '', error: `Invalid Git reference name: "${trimmed}"` };
  }
  return { valid: true, normalized: trimmed };
}

/**
 * Universal storage backend abstraction interface.
 */
export interface StorageBackend {
  put(key: string, data: Uint8Array | string, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  getText(key: string): Promise<string | null>;
  getJson<T>(key: string): Promise<T | null>;
  list(prefix?: string): Promise<readonly string[]>;
  delete(key: string): Promise<void>;
}

/**
 * In-memory storage backend for local testing, CI, and fallback runtime.
 */
export class MemoryStorageBackend implements StorageBackend {
  private readonly store = new Map<string, { data: Uint8Array; contentType?: string | undefined }>();

  public put(key: string, data: Uint8Array | string, contentType?: string): Promise<void> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const item: { data: Uint8Array; contentType?: string | undefined } = { data: bytes };
    if (contentType !== undefined) {
      item.contentType = contentType;
    }
    this.store.set(key, item);
    return Promise.resolve();
  }

  public get(key: string): Promise<Uint8Array | null> {
    const entry = this.store.get(key);
    return Promise.resolve(entry ? entry.data : null);
  }

  public getText(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    return Promise.resolve(entry ? new TextDecoder('utf-8').decode(entry.data) : null);
  }

  public getJson<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    try {
      const text = new TextDecoder('utf-8').decode(entry.data);
      return Promise.resolve(JSON.parse(text) as T);
    } catch {
      return Promise.resolve(null);
    }
  }

  public list(prefix?: string): Promise<readonly string[]> {
    const keys: string[] = [];
    for (const key of this.store.keys()) {
      if (!prefix || key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return Promise.resolve(keys);
  }

  public delete(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  public clear(): void {
    this.store.clear();
  }
}

/**
 * Cloudflare R2 bucket storage backend.
 */
export class R2StorageBackend implements StorageBackend {
  constructor(private readonly bucket: R2BucketLike) {}

  public async put(key: string, data: Uint8Array | string, contentType?: string): Promise<void> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await this.bucket.put(
      key,
      bytes,
      contentType ? { httpMetadata: { contentType } } : {}
    );
  }

  public async get(key: string): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    const arrayBuffer = await obj.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  public async getText(key: string): Promise<string | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return obj.text();
  }

  public async getJson<T>(key: string): Promise<T | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    try {
      return await obj.json<T>();
    } catch {
      return null;
    }
  }

  public async list(prefix?: string): Promise<readonly string[]> {
    const result = await this.bucket.list(prefix ? { prefix } : undefined);
    return result.objects.map((o) => o.key);
  }

  public async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

/**
 * Cloudflare KV namespace storage backend.
 */
export class KVStorageBackend implements StorageBackend {
  constructor(private readonly kv: KVNamespaceLike) {}

  public async put(key: string, data: Uint8Array | string): Promise<void> {
    if (typeof data === 'string') {
      await this.kv.put(key, data);
    } else {
      const copy = new Uint8Array(data.length);
      copy.set(data);
      await this.kv.put(key, copy);
    }
  }

  public async get(key: string): Promise<Uint8Array | null> {
    const buffer = await this.kv.get(key, 'arrayBuffer');
    if (!buffer) return null;
    return new Uint8Array(buffer);
  }

  public async getText(key: string): Promise<string | null> {
    return this.kv.get(key, 'text');
  }

  public async getJson<T>(key: string): Promise<T | null> {
    return this.kv.get<T>(key, 'json');
  }

  public async list(prefix?: string): Promise<readonly string[]> {
    const result = await this.kv.list(prefix ? { prefix } : undefined);
    return result.keys.map((k) => k.name);
  }

  public async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}

/**
 * Factory creating the appropriate storage backend based on environment bindings.
 */
export function getStorageBackend(
  env?: EdgeEnv,
  customStorage?: StorageBackend
): StorageBackend {
  if (customStorage) {
    return customStorage;
  }
  if (env?.STORAGE_BUCKET) {
    return new R2StorageBackend(env.STORAGE_BUCKET);
  }
  if (env?.STORAGE_KV) {
    return new KVStorageBackend(env.STORAGE_KV);
  }
  return new MemoryStorageBackend();
}

/**
 * Helper to build repository-scoped storage keys.
 */
function buildKey(repo: string, path: string): string {
  const cleanRepo = repo.replace(/^\/+|\/+$/g, '');
  const cleanPath = path.replace(/^\/+/, '');
  return cleanRepo ? `${cleanRepo}/${cleanPath}` : cleanPath;
}

/**
 * Saves a synthesized Git loose object into the storage backend under standard path:
 * `[repo/]objects/xx/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
 */
export async function saveGitLooseBlob(
  storage: StorageBackend,
  repo: string,
  content: string | Uint8Array
): Promise<{
  readonly oid: string;
  readonly rawBlob: Uint8Array;
  readonly storagePath: string;
}> {
  const { oid, rawBlob } = await synthesizeGitBlob(content);
  const objectPath = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  const fullKey = buildKey(repo, objectPath);

  await storage.put(fullKey, rawBlob, 'application/x-git-loose-object');

  return {
    oid,
    rawBlob,
    storagePath: fullKey,
  };
}

/**
 * Writes or updates a Git reference pointing to an OID (format: `<oid>\n`).
 */
export async function updateGitRef(
  storage: StorageBackend,
  repo: string,
  refName: string,
  oid: string
): Promise<string> {
  const validation = validateRefName(refName);
  if (!validation.valid) {
    throw new Error(validation.error ?? `Invalid Git ref: ${refName}`);
  }
  const cleanOid = oid.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(cleanOid)) {
    throw new Error(`Invalid Git OID: "${oid}"`);
  }

  const fullKey = buildKey(repo, validation.normalized);
  await storage.put(fullKey, `${cleanOid}\n`, 'text/plain');
  return fullKey;
}

/**
 * Reads a Git reference value (OID) from storage.
 */
export async function readGitRef(
  storage: StorageBackend,
  repo: string,
  refName: string
): Promise<string | null> {
  const validation = validateRefName(refName);
  if (!validation.valid) {
    return null;
  }
  const fullKey = buildKey(repo, validation.normalized);
  const text = await storage.getText(fullKey);
  return text ? text.trim() : null;
}

/**
 * Persists issue metadata to individual `meta/issues/<id>.json`
 * and updates repository aggregate `issues.json`.
 */
export async function saveIssueMetadata(
  storage: StorageBackend,
  repo: string,
  issue: IssueRecord
): Promise<void> {
  // 1. Individual issue metadata
  const singleKey = buildKey(repo, `meta/issues/${issue.id}.json`);
  await storage.put(singleKey, JSON.stringify(issue, null, 2) + '\n', 'application/json');

  // 2. Repository aggregate issues.json update
  const aggregateKey = buildKey(repo, 'issues.json');
  let currentIssues: IssueRecord[] = [];
  const existing = await storage.getJson<IssueRecord[]>(aggregateKey);
  if (Array.isArray(existing)) {
    currentIssues = existing.filter((item) => item.id !== issue.id);
  }

  currentIssues.push(issue);
  // Sort by number descending
  currentIssues.sort((a, b) => b.number - a.number);

  await storage.put(aggregateKey, JSON.stringify(currentIssues, null, 2) + '\n', 'application/json');
}

/**
 * Persists pull request metadata to individual `meta/pulls/<id>.json`
 * and updates repository aggregate `pulls.json`.
 */
export async function savePRMetadata(
  storage: StorageBackend,
  repo: string,
  pull: PullRequestRecord
): Promise<void> {
  // 1. Individual PR metadata
  const singleKey = buildKey(repo, `meta/pulls/${pull.id}.json`);
  await storage.put(singleKey, JSON.stringify(pull, null, 2) + '\n', 'application/json');

  // 2. Repository aggregate pulls.json update
  const aggregateKey = buildKey(repo, 'pulls.json');
  let currentPulls: PullRequestRecord[] = [];
  const existing = await storage.getJson<PullRequestRecord[]>(aggregateKey);
  if (Array.isArray(existing)) {
    currentPulls = existing.filter((item) => item.id !== pull.id);
  }

  currentPulls.push(pull);
  // Sort by number descending
  currentPulls.sort((a, b) => b.number - a.number);

  await storage.put(aggregateKey, JSON.stringify(currentPulls, null, 2) + '\n', 'application/json');
}
