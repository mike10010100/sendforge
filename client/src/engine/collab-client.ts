import type { GitRepositoryClient } from './fetcher.js';
import type { GitOid } from './types.js';

export type PullRequestStatus = 'open' | 'merged' | 'closed';
export type IssueStatus = 'open' | 'closed';

export interface Author {
  readonly name: string;
  readonly email: string;
}

export interface Comment {
  readonly id: string;
  readonly author: Author;
  readonly body: string;
  readonly createdAt: number;
}

export interface PullRequest {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly author: Author;
  readonly targetBranch: string;
  readonly sourceBranch: string;
  readonly headCommit: string;
  readonly status: PullRequestStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly labels: readonly string[];
  readonly comments: readonly Comment[];
}

export interface Issue {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly author: Author;
  readonly status: IssueStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly labels: readonly string[];
  readonly comments: readonly Comment[];
}

export interface ReviewNote {
  readonly commitSha: string;
  readonly filePath?: string | undefined;
  readonly line?: number | undefined;
  readonly author: Author;
  readonly body: string;
  readonly createdAt: number;
}

// Raw JSON shapes for deserialization & normalization
interface RawAuthor {
  readonly name?: unknown;
  readonly email?: unknown;
}

interface RawComment {
  readonly id?: unknown;
  readonly author?: unknown;
  readonly body?: unknown;
  readonly created_at?: unknown;
  readonly createdAt?: unknown;
}

interface RawPullRequest {
  readonly id?: unknown;
  readonly number?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly author?: unknown;
  readonly target_branch?: unknown;
  readonly targetBranch?: unknown;
  readonly source_branch?: unknown;
  readonly sourceBranch?: unknown;
  readonly head_commit?: unknown;
  readonly headCommit?: unknown;
  readonly status?: unknown;
  readonly created_at?: unknown;
  readonly createdAt?: unknown;
  readonly updated_at?: unknown;
  readonly updatedAt?: unknown;
  readonly labels?: unknown;
  readonly comments?: unknown;
}

interface RawIssue {
  readonly id?: unknown;
  readonly number?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly author?: unknown;
  readonly status?: unknown;
  readonly created_at?: unknown;
  readonly createdAt?: unknown;
  readonly updated_at?: unknown;
  readonly updatedAt?: unknown;
  readonly labels?: unknown;
  readonly comments?: unknown;
}

interface RawReviewNote {
  readonly commit_sha?: unknown;
  readonly commitSha?: unknown;
  readonly file_path?: unknown;
  readonly filePath?: unknown;
  readonly line?: unknown;
  readonly author?: unknown;
  readonly body?: unknown;
  readonly created_at?: unknown;
  readonly createdAt?: unknown;
}

export function normalizeAuthor(raw: unknown): Author {
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as RawAuthor;
    return {
      name: typeof obj.name === 'string' && obj.name.trim().length > 0 ? obj.name.trim() : 'Anonymous',
      email: typeof obj.email === 'string' ? obj.email.trim() : 'anonymous@sendforge.local',
    };
  }
  return {
    name: 'Anonymous',
    email: 'anonymous@sendforge.local',
  };
}

export function normalizeComment(raw: unknown): Comment {
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as RawComment;
    const createdAtNum = typeof obj.createdAt === 'number'
      ? obj.createdAt
      : typeof obj.created_at === 'number'
      ? obj.created_at
      : 0;

    return {
      id: typeof obj.id === 'string' || typeof obj.id === 'number' ? String(obj.id) : '',
      author: normalizeAuthor(obj.author),
      body: typeof obj.body === 'string' ? obj.body : '',
      createdAt: createdAtNum,
    };
  }
  return {
    id: '',
    author: normalizeAuthor(null),
    body: '',
    createdAt: 0,
  };
}

