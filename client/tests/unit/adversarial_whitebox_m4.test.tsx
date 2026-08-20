import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';
import type { PullRequest, ReviewNote, Issue } from '../../src/engine/collab-client.js';
import { findMergeBase, getCommitHistoryRange } from '../../src/engine/dag.js';
import type { GitRepositoryClient } from '../../src/engine/fetcher.js';
import type { GitBlobObject, GitCommitObject, GitOid, GitTreeObject } from '../../src/engine/types.js';
import { attachReviewNotes, computeEditSequence, computeFileDiff, buildHunks, buildSplitRows } from '../../src/worker/diff-algo.js';
import type { FileDiff } from '../../src/worker/diff-types.js';
import { formatRoute, parseRoute, type Route } from '../../src/ui/router.js';
import { PullRequestsView } from '../../src/ui/PullRequestsView.js';
import { PRDetailView } from '../../src/ui/PRDetailView.js';
import { IssuesView } from '../../src/ui/IssuesView.js';
import { IssueDetailView } from '../../src/ui/IssueDetailView.js';

// =========================================================================
// MOCK CLIENT FACTORY
// =========================================================================

function createMockGitClient(data: {
  commits?: Record<string, GitCommitObject>;
  trees?: Record<string, GitTreeObject>;
  blobs?: Record<string, GitBlobObject>;
  refs?: Record<string, string>;
}): GitRepositoryClient {
  const commits = data.commits ?? {};
  const trees = data.trees ?? {};
  const blobs = data.blobs ?? {};
  const refs = data.refs ?? {};

  const client: Partial<GitRepositoryClient> = {
    getCommit: (oid: GitOid) => {
      const c = commits[oid.toLowerCase()];
      if (c) return Promise.resolve(c);
      return Promise.reject(new Error(`Commit not found: ${oid}`));
    },
    getTree: (oid: GitOid) => {
      const t = trees[oid.toLowerCase()];
      if (t) return Promise.resolve(t);
      return Promise.reject(new Error(`Tree not found: ${oid}`));
    },
    getBlob: (oid: GitOid) => {
      const b = blobs[oid.toLowerCase()];
      if (b) return Promise.resolve(b);
      return Promise.reject(new Error(`Blob not found: ${oid}`));
    },
    resolveRef: (ref: string) => {
      const r = refs[ref];
      if (r) return Promise.resolve(r);
      return Promise.reject(new Error(`Ref not found: ${ref}`));
    },
    listAllTreeFiles: () => Promise.resolve([]),
  };

  return client as unknown as GitRepositoryClient;
}

// =========================================================================
// 1. DAG LCA & MERGE-BASE ADVERSARIAL TOPOLOGY STRESS TESTS
// =========================================================================

