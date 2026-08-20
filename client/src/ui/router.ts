import { formatLineHash, parseLineHash, type LineRange } from './utils.js';

export interface RouteCode {
  readonly type: 'code';
  readonly ref?: string | undefined;
  readonly path?: string | undefined;
  readonly lineRange?: LineRange | null | undefined;
}

export interface RouteCommits {
  readonly type: 'commits';
  readonly ref?: string | undefined;
}

export interface RouteCommit {
  readonly type: 'commit';
  readonly sha: string;
}

export interface RouteIssues {
  readonly type: 'issues';
  readonly filter?: 'open' | 'closed' | 'all' | undefined;
  readonly query?: string | undefined;
  readonly label?: string | undefined;
  readonly author?: string | undefined;
}

export interface RouteIssue {
  readonly type: 'issue';
  readonly id: string;
}

export interface RoutePulls {
  readonly type: 'pulls';
  readonly filter?: 'open' | 'merged' | 'closed' | 'all' | undefined;
  readonly query?: string | undefined;
  readonly label?: string | undefined;
  readonly author?: string | undefined;
}

export interface RoutePull {
  readonly type: 'pull';
  readonly id: string;
  readonly tab?: 'conversation' | 'commits' | 'files' | undefined;
}

export type Route =
  | RouteCode
  | RouteCommits
  | RouteCommit
  | RouteIssues
  | RouteIssue
  | RoutePulls
  | RoutePull;

/**
 * Parses window.location.hash into a strongly typed Route AST.
 * Handles deep links for issues, pull requests, commits, and code files.
 */
