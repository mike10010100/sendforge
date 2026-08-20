import { inflateZlib } from './inflator.js';
import {
  computeSha1Hex,
  OidMismatchError,
  parseLooseObjectEnvelope,
} from './parser.js';
import type {
  GitBlobObject,
  GitCommitObject,
  GitObject,
  GitOid,
  GitTagObject,
  GitTreeEntry,
  GitTreeObject,
  RepoMeta,
} from './types.js';

export class ObjectNotFoundError extends Error {
  constructor(public readonly oid: GitOid, status?: number) {
    super(`Git object not found: ${oid}${status !== undefined ? ` (HTTP ${status})` : ''}`);
    this.name = 'ObjectNotFoundError';
  }
}

export class RefNotFoundError extends Error {
  constructor(public readonly refName: string) {
    super(`Git reference not found: ${refName}`);
    this.name = 'RefNotFoundError';
  }
}

export interface TreeFileItem {
  readonly path: string;
  readonly entry: GitTreeEntry;
}

export class GitRepositoryClient {
  private readonly baseUrl: string;
  private readonly memoryCache = new Map<GitOid, GitObject>();
  private readonly inFlightRequests = new Map<GitOid, Promise<GitObject>>();
  private readonly maxCacheSize: number;
  private cachedMeta: RepoMeta | null = null;

