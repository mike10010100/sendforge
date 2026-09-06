/**
 * Typed client library for Sendforge Serverless Edge Write Gateway
 * with automatic fallback to local Git command generation and offline draft storage.
 */

import type {
  AuthorInput,
  IssueRecord,
  IssueSubmitPayload,
  IssueSubmitResponse,
  PRSubmitPayload,
  PRSubmitResponse,
  PullRequestRecord,
} from '../../../functions/api/submit/types.js';

export type { IssueRecord, PullRequestRecord, IssueSubmitResponse, PRSubmitResponse };

export interface EdgeClientConfig {
  readonly baseUrl?: string | undefined;
  readonly fetchFn?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
  readonly storage?: Storage | undefined;
}

export interface IssueSubmitOptions {
  readonly repo?: string | undefined;
  readonly title: string;
  readonly description?: string | undefined;
  readonly author?: string | AuthorInput | undefined;
  readonly labels?: readonly string[] | undefined;
  readonly customId?: string | number | undefined;
}

export interface PRSubmitOptions {
  readonly repo?: string | undefined;
  readonly title: string;
  readonly description?: string | undefined;
  readonly author?: string | AuthorInput | undefined;
  readonly targetBranch?: string | undefined;
  readonly sourceBranch: string;
  readonly headCommit?: string | undefined;
  readonly patch?: string | undefined;
  readonly labels?: readonly string[] | undefined;
  readonly customId?: string | number | undefined;
}

export interface LocalGitCommands {
  readonly pushCommand: string;
  readonly commitHelperCommand?: string | undefined;
  readonly patchFileName?: string | undefined;
  readonly patchContent?: string | undefined;
}

export interface EdgeSubmitResult<T> {
  readonly success: boolean;
  readonly data?: T | undefined;
  readonly ref?: string | undefined;
  readonly metaRef?: string | undefined;
  readonly oid?: string | undefined;
  readonly error?: string | undefined;
  readonly fallbackUsed: boolean;
  readonly offlineStored?: boolean | undefined;
  readonly localCommands?: LocalGitCommands | undefined;
}

export interface OfflineDraftItem<T> {
  readonly id: string;
  readonly repo: string;
  readonly type: 'issue' | 'pr';
  readonly payload: T;
  readonly savedAt: number;
}

/**
 * Safely escapes a string for inclusion inside double-quoted shell arguments,
 * preventing parameter expansion ($), command substitution ($(..), `..`),
 * quote injection (\"), and backslash escaping (\\).
 */
export function escapeShellDoubleQuotes(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}

/**
 * In-memory fallback storage for Node.js / non-browser environments.
 */
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  public get length(): number {
    return this.items.size;
  }

  public clear(): void {
    this.items.clear();
  }

  public getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  public key(index: number): string | null {
    const keys = Array.from(this.items.keys());
    return keys[index] ?? null;
  }

  public removeItem(key: string): void {
    this.items.delete(key);
  }

  public setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

/**
 * Edge Write Gateway Client.
 */