export function normalizePullRequest(raw: unknown): PullRequest | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const obj = raw as RawPullRequest;

  const id = typeof obj.id === 'string' || typeof obj.id === 'number' ? String(obj.id) : '0';
  const num = typeof obj.number === 'number' ? obj.number : parseInt(id, 10) || 0;
  const title = typeof obj.title === 'string' ? obj.title : '';
  const description = typeof obj.description === 'string' ? obj.description : '';
  const author = normalizeAuthor(obj.author);

  const targetBranch = typeof obj.targetBranch === 'string'
    ? obj.targetBranch
    : typeof obj.target_branch === 'string'
    ? obj.target_branch
    : 'main';

  const sourceBranch = typeof obj.sourceBranch === 'string'
    ? obj.sourceBranch
    : typeof obj.source_branch === 'string'
    ? obj.source_branch
    : '';

  const headCommit = typeof obj.headCommit === 'string'
    ? obj.headCommit
    : typeof obj.head_commit === 'string'
    ? obj.head_commit
    : '';

  let status: PullRequestStatus = 'open';
  if (obj.status === 'merged') status = 'merged';
  else if (obj.status === 'closed') status = 'closed';

  const createdAt = typeof obj.createdAt === 'number'
    ? obj.createdAt
    : typeof obj.created_at === 'number'
    ? obj.created_at
    : 0;

  const updatedAt = typeof obj.updatedAt === 'number'
    ? obj.updatedAt
    : typeof obj.updated_at === 'number'
    ? obj.updated_at
    : createdAt;

  const labels = Array.isArray(obj.labels)
    ? obj.labels.filter((l): l is string => typeof l === 'string')
    : [];

  const comments = Array.isArray(obj.comments)
    ? obj.comments.map(normalizeComment)
    : [];

  return {
    id,
    number: num,
    title,
    description,
    author,
    targetBranch,
    sourceBranch,
    headCommit,
    status,
    createdAt,
    updatedAt,
    labels,
    comments,
  };
}

export function normalizeIssue(raw: unknown): Issue | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const obj = raw as RawIssue;

  const id = typeof obj.id === 'string' || typeof obj.id === 'number' ? String(obj.id) : '0';
  const num = typeof obj.number === 'number' ? obj.number : parseInt(id, 10) || 0;
  const title = typeof obj.title === 'string' ? obj.title : '';
  const description = typeof obj.description === 'string' ? obj.description : '';
  const author = normalizeAuthor(obj.author);

  const status: IssueStatus = obj.status === 'closed' ? 'closed' : 'open';

  const createdAt = typeof obj.createdAt === 'number'
    ? obj.createdAt
    : typeof obj.created_at === 'number'
    ? obj.created_at
    : 0;

  const updatedAt = typeof obj.updatedAt === 'number'
    ? obj.updatedAt
    : typeof obj.updated_at === 'number'
    ? obj.updated_at
    : createdAt;

  const labels = Array.isArray(obj.labels)
    ? obj.labels.filter((l): l is string => typeof l === 'string')
    : [];

  const comments = Array.isArray(obj.comments)
    ? obj.comments.map(normalizeComment)
    : [];

  return {
    id,
    number: num,
    title,
    description,
    author,
    status,
    createdAt,
    updatedAt,
    labels,
    comments,
  };
}

export function normalizeReviewNote(raw: unknown, defaultTargetSha: string): ReviewNote | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const obj = raw as RawReviewNote;

  const rawCommitSha = typeof obj.commitSha === 'string'
    ? obj.commitSha
    : typeof obj.commit_sha === 'string'
    ? obj.commit_sha
    : '';

  const commitSha = (rawCommitSha.trim().length > 0 ? rawCommitSha.trim() : defaultTargetSha).toLowerCase();
  const author = normalizeAuthor(obj.author);
  const body = typeof obj.body === 'string' ? obj.body : '';

  const rawFilePath = typeof obj.filePath === 'string'
    ? obj.filePath
    : typeof obj.file_path === 'string'
    ? obj.file_path
    : undefined;

  const line = typeof obj.line === 'number' && Number.isInteger(obj.line) && obj.line > 0
    ? obj.line
    : undefined;

  const createdAt = typeof obj.createdAt === 'number'
    ? obj.createdAt
    : typeof obj.created_at === 'number'
    ? obj.created_at
    : 0;

  const note: ReviewNote = {
    commitSha,
    author,
    body,
    createdAt,
    ...(rawFilePath !== undefined && rawFilePath.trim().length > 0 ? { filePath: rawFilePath.trim() } : {}),
    ...(line !== undefined ? { line } : {}),
  };

  return note;
}

/**
 * Loads and normalizes pull requests manifest (static/pulls.json or pulls.json).
 */
export async function loadPullRequests(baseUrl = ''): Promise<PullRequest[]> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const candidateUrls = [
    `${cleanBase}/static/pulls.json`,
    `${cleanBase}/pulls.json`,
  ];

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data: unknown = await res.json();
        if (Array.isArray(data)) {
          const pulls: PullRequest[] = [];
          for (const item of data) {
            const normalized = normalizePullRequest(item);
            if (normalized) {
              pulls.push(normalized);
            }
          }
          return pulls;
        }
      }
    } catch {
      // Continue to next candidate URL
    }
  }

  return [];
}

/**
 * Loads and normalizes issues manifest (static/issues.json or issues.json).
 */