  constructor(baseUrl = '', maxCacheSize = 500) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.maxCacheSize = maxCacheSize;
  }

  /**
   * Fetches and parses the repository meta.json manifest.
   */
  public async getMeta(): Promise<RepoMeta> {
    if (this.cachedMeta !== null) {
      return this.cachedMeta;
    }

    const candidateUrls = [
      `${this.baseUrl}/static/meta.json`,
      `${this.baseUrl}/meta.json`,
    ];

    let lastError: Error | null = null;
    for (const url of candidateUrls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = (await res.json()) as RepoMeta;
          this.cachedMeta = data;
          return data;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw new Error(
      `Failed to load repository meta.json from ${this.baseUrl}: ${lastError?.message ?? 'Not found'}`
    );
  }

  /**
   * Fetches and parses dumb HTTP info/refs catalog.
   */
  public async getInfoRefs(): Promise<Map<string, GitOid>> {
    const url = `${this.baseUrl}/info/refs`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch info/refs: HTTP ${res.status}`);
    }

    const text = await res.text();
    const map = new Map<string, GitOid>();
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split('\t');
      const sha = parts[0]?.trim();
      const ref = parts[1]?.trim();
      if (sha && ref && sha.length === 40) {
        map.set(ref, sha);
      }
    }

    return map;
  }

  /**
   * Resolves a branch name, tag name, HEAD, or commit SHA to a 40-char SHA-1 OID.
   */
  public async resolveRef(refNameOrSha: string): Promise<GitOid> {
    const trimmed = refNameOrSha.trim();
    if (/^[0-9a-f]{40}$/i.test(trimmed)) {
      return trimmed.toLowerCase();
    }

    // Try meta.json first
    try {
      const meta = await this.getMeta();
      if (trimmed === 'HEAD') {
        return meta.head.sha;
      }
      for (const branch of meta.branches) {
        if (branch.name === trimmed || `refs/heads/${branch.name}` === trimmed) {
          return branch.target;
        }
      }
      for (const tag of meta.tags) {
        if (tag.name === trimmed || `refs/tags/${tag.name}` === trimmed) {
          if (tag.peeled) {
            return tag.peeled;
          }
          return tag.target;
        }
      }
    } catch {
      // Fallback to info/refs
    }

    // Try info/refs
    try {
      const infoRefs = await this.getInfoRefs();
      const direct = infoRefs.get(trimmed) ??
        infoRefs.get(`refs/heads/${trimmed}`) ??
        infoRefs.get(`refs/tags/${trimmed}`) ??
        infoRefs.get(`refs/tags/${trimmed}^{}`);
      if (direct) {
        return direct;
      }
    } catch {
      // Fall through to error
    }

    throw new RefNotFoundError(trimmed);
  }

  /**
   * Retrieves a Git object by OID, using in-flight deduplication and LRU caching.
   */
  public async getObject(oid: GitOid): Promise<GitObject> {
    const normalizedOid = oid.toLowerCase();
    const cached = this.memoryCache.get(normalizedOid);
    if (cached !== undefined) {
      // Refresh LRU ordering
      this.memoryCache.delete(normalizedOid);
      this.memoryCache.set(normalizedOid, cached);
      return cached;
    }

    const inFlight = this.inFlightRequests.get(normalizedOid);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const fetchPromise = this.fetchAndParseObject(normalizedOid).finally(() => {
      this.inFlightRequests.delete(normalizedOid);
    });

    this.inFlightRequests.set(normalizedOid, fetchPromise);
    return fetchPromise;
  }

  public async getCommit(oid: GitOid): Promise<GitCommitObject> {
    const obj = await this.getObject(oid);
    if (obj.type === 'tag') {
      const peeled = await this.peelTag(obj.oid);
      if (peeled.type === 'commit') {
        return peeled;
      }
    }
    if (obj.type !== 'commit') {
      throw new Error(`Expected commit object for ${oid}, got ${obj.type}`);
    }
    return obj;
  }

  public async getTree(oid: GitOid): Promise<GitTreeObject> {
    const obj = await this.getObject(oid);
    if (obj.type !== 'tree') {
      throw new Error(`Expected tree object for ${oid}, got ${obj.type}`);
    }
    return obj;
  }

  public async getBlob(oid: GitOid): Promise<GitBlobObject> {
    const obj = await this.getObject(oid);
    if (obj.type !== 'blob') {
      throw new Error(`Expected blob object for ${oid}, got ${obj.type}`);
    }
    return obj;
  }

  public async getTag(oid: GitOid): Promise<GitTagObject> {
    const obj = await this.getObject(oid);
    if (obj.type !== 'tag') {
      throw new Error(`Expected tag object for ${oid}, got ${obj.type}`);
    }
    return obj;
  }

  /**
   * Recursively peels an annotated tag until reaching a non-tag object (commit, tree, or blob).
   */
  public async peelTag(tagOid: GitOid): Promise<GitCommitObject | GitTreeObject | GitBlobObject> {
    let currentOid = tagOid;
    for (let depth = 0; depth < 10; depth++) {
      const obj = await this.getObject(currentOid);
      if (obj.type === 'tag') {
        currentOid = obj.targetOid;
      } else {
        return obj;
      }
    }
    throw new Error(`Exceeded maximum tag peeling recursion depth for ${tagOid}`);
  }

  /**
   * Traverses a root tree to find the tree entry at the given relative path.
   */
  public async resolvePathToEntry(
    rootTreeOid: GitOid,
    filePath: string
  ): Promise<GitTreeEntry | null> {
    const cleanPath = filePath.replace(/^\/+|\/+$/g, '');
    if (!cleanPath) {
      return null;
    }

    const segments = cleanPath.split('/');
    let currentTree = await this.getTree(rootTreeOid);

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue;

      const isLastSegment = i === segments.length - 1;
      const foundEntry = currentTree.entries.find((e) => e.name === segment);

      if (!foundEntry) {
        return null;
      }

      if (isLastSegment) {
        return foundEntry;
      }

      if (!foundEntry.isTree) {
        return null;
      }

      currentTree = await this.getTree(foundEntry.oid);
    }

    return null;
  }

  /**
   * Recursively lists all files in a tree for fuzzy finding and indexing.
   */
  public async listAllTreeFiles(
    rootTreeOid: GitOid,
    prefix = '',
    maxFiles = 5000
  ): Promise<readonly TreeFileItem[]> {
    const results: TreeFileItem[] = [];

    const walk = async (treeOid: GitOid, currentPrefix: string): Promise<void> => {
      if (results.length >= maxFiles) return;
      const tree = await this.getTree(treeOid);

      for (const entry of tree.entries) {
        if (results.length >= maxFiles) break;
        const entryPath = currentPrefix ? `${currentPrefix}/${entry.name}` : entry.name;
        if (entry.isTree) {
          await walk(entry.oid, entryPath);
        } else {
          results.push({ path: entryPath, entry });
        }
      }
    };

    await walk(rootTreeOid, prefix);
    return results;
  }

  /**
   * Walks commit history starting from a given commit OID.
   */
  public async getCommitHistory(
    startOid: GitOid,
    limit = 50
  ): Promise<readonly GitCommitObject[]> {
    const history: GitCommitObject[] = [];
    const visited = new Set<GitOid>();
    const queue: GitOid[] = [startOid];

    while (queue.length > 0 && history.length < limit) {
      const currentOid = queue.shift();
      if (!currentOid || visited.has(currentOid)) continue;
      visited.add(currentOid);

      try {
        const commit = await this.getCommit(currentOid);
        history.push(commit);
        for (const parentOid of commit.parents) {
          if (!visited.has(parentOid)) {
            queue.push(parentOid);
          }
        }
      } catch {
        break;
      }
    }

    return history;
  }

  private async fetchAndParseObject(oid: GitOid): Promise<GitObject> {
    const prefix = oid.slice(0, 2);
    const rest = oid.slice(2);
    const url = `${this.baseUrl}/objects/${prefix}/${rest}`;

    let lastError: Error | null = null;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          if (res.status === 404) {
            throw new ObjectNotFoundError(oid, res.status);
          }
          throw new Error(`HTTP error ${res.status} fetching object ${oid}`);
        }

        const headersObj: unknown = res.headers;
        if (headersObj && typeof headersObj === 'object' && 'get' in headersObj) {
          const getHeader = (headersObj as { get?: unknown }).get;
          if (typeof getHeader === 'function') {
            const ct: unknown = (getHeader as (name: string) => unknown).call(headersObj, 'content-type');
            if (typeof ct === 'string' && ct.includes('text/html')) {
              throw new ObjectNotFoundError(oid, 404);
            }
          }
        }

        const compressed = new Uint8Array(await res.arrayBuffer());
        const uncompressed = await inflateZlib(compressed);

        // Verify SHA-1 integrity
        const computedOid = await computeSha1Hex(uncompressed);
        if (computedOid.toLowerCase() !== oid.toLowerCase()) {
          throw new OidMismatchError(
            `SHA-1 mismatch for object: expected ${oid}, computed ${computedOid}`
          );
        }

        const parsed = parseLooseObjectEnvelope(uncompressed, oid);
        this.putCache(oid, parsed);
        return parsed;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError instanceof ObjectNotFoundError || lastError instanceof OidMismatchError) {
          throw lastError;
        }
        if (attempt < maxRetries) {
          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 100));
        }
      }
    }

    throw lastError ?? new Error(`Failed to fetch object ${oid}`);
  }

  private putCache(oid: GitOid, obj: GitObject): void {
    if (this.memoryCache.size >= this.maxCacheSize) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.memoryCache.delete(oldestKey);
      }
    }
    this.memoryCache.set(oid, obj);
  }
}