export class EdgeGatewayClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly storage: Storage;

  constructor(config: EdgeClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? '').replace(/\/+$/, '');
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? 10000;

    if (config.storage !== undefined) {
      this.storage = config.storage;
    } else {
      let candidate: Storage | null = null;
      try {
        if (typeof window !== 'undefined') {
          candidate = window.localStorage;
        } else if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
          candidate = globalThis.localStorage;
        }
      } catch {
        candidate = null;
      }
      this.storage = candidate ?? new MemoryStorage();
    }
  }

  /**
   * Submits an issue to the edge gateway.
   */
  public async submitIssue(options: IssueSubmitOptions): Promise<EdgeSubmitResult<IssueRecord>> {
    const url = `${this.baseUrl}/api/submit/issue`;
    const payload: IssueSubmitPayload = {
      ...(options.repo !== undefined && { repo: options.repo }),
      title: options.title,
      ...(options.description !== undefined && { description: options.description }),
      ...(options.author !== undefined && { author: options.author }),
      ...(options.labels !== undefined && { labels: options.labels }),
      ...(options.customId !== undefined && { custom_id: options.customId }),
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, this.timeoutMs);

      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      let data: IssueSubmitResponse;
      try {
        const parsed: unknown = await res.json();
        data = parsed as IssueSubmitResponse;
      } catch {
        return {
          success: false,
          fallbackUsed: false,
          error: `Edge server returned invalid JSON response (status ${res.status.toString()})`,
        };
      }

      if (res.ok && data.success && data.issue) {
        return {
          success: true,
          data: data.issue,
          ref: data.ref,
          oid: data.oid,
          fallbackUsed: false,
        };
      }

      return {
        success: false,
        fallbackUsed: false,
        error: data.error ?? `Edge submission failed with status ${res.status.toString()}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        fallbackUsed: false,
        error: `Edge connection failed: ${msg}`,
      };
    }
  }

  /**
   * Submits a pull request to the edge gateway.
   */
  public async submitPullRequest(options: PRSubmitOptions): Promise<EdgeSubmitResult<PullRequestRecord>> {
    const url = `${this.baseUrl}/api/submit/pr`;
    const payload: PRSubmitPayload = {
      ...(options.repo !== undefined && { repo: options.repo }),
      title: options.title,
      ...(options.description !== undefined && { description: options.description }),
      ...(options.author !== undefined && { author: options.author }),
      source_branch: options.sourceBranch,
      target_branch: options.targetBranch ?? 'main',
      ...(options.headCommit !== undefined && { head_commit: options.headCommit }),
      ...(options.patch !== undefined && { patch: options.patch }),
      ...(options.labels !== undefined && { labels: options.labels }),
      ...(options.customId !== undefined && { custom_id: options.customId }),
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, this.timeoutMs);

      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      let data: PRSubmitResponse;
      try {
        const parsed: unknown = await res.json();
        data = parsed as PRSubmitResponse;
      } catch {
        return {
          success: false,
          fallbackUsed: false,
          error: `Edge server returned invalid JSON response (status ${res.status.toString()})`,
        };
      }

      if (res.ok && data.success && data.pull) {
        return {
          success: true,
          data: data.pull,
          ref: data.ref,
          metaRef: data.meta_ref,
          oid: data.oid,
          fallbackUsed: false,
        };
      }

      return {
        success: false,
        fallbackUsed: false,
        error: data.error ?? `Edge submission failed with status ${res.status.toString()}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        fallbackUsed: false,
        error: `Edge connection failed: ${msg}`,
      };
    }
  }

  /**
   * Generates offline / CLI-ready Git push commands for submitting an Issue.
   */
  public generateLocalIssueCommands(options: IssueSubmitOptions): LocalGitCommands {
    const rawId = options.customId !== undefined ? String(options.customId).trim() : '1';
    const cleanId = rawId.replace(/[^a-zA-Z0-9._-]/g, '_') || '1';
    const pushCommand = `git push origin HEAD:refs/issues/${cleanId}`;

    const titleClean = (options.title || 'New Issue').trim();
    const descClean = (options.description ?? '').trim();
    const titleEscaped = escapeShellDoubleQuotes(titleClean);
    const descEscaped = escapeShellDoubleQuotes(descClean);
    const commitHelperCommand = descClean
      ? `git commit --allow-empty -m "${titleEscaped}" -m "${descEscaped}" && ${pushCommand}`
      : `git commit --allow-empty -m "${titleEscaped}" && ${pushCommand}`;

    return {
      pushCommand,
      commitHelperCommand,
    };
  }

  /**
   * Generates offline / CLI-ready Git push commands and patch export for submitting a Pull Request.
   */
  public generateLocalPRCommands(options: PRSubmitOptions): LocalGitCommands {
    const rawId = options.customId !== undefined ? String(options.customId).trim() : '1';
    const cleanId = rawId.replace(/[^a-zA-Z0-9._-]/g, '_') || '1';
    const cleanSource = options.sourceBranch.replace(/^refs\/heads\//, '').trim() || 'feature';
    const pushCommand = `git push origin ${cleanSource}:refs/pull/${cleanId}/head`;

    const slug = (options.title || cleanSource)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'patch';

    return {
      pushCommand,
      patchFileName: `0001-${slug}.patch`,
      patchContent: options.patch,
    };
  }

  /**
   * Persists an issue draft to offline storage.
   */
  public saveOfflineIssueDraft(repo: string, options: IssueSubmitOptions): string {
    const draftId = `draft_${Date.now().toString()}_${Math.random().toString(36).slice(2, 8)}`;
    const item: OfflineDraftItem<IssueSubmitOptions> = {
      id: draftId,
      repo: repo.trim(),
      type: 'issue',
      payload: options,
      savedAt: Date.now(),
    };

    const drafts = this.getOfflineIssueDrafts(repo);
    const updated = [item, ...drafts];
    const key = `sendforge:offline:issues:${repo.trim() || 'default'}`;
    this.storage.setItem(key, JSON.stringify(updated));
    return draftId;
  }

  /**
   * Retrieves all stored offline issue drafts for a repository.
   */
  public getOfflineIssueDrafts(repo: string): readonly OfflineDraftItem<IssueSubmitOptions>[] {
    const key = `sendforge:offline:issues:${repo.trim() || 'default'}`;
    const raw = this.storage.getItem(key);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as OfflineDraftItem<IssueSubmitOptions>[];
      }
    } catch {
      // Corrupted
    }
    return [];
  }

  /**
   * Clears a stored offline issue draft.
   */
  public clearOfflineIssueDraft(repo: string, draftId: string): void {
    const drafts = this.getOfflineIssueDrafts(repo);
    const updated = drafts.filter((d) => d.id !== draftId);
    const key = `sendforge:offline:issues:${repo.trim() || 'default'}`;
    this.storage.setItem(key, JSON.stringify(updated));
  }

  /**
   * Persists a PR draft to offline storage.
   */
  public saveOfflinePRDraft(repo: string, options: PRSubmitOptions): string {
    const draftId = `draft_${Date.now().toString()}_${Math.random().toString(36).slice(2, 8)}`;
    const item: OfflineDraftItem<PRSubmitOptions> = {
      id: draftId,
      repo: repo.trim(),
      type: 'pr',
      payload: options,
      savedAt: Date.now(),
    };

    const drafts = this.getOfflinePRDrafts(repo);
    const updated = [item, ...drafts];
    const key = `sendforge:offline:prs:${repo.trim() || 'default'}`;
    this.storage.setItem(key, JSON.stringify(updated));
    return draftId;
  }

  /**
   * Retrieves all stored offline PR drafts for a repository.
   */
  public getOfflinePRDrafts(repo: string): readonly OfflineDraftItem<PRSubmitOptions>[] {
    const key = `sendforge:offline:prs:${repo.trim() || 'default'}`;
    const raw = this.storage.getItem(key);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as OfflineDraftItem<PRSubmitOptions>[];
      }
    } catch {
      // Corrupted
    }
    return [];
  }

  /**
   * Clears a stored offline PR draft.
   */
  public clearOfflinePRDraft(repo: string, draftId: string): void {
    const drafts = this.getOfflinePRDrafts(repo);
    const updated = drafts.filter((d) => d.id !== draftId);
    const key = `sendforge:offline:prs:${repo.trim() || 'default'}`;
    this.storage.setItem(key, JSON.stringify(updated));
  }

  /**
   * Submits an issue with resilient fallback: if the edge is offline or returns a network error,
   * stores the draft to offline storage and generates local Git push commands.
   */
  public async submitIssueWithFallback(options: IssueSubmitOptions): Promise<EdgeSubmitResult<IssueRecord>> {
    const result = await this.submitIssue(options);
    if (result.success) {
      return result;
    }

    // Fallback: save to offline draft and generate local git commands
    const repo = options.repo ?? '';
    this.saveOfflineIssueDraft(repo, options);
    const localCommands = this.generateLocalIssueCommands(options);

    return {
      success: false,
      fallbackUsed: true,
      offlineStored: true,
      localCommands,
      error: result.error,
    };
  }

  /**
   * Submits a PR with resilient fallback: if the edge is offline or returns a network error,
   * stores the draft to offline storage and generates local Git push commands.
   */
  public async submitPullRequestWithFallback(options: PRSubmitOptions): Promise<EdgeSubmitResult<PullRequestRecord>> {
    const result = await this.submitPullRequest(options);
    if (result.success) {
      return result;
    }

    // Fallback: save to offline draft and generate local git commands
    const repo = options.repo ?? '';
    this.saveOfflinePRDraft(repo, options);
    const localCommands = this.generateLocalPRCommands(options);

    return {
      success: false,
      fallbackUsed: true,
      offlineStored: true,
      localCommands,
      error: result.error,
    };
  }
}