export function parseRoute(hash: string): Route {
  // Strip all leading '#' and whitespace
  let clean = hash.replace(/^#+/, '').trim();
  clean = clean.replace(/^\/+/, '');

  if (!clean || clean === '/') {
    return { type: 'code' };
  }

  // Separate path part and query string part
  const questionIndex = clean.indexOf('?');
  let pathPart = questionIndex >= 0 ? clean.slice(0, questionIndex) : clean;
  const queryPart = questionIndex >= 0 ? clean.slice(questionIndex + 1) : '';

  // Clean trailing slashes
  pathPart = pathPart.replace(/\/+$/, '');

  const params = new URLSearchParams(queryPart);

  // 1. Issues routes
  if (pathPart === 'issues') {
    const rawFilter = params.get('filter');
    const filter =
      rawFilter === 'open' || rawFilter === 'closed' || rawFilter === 'all'
        ? rawFilter
        : undefined;
    const query = params.get('q') ?? params.get('query') ?? undefined;
    const label = params.get('label') ?? undefined;
    const author = params.get('author') ?? undefined;

    const res: RouteIssues = {
      type: 'issues',
      ...(filter !== undefined ? { filter } : {}),
      ...(query !== undefined ? { query } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(author !== undefined ? { author } : {}),
    };
    return res;
  }

  const issueDetailMatch = /^issues\/([^/]+)$/.exec(pathPart);
  if (issueDetailMatch?.[1]) {
    return {
      type: 'issue',
      id: decodeURIComponent(issueDetailMatch[1]),
    };
  }

  // 2. Pull Requests routes
  if (pathPart === 'pulls') {
    const rawFilter = params.get('filter');
    const filter =
      rawFilter === 'open' ||
      rawFilter === 'merged' ||
      rawFilter === 'closed' ||
      rawFilter === 'all'
        ? rawFilter
        : undefined;
    const query = params.get('q') ?? params.get('query') ?? undefined;
    const label = params.get('label') ?? undefined;
    const author = params.get('author') ?? undefined;

    const res: RoutePulls = {
      type: 'pulls',
      ...(filter !== undefined ? { filter } : {}),
      ...(query !== undefined ? { query } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(author !== undefined ? { author } : {}),
    };
    return res;
  }

  const pullTabMatch = /^pulls\/([^/]+)\/(conversation|commits|files)$/.exec(pathPart);
  if (pullTabMatch?.[1] && pullTabMatch[2]) {
    return {
      type: 'pull',
      id: decodeURIComponent(pullTabMatch[1]),
      tab: pullTabMatch[2] as 'conversation' | 'commits' | 'files',
    };
  }

  const pullDetailMatch = /^pulls\/([^/]+)$/.exec(pathPart);
  if (pullDetailMatch?.[1]) {
    return {
      type: 'pull',
      id: decodeURIComponent(pullDetailMatch[1]),
      tab: 'conversation',
    };
  }

  // 3. Commits / Log routes
  if (pathPart === 'commits' || pathPart === 'log') {
    return { type: 'commits' };
  }

  const commitsRefMatch = /^commits\/(.+)$/.exec(pathPart);
  if (commitsRefMatch?.[1]) {
    return {
      type: 'commits',
      ref: decodeURIComponent(commitsRefMatch[1]),
    };
  }

  const commitDiffMatch = /^commit\/([0-9a-fA-F]{7,40})$/.exec(pathPart);
  if (commitDiffMatch?.[1]) {
    return {
      type: 'commit',
      sha: commitDiffMatch[1].toLowerCase(),
    };
  }

  // 4. Blob with commit SHA / ref / Line permalink: commit/<sha>/blob/<path>#L10-L20
  const commitBlobMatch = /^commit\/([^/]+)\/blob\/(.+)$/.exec(pathPart);
  if (commitBlobMatch?.[1] && commitBlobMatch[2]) {
    let filePath = commitBlobMatch[2];
    let lineRange: LineRange | null = null;

    const lineHashMatch = /[#]L(\d+)(?:-L(\d+))?$/i.exec(clean);
    if (lineHashMatch) {
      lineRange = parseLineHash(lineHashMatch[0]);
      filePath = filePath.replace(/[#]L\d+(?:-L\d+)?$/i, '');
    }

    return {
      type: 'code',
      ref: decodeURIComponent(commitBlobMatch[1]),
      path: decodeURIComponent(filePath),
      ...(lineRange !== null ? { lineRange } : {}),
    };
  }

  // 5. Tree route: tree/<ref>/<path> or tree/<path>
  const treeMatch = /^tree\/(.+)$/.exec(pathPart);
  if (treeMatch?.[1]) {
    return {
      type: 'code',
      path: decodeURIComponent(treeMatch[1]),
    };
  }

  // 6. Blob route: blob/<path>
  const blobMatch = /^blob\/(.+)$/.exec(pathPart);
  if (blobMatch?.[1]) {
    let filePath = blobMatch[1];
    let lineRange: LineRange | null = null;

    const lineHashMatch = /[#]L(\d+)(?:-L(\d+))?$/i.exec(clean);
    if (lineHashMatch) {
      lineRange = parseLineHash(lineHashMatch[0]);
      filePath = filePath.replace(/[#]L\d+(?:-L\d+)?$/i, '');
    }

    return {
      type: 'code',
      path: decodeURIComponent(filePath),
      ...(lineRange !== null ? { lineRange } : {}),
    };
  }

  return { type: 'code' };
}

/**
 * Formats a Route AST object into a canonical URL hash string.
 */
export function formatRoute(route: Route): string {
  switch (route.type) {
    case 'code': {
      if (!route.path && !route.ref) {
        return '#/';
      }
      const lineHash =
        route.lineRange && route.lineRange.start >= 1
          ? formatLineHash(route.lineRange.start, route.lineRange.end)
          : '';
      const cleanPath = (route.path ?? '').replace(/^\/+/, '');
      if (route.ref) {
        return `#/commit/${route.ref}/blob/${cleanPath}${lineHash}`;
      }
      return cleanPath ? `#/blob/${cleanPath}${lineHash}` : '#/';
    }

    case 'commits':
      return route.ref ? `#/commits/${route.ref}` : '#/commits';

    case 'commit':
      return `#/commit/${route.sha}`;

    case 'issues': {
      const params = new URLSearchParams();
      if (route.filter && route.filter !== 'open') params.set('filter', route.filter);
      if (route.query) params.set('q', route.query);
      if (route.label) params.set('label', route.label);
      if (route.author) params.set('author', route.author);
      const queryStr = params.toString();
      return queryStr ? `#/issues?${queryStr}` : '#/issues';
    }

    case 'issue':
      return `#/issues/${route.id}`;

    case 'pulls': {
      const params = new URLSearchParams();
      if (route.filter && route.filter !== 'open') params.set('filter', route.filter);
      if (route.query) params.set('q', route.query);
      if (route.label) params.set('label', route.label);
      if (route.author) params.set('author', route.author);
      const queryStr = params.toString();
      return queryStr ? `#/pulls?${queryStr}` : '#/pulls';
    }

    case 'pull':
      return route.tab && route.tab !== 'conversation'
        ? `#/pulls/${route.id}/${route.tab}`
        : `#/pulls/${route.id}`;
  }
}