export async function loadIssues(baseUrl = ''): Promise<Issue[]> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const candidateUrls = [
    `${cleanBase}/static/issues.json`,
    `${cleanBase}/issues.json`,
  ];

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data: unknown = await res.json();
        if (Array.isArray(data)) {
          const issues: Issue[] = [];
          for (const item of data) {
            const normalized = normalizeIssue(item);
            if (normalized) {
              issues.push(normalized);
            }
          }
          return issues;
        }
      }
    } catch {
      // Continue to next candidate URL
    }
  }

  return [];
}

/**
 * Loads review notes from Git object references (refs/notes/reviews).
 * Parses tree entries recursively and parses single JSON, JSON array, or plaintext review notes.
 * If headSha is provided, filters notes for that specific commit SHA.
 */
export async function loadReviewNotes(
  client: GitRepositoryClient,
  headSha?: string
): Promise<ReviewNote[]> {
  const notes: ReviewNote[] = [];

  let notesRefSha: GitOid | null = null;
  try {
    notesRefSha = await client.resolveRef('refs/notes/reviews');
  } catch {
    try {
      notesRefSha = await client.resolveRef('notes/reviews');
    } catch {
      notesRefSha = null;
    }
  }

  if (!notesRefSha) {
    return [];
  }

  try {
    const notesCommit = await client.getCommit(notesRefSha);
    const treeFiles = await client.listAllTreeFiles(notesCommit.tree);

    for (const item of treeFiles) {
      // Path represents target commit SHA, handling possible 2-level fanout e.g. "a1/b2/c3d4..." -> "a1b2c3d4..."
      const targetSha = item.path.replace(/\//g, '').toLowerCase();

      try {
        const blob = await client.getBlob(item.entry.oid);
        const text = blob.text ?? new TextDecoder('utf-8').decode(blob.data);

        // Try JSON parsing
        let parsedJson: unknown = null;
        try {
          parsedJson = JSON.parse(text);
        } catch {
          parsedJson = null;
        }

        if (Array.isArray(parsedJson)) {
          for (const rawItem of parsedJson) {
            const note = normalizeReviewNote(rawItem, targetSha);
            if (note && note.body.trim().length > 0) {
              notes.push(note);
            }
          }
        } else if (typeof parsedJson === 'object' && parsedJson !== null) {
          const note = normalizeReviewNote(parsedJson, targetSha);
          if (note && note.body.trim().length > 0) {
            notes.push(note);
          }
        } else {
          // Plaintext note
          const trimmed = text.trim();
          if (trimmed.length > 0) {
            notes.push({
              commitSha: targetSha,
              author: { name: 'Anonymous', email: 'anonymous@sendforge.local' },
              body: trimmed,
              createdAt: 0,
            });
          }
        }
      } catch {
        // Ignore single blob reading errors
      }
    }
  } catch {
    return [];
  }

  if (headSha !== undefined && headSha.trim().length > 0) {
    const filterSha = headSha.trim().toLowerCase();
    return notes.filter((n) => n.commitSha === filterSha);
  }

  return notes;
}

/**
 * Collaboration Client managing cached PRs, issues, and review comments.
 */
export class CollabClient {
  private readonly baseUrl: string;
  private pullsCache: PullRequest[] | null = null;
  private issuesCache: Issue[] | null = null;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  public async getPullRequests(refresh = false): Promise<readonly PullRequest[]> {
    if (this.pullsCache !== null && !refresh) {
      return this.pullsCache;
    }
    const pulls = await loadPullRequests(this.baseUrl);
    this.pullsCache = pulls;
    return pulls;
  }

  public async getPullRequest(id: string | number): Promise<PullRequest | null> {
    const strId = String(id);
    const numId = Number(id);
    const pulls = await this.getPullRequests();
    return pulls.find((p) => p.id === strId || (!Number.isNaN(numId) && p.number === numId)) ?? null;
  }

  public async getIssues(refresh = false): Promise<readonly Issue[]> {
    if (this.issuesCache !== null && !refresh) {
      return this.issuesCache;
    }
    const issues = await loadIssues(this.baseUrl);
    this.issuesCache = issues;
    return issues;
  }

  public async getIssue(id: string | number): Promise<Issue | null> {
    const strId = String(id);
    const numId = Number(id);
    const issues = await this.getIssues();
    return issues.find((i) => i.id === strId || (!Number.isNaN(numId) && i.number === numId)) ?? null;
  }

  public async getReviewNotes(
    client: GitRepositoryClient,
    headSha?: string
  ): Promise<readonly ReviewNote[]> {
    return loadReviewNotes(client, headSha);
  }
}