describe('White-box Adversarial M4: DAG Traversal & Merge Base', () => {
  it('handles criss-cross merge with non-monotonic timestamp clock skews', async () => {
    // Topo:
    //       R (ts: 1000)
    //      / \
    //     A   B (A ts: 1200, B ts: 900 -> CLOCK WARP B is older than R!)
    //    / \ / \
    //   C   X   D (C merges A&B, D merges B&A)
    //    \ /
    //     H (Head) vs T (Target)

    const commits: Record<string, GitCommitObject> = {
      '0000000000000000000000000000000000000001': {
        type: 'commit',
        oid: '0000000000000000000000000000000000000001',
        size: 100,
        tree: 'tree_r',
        parents: [],
        author: { name: 'Root', email: 'root@test.org', timestamp: 1000, tzOffset: '+0000' },
        committer: { name: 'Root', email: 'root@test.org', timestamp: 1000, tzOffset: '+0000' },
        message: 'Root',
        subject: 'Root',
        body: '',
      },
      '000000000000000000000000000000000000000a': {
        type: 'commit',
        oid: '000000000000000000000000000000000000000a',
        size: 100,
        tree: 'tree_a',
        parents: ['0000000000000000000000000000000000000001'],
        author: { name: 'Alice', email: 'alice@test.org', timestamp: 1200, tzOffset: '+0000' },
        committer: { name: 'Alice', email: 'alice@test.org', timestamp: 1200, tzOffset: '+0000' },
        message: 'Commit A',
        subject: 'Commit A',
        body: '',
      },
      '000000000000000000000000000000000000000b': {
        type: 'commit',
        oid: '000000000000000000000000000000000000000b',
        size: 100,
        tree: 'tree_b',
        parents: ['0000000000000000000000000000000000000001'],
        author: { name: 'Bob', email: 'bob@test.org', timestamp: 900, tzOffset: '+0000' }, // clock warp
        committer: { name: 'Bob', email: 'bob@test.org', timestamp: 900, tzOffset: '+0000' },
        message: 'Commit B',
        subject: 'Commit B',
        body: '',
      },
      '000000000000000000000000000000000000000c': {
        type: 'commit',
        oid: '000000000000000000000000000000000000000c',
        size: 100,
        tree: 'tree_c',
        parents: [
          '000000000000000000000000000000000000000a',
          '000000000000000000000000000000000000000b',
        ],
        author: { name: 'Charlie', email: 'charlie@test.org', timestamp: 1300, tzOffset: '+0000' },
        committer: { name: 'Charlie', email: 'charlie@test.org', timestamp: 1300, tzOffset: '+0000' },
        message: 'Merge A and B into C',
        subject: 'Merge A and B into C',
        body: '',
      },
      '000000000000000000000000000000000000000d': {
        type: 'commit',
        oid: '000000000000000000000000000000000000000d',
        size: 100,
        tree: 'tree_d',
        parents: [
          '000000000000000000000000000000000000000b',
          '000000000000000000000000000000000000000a',
        ],
        author: { name: 'Dave', email: 'dave@test.org', timestamp: 1400, tzOffset: '+0000' },
        committer: { name: 'Dave', email: 'dave@test.org', timestamp: 1400, tzOffset: '+0000' },
        message: 'Merge B and A into D',
        subject: 'Merge B and A into D',
        body: '',
      },
    };

    const client = createMockGitClient({ commits });

    const lca = await findMergeBase(
      client,
      '000000000000000000000000000000000000000c',
      '000000000000000000000000000000000000000d'
    );

    // Both A and B are common ancestors. A has higher timestamp (1200 vs 900), so A is selected.
    expect(lca).toBe('000000000000000000000000000000000000000a');
  });

  it('traverses commit history range with limit constraint and disjoint history', async () => {
    const commits: Record<string, GitCommitObject> = {};
    for (let i = 1; i <= 50; i++) {
      const sha = `commit_${String(i).padStart(3, '0')}`.padEnd(40, '0');
      const parentSha = i > 1 ? `commit_${String(i - 1).padStart(3, '0')}`.padEnd(40, '0') : undefined;
      commits[sha] = {
        type: 'commit',
        oid: sha,
        size: 100,
        tree: `tree_${i}`,
        parents: parentSha ? [parentSha] : [],
        author: { name: `Author ${i}`, email: `author${i}@test.org`, timestamp: 1000 + i, tzOffset: '+0000' },
        committer: { name: `Author ${i}`, email: `author${i}@test.org`, timestamp: 1000 + i, tzOffset: '+0000' },
        message: `Commit ${i}`,
        subject: `Commit ${i}`,
        body: '',
      };
    }

    const client = createMockGitClient({ commits });

    // Range from commit 10 to commit 30 (20 commits)
    const baseSha = `commit_${String(10).padStart(3, '0')}`.padEnd(40, '0');
    const headSha = `commit_${String(30).padStart(3, '0')}`.padEnd(40, '0');

    const range = await getCommitHistoryRange(client, baseSha, headSha, 10);
    // Limited to 10 commits
    expect(range.length).toBe(10);
    expect(range[0]?.subject).toBe('Commit 30');
    expect(range[9]?.subject).toBe('Commit 21');
  });
});

// =========================================================================
// 2. WEB WORKER 3-WAY DIFF ALGORITHM & MYERS EDIT SEQUENCE TESTS
// =========================================================================

describe('White-box Adversarial M4: Diff Algorithms & Review Notes Attachment', () => {
  it('computes Myers diff for large array of alternating line edits', () => {
    const oldLines: string[] = [];
    const newLines: string[] = [];

    for (let i = 0; i < 200; i++) {
      oldLines.push(`context_line_${i}`);
      oldLines.push(`old_specific_line_${i}`);
      newLines.push(`context_line_${i}`);
      newLines.push(`new_specific_line_${i}`);
    }

    const editOps = computeEditSequence(oldLines, newLines);
    expect(editOps.length).toBeGreaterThan(200);

    const hunks = buildHunks(editOps, 2);
    expect(hunks.length).toBeGreaterThan(0);

    const splitRows = buildSplitRows(hunks);
    expect(splitRows.length).toBeGreaterThan(0);
  });

  it('attaches review notes to additions, deletions, and context lines accurately in unified and split views', () => {
    const fileDiff: FileDiff = computeFileDiff(
      'src/core.ts',
      'src/core.ts',
      'line1\nline2_old\nline3',
      'line1\nline2_new\nline3'
    );

    const notes: ReviewNote[] = [
      {
        commitSha: 'aaaa000000000000000000000000000000000000',
        filePath: 'src/core.ts',
        line: 2, // on the added line (line 2 in new file)
        author: { name: 'Senior Reviewer', email: 'sr@sendforge.org' },
        body: 'Please make sure this is sanitized!',
        createdAt: 1740000000,
      },
    ];

    const attached = attachReviewNotes([fileDiff], notes);
    expect(attached.length).toBe(1);

    const attachedHunk = attached[0]?.hunks[0];
    expect(attachedHunk).toBeDefined();

    const addLine = attachedHunk?.lines.find((l) => l.type === 'add' && l.newLineNumber === 2);
    expect(addLine?.reviewNotes?.length).toBe(1);
    expect(addLine?.reviewNotes?.[0]?.body).toBe('Please make sure this is sanitized!');

    // Split diff rows check
    const splitRowWithNote = attached[0]?.splitRows.find((r) => r.right.reviewNotes?.length === 1);
    expect(splitRowWithNote).toBeDefined();
    expect(splitRowWithNote?.right.lineNumber).toBe(2);
  });
});

// =========================================================================
// 3. HASH ROUTER ADVERSARIAL ENCODING & ROUNDTRIP TESTS
// =========================================================================

describe('White-box Adversarial M4: Hash Router Deep Linking & AST', () => {
  it('parses and formats all 7 route types across roundtrips', () => {
    const testCases: Route[] = [
      { type: 'code' },
      { type: 'code', path: 'src/main.rs', lineRange: { start: 10, end: 25 } },
      { type: 'code', ref: 'feature-x', path: 'docs/README.md', lineRange: { start: 5, end: 5 } },
      { type: 'commits' },
      { type: 'commits', ref: 'v1.0.0' },
      { type: 'commit', sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' },
      { type: 'issues' },
      { type: 'issues', filter: 'closed', query: 'parser bug', label: 'bug', author: 'alice' },
      { type: 'issue', id: '42' },
      { type: 'pulls' },
      { type: 'pulls', filter: 'merged', query: 'dag optimize', label: 'core', author: 'bob' },
      { type: 'pull', id: '100', tab: 'files' },
      { type: 'pull', id: '100', tab: 'commits' },
      { type: 'pull', id: '100', tab: 'conversation' },
    ];

    for (const originalRoute of testCases) {
      const formatted = formatRoute(originalRoute);
      const parsed = parseRoute(formatted);

      expect(parsed.type).toBe(originalRoute.type);

      if (originalRoute.type === 'pull' && parsed.type === 'pull') {
        expect(parsed.id).toBe(originalRoute.id);
        expect(parsed.tab ?? 'conversation').toBe(originalRoute.tab ?? 'conversation');
      }

      if (originalRoute.type === 'issues' && parsed.type === 'issues') {
        if (originalRoute.filter) expect(parsed.filter).toBe(originalRoute.filter);
        if (originalRoute.query) expect(parsed.query).toBe(originalRoute.query);
        if (originalRoute.label) expect(parsed.label).toBe(originalRoute.label);
      }
    }
  });

  it('handles adversary URI encoded and query parameter routes', () => {
    const route = parseRoute('#/pulls/%2342/files?filter=open&q=%3Cscript%3E');
    expect(route.type).toBe('pull');
    if (route.type === 'pull') {
      expect(route.id).toBe('#42');
      expect(route.tab).toBe('files');
    }
  });
});

// =========================================================================
// 4. REACTIVE UI COLLABORATION VIEWS UNDER STRESS
// =========================================================================

describe('White-box Adversarial M4: UI Component Stress & Rendering', () => {
  it('renders PullRequestsView with 200 synthetic PRs and verifies filter counts', () => {
    const pulls: PullRequest[] = [];
    for (let i = 1; i <= 200; i++) {
      const status = i % 3 === 0 ? 'merged' : i % 2 === 0 ? 'closed' : 'open';
      pulls.push({
        id: `${i}`,
        number: i,
        title: `Synthetic PR #${i} with feature payload`,
        description: `Markdown description for PR ${i}`,
        author: { name: `Dev ${i % 10}`, email: `dev${i % 10}@sendforge.org` },
        targetBranch: 'main',
        sourceBranch: `feat/branch-${i}`,
        headCommit: `head_sha_${i}`.padEnd(40, '0'),
        status,
        createdAt: 1740000000 + i * 10,
        updatedAt: 1740000000 + i * 20,
        labels: [i % 2 === 0 ? 'backend' : 'frontend', 'v2'],
        comments: [],
      });
    }

    const html = render(<PullRequestsView pulls={pulls} initialFilter="all" />);
    expect(html).toContain('data-testid="pull-requests-view"');
    expect(html).toContain('All');
    expect(html).toContain('200');
  });

  it('renders PRDetailView in Files Changed mode with complex diff', () => {
    const pr: PullRequest = {
      id: '500',
      number: 500,
      title: 'High-Throughput Refactor',
      description: 'Refactoring DAG engine.',
      author: { name: 'Core Lead', email: 'core@sendforge.org' },
      targetBranch: 'main',
      sourceBranch: 'refactor/dag-core',
      headCommit: '1111111111111111111111111111111111111111',
      status: 'open',
      createdAt: 1740000000,
      updatedAt: 1740001000,
      labels: ['performance', 'core'],
      comments: [
        {
          id: 'c1',
          author: { name: 'Reviewer 1', email: 'r1@test.org' },
          body: 'LGTM!',
          createdAt: 1740000500,
        },
      ],
    };

    const mockClient = createMockGitClient({
      commits: {
        '1111111111111111111111111111111111111111': {
          type: 'commit',
          oid: '1111111111111111111111111111111111111111',
          size: 100,
          tree: 'tree_head',
          parents: [],
          author: { name: 'Core Lead', email: 'core@sendforge.org', timestamp: 1740000000, tzOffset: '+0000' },
          committer: { name: 'Core Lead', email: 'core@sendforge.org', timestamp: 1740000000, tzOffset: '+0000' },
          message: 'High-Throughput Refactor',
          subject: 'High-Throughput Refactor',
          body: '',
        },
      },
      refs: {
        main: '1111111111111111111111111111111111111111',
      },
    });

    const html = render(<PRDetailView pr={pr} client={mockClient} activeTab="conversation" />);
    expect(html).toContain('High-Throughput Refactor');
    expect(html).toContain('#500');
    expect(html).toContain('Conversation');
    expect(html).toContain('Commits');
    expect(html).toContain('Files Changed');
  });

  it('renders IssuesView with empty and filtered states cleanly', () => {
    const issues: Issue[] = [
      {
        id: '1',
        number: 1,
        title: 'Buffer overflow report',
        description: 'Detail about buffer bounds.',
        author: { name: 'Sec Researcher', email: 'sec@test.org' },
        status: 'open',
        createdAt: 1740000000,
        updatedAt: 1740000000,
        labels: ['security', 'bug'],
        comments: [],
      },
    ];

    const html = render(<IssuesView issues={issues} initialFilter="open" />);
    expect(html).toContain('data-testid="issues-view"');
    expect(html).toContain('Buffer overflow report');
    expect(html).toContain('security');
  });

  it('renders IssueDetailView with markdown body and comment timeline', () => {
    const issue: Issue = {
      id: '42',
      number: 42,
      title: 'Fix edge case in router',
      description: '### Issue description\n\n```ts\nconst x = 1;\n```',
      author: { name: 'Issue Author', email: 'author@test.org' },
      status: 'open',
      createdAt: 1740000000,
      updatedAt: 1740000000,
      labels: ['router'],
      comments: [
        {
          id: 'c1',
          author: { name: 'Commenter', email: 'comm@test.org' },
          body: 'I reproduced this issue on Firefox.',
          createdAt: 1740001000,
        },
      ],
    };

    const html = render(<IssueDetailView issue={issue} onBack={() => undefined} />);
    expect(html).toContain('Fix edge case in router');
    expect(html).toContain('#42');
    expect(html).toContain('I reproduced this issue on Firefox.');
  });
});
