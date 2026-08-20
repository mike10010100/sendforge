import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CollabClient,
  loadIssues,
  loadPullRequests,
  loadReviewNotes,
  normalizeAuthor,
  normalizeComment,
  normalizeIssue,
  normalizePullRequest,
  normalizeReviewNote,
} from '../../src/engine/collab-client.js';
import { GitRepositoryClient } from '../../src/engine/fetcher.js';
import { createCompressedGitObject, createTreePayload } from '../fixtures.js';

describe('Milestone M2: Collaboration Client & Notes Engine (collab-client.ts)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Normalization Helpers', () => {
    it('normalizes author with missing or invalid fields to fallback defaults', () => {
      expect(normalizeAuthor(null)).toEqual({ name: 'Anonymous', email: 'anonymous@sendforge.local' });
      expect(normalizeAuthor({ name: 'Alice', email: 'alice@example.com' })).toEqual({
        name: 'Alice',
        email: 'alice@example.com',
      });
      expect(normalizeAuthor({ name: '   ', email: '' })).toEqual({
        name: 'Anonymous',
        email: '',
      });
    });

    it('normalizes comment with snake_case created_at and camelCase createdAt', () => {
      const c1 = normalizeComment({ id: 'c1', body: 'Great work', created_at: 1700000000 });
      expect(c1.id).toBe('c1');
      expect(c1.body).toBe('Great work');
      expect(c1.createdAt).toBe(1700000000);

      const c2 = normalizeComment({ id: 'c2', body: 'Approved', createdAt: 1700001000 });
      expect(c2.createdAt).toBe(1700001000);
    });

    it('normalizes pull request supporting Rust snake_case JSON schema', () => {
      const raw = {
        id: '1',
        number: 1,
        title: 'Feature X',
        description: 'PR Description',
        author: { name: 'Bob', email: 'bob@example.com' },
        target_branch: 'main',
        source_branch: 'feature/x',
        head_commit: 'a1b2c3d4e5f6',
        status: 'open',
        created_at: 1700000000,
        updated_at: 1700002000,
        labels: ['enhancement'],
        comments: [{ id: '1', body: 'Comment 1', created_at: 1700001000 }],
      };

      const pr = normalizePullRequest(raw);
      expect(pr).not.toBeNull();
      expect(pr?.targetBranch).toBe('main');
      expect(pr?.sourceBranch).toBe('feature/x');
      expect(pr?.headCommit).toBe('a1b2c3d4e5f6');
      expect(pr?.status).toBe('open');
      expect(pr?.createdAt).toBe(1700000000);
      expect(pr?.labels).toEqual(['enhancement']);
      expect(pr?.comments).toHaveLength(1);
    });

    it('normalizes issue supporting Rust snake_case JSON schema', () => {
      const raw = {
        id: '1',
        number: 1,
        title: 'Issue 1',
        description: 'Bug description',
        author: { name: 'Alice', email: 'alice@example.com' },
        status: 'open',
        created_at: 1700000000,
        updated_at: 1700002000,
        labels: ['bug'],
        comments: [{ id: '1', body: 'Investigating', created_at: 1700001000 }],
      };

      const issue = normalizeIssue(raw);
      expect(issue).not.toBeNull();
      expect(issue?.title).toBe('Issue 1');
      expect(issue?.description).toBe('Bug description');
      expect(issue?.status).toBe('open');
      expect(issue?.createdAt).toBe(1700000000);
      expect(issue?.labels).toEqual(['bug']);
      expect(issue?.comments).toHaveLength(1);
    });

    it('normalizes review note with file path and line number', () => {
      const note = normalizeReviewNote(
        {
          file_path: 'src/main.rs',
          line: 42,
          author: { name: 'Reviewer', email: 'rev@example.com' },
          body: 'Consider refactoring this match statement',
          created_at: 1700000000,
        },
        'defaultsha123'
      );

      expect(note).not.toBeNull();
      expect(note?.commitSha).toBe('defaultsha123');
      expect(note?.filePath).toBe('src/main.rs');
      expect(note?.line).toBe(42);
      expect(note?.body).toBe('Consider refactoring this match statement');
    });
  });

  describe('loadPullRequests and loadIssues', () => {
    it('loads pull requests from /static/pulls.json', async () => {
      const mockPulls = [
        {
          id: '1',
          number: 1,
          title: 'PR #1',
          target_branch: 'main',
          head_commit: 'sha1',
          status: 'open',
        },
      ];

      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url.includes('pulls.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockPulls),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }));

      const pulls = await loadPullRequests('');
      expect(pulls).toHaveLength(1);
      expect(pulls[0]?.title).toBe('PR #1');
      expect(pulls[0]?.targetBranch).toBe('main');
    });

    it('falls back to empty array if pulls.json returns 404', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
      const pulls = await loadPullRequests('');
      expect(pulls).toEqual([]);
    });

    it('loads issues from /static/issues.json', async () => {
      const mockIssues = [
        {
          id: '1',
          number: 1,
          title: 'Bug Report #1',
          description: 'Something failed',
          status: 'open',
          labels: ['bug'],
        },
      ];

      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url.includes('issues.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockIssues),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }));

      const issues = await loadIssues('');
      expect(issues).toHaveLength(1);
      expect(issues[0]?.title).toBe('Bug Report #1');
      expect(issues[0]?.status).toBe('open');
    });
  });

  describe('loadReviewNotes', () => {
    it('discovers and parses review notes from refs/notes/reviews Git tree', async () => {
      const targetCommitSha = '1111111111111111111111111111111111111111';

      // 1. Note blob containing JSON payload
      const noteJson = JSON.stringify({
        filePath: 'src/lib.rs',
        line: 10,
        author: { name: 'Reviewer', email: 'rev@test.com' },
        body: 'Looks great!',
        createdAt: 1700000000,
      });
      const noteBlob = createCompressedGitObject('blob', noteJson);

      // 2. Tree referencing the note blob named after the target commit SHA
      const treePayload = createTreePayload([{ mode: '100644', name: targetCommitSha, oid: noteBlob.oid }]);
      const tree = createCompressedGitObject('tree', treePayload);

      // 3. Notes commit
      const notesCommitPayload = [
        `tree ${tree.oid}`,
        'author Notes Bot <bot@example.com> 1700000000 +0000',
        'committer Notes Bot <bot@example.com> 1700000000 +0000',
        '',
        'Notes commit',
      ].join('\n');
      const notesCommit = createCompressedGitObject('commit', notesCommitPayload);

      const objects = new Map<string, Uint8Array>([
        [noteBlob.oid, noteBlob.compressed],
        [tree.oid, tree.compressed],
        [notesCommit.oid, notesCommit.compressed],
      ]);

      const client = new GitRepositoryClient('');
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url.includes('info/refs')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(`${notesCommit.oid}\trefs/notes/reviews\n`),
          });
        }

        const parts = url.split('/');
        const p1 = parts[parts.length - 2] ?? '';
        const p2 = parts[parts.length - 1] ?? '';
        const oid = (p1 + p2).toLowerCase();
        const data = objects.get(oid);
        if (data) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/x-git-loose-object' }),
            arrayBuffer: () => Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }));

      const notes = await loadReviewNotes(client, targetCommitSha);
      expect(notes).toHaveLength(1);
      expect(notes[0]?.commitSha).toBe(targetCommitSha);
      expect(notes[0]?.filePath).toBe('src/lib.rs');
      expect(notes[0]?.line).toBe(10);
      expect(notes[0]?.body).toBe('Looks great!');
    });

    it('parses array of JSON notes and plaintext notes fallback', async () => {
      const targetCommitSha = '2222222222222222222222222222222222222222';
      const arrayNoteJson = JSON.stringify([
        { filePath: 'a.ts', line: 5, body: 'Note 1' },
        { filePath: 'b.ts', line: 15, body: 'Note 2' },
      ]);
      const noteBlob1 = createCompressedGitObject('blob', arrayNoteJson);
      const plainBlob = createCompressedGitObject('blob', 'LGTM overall!');

      const treePayload = createTreePayload([
        { mode: '100644', name: targetCommitSha, oid: noteBlob1.oid },
        { mode: '100644', name: '3333333333333333333333333333333333333333', oid: plainBlob.oid },
      ]);
      const tree = createCompressedGitObject('tree', treePayload);

      const notesCommit = createCompressedGitObject(
        'commit',
        `tree ${tree.oid}\nauthor Bot <b@ex.com> 1000 +0000\ncommitter Bot <b@ex.com> 1000 +0000\n\nNotes\n`
      );

      const objects = new Map<string, Uint8Array>([
        [noteBlob1.oid, noteBlob1.compressed],
        [plainBlob.oid, plainBlob.compressed],
        [tree.oid, tree.compressed],
        [notesCommit.oid, notesCommit.compressed],
      ]);

      const client = new GitRepositoryClient('');
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url.includes('info/refs')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(`${notesCommit.oid}\trefs/notes/reviews\n`),
          });
        }
        const parts = url.split('/');
        const p1 = parts[parts.length - 2] ?? '';
        const p2 = parts[parts.length - 1] ?? '';
        const oid = (p1 + p2).toLowerCase();
        const data = objects.get(oid);
        if (data) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/x-git-loose-object' }),
            arrayBuffer: () => Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }));

      const notes = await loadReviewNotes(client);
      expect(notes).toHaveLength(3);
      expect(notes.some((n) => n.body === 'Note 1')).toBe(true);
      expect(notes.some((n) => n.body === 'Note 2')).toBe(true);
      expect(notes.some((n) => n.body === 'LGTM overall!')).toBe(true);
    });
  });

  describe('CollabClient Class', () => {
    it('caches loaded items in memory and provides find methods', async () => {
      const mockPulls = [
        { id: '1', number: 1, title: 'PR 1' },
        { id: '2', number: 2, title: 'PR 2' },
      ];
      const mockIssues = [
        { id: '10', number: 10, title: 'Issue 10' },
      ];

      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url.includes('pulls.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockPulls),
          });
        }
        if (url.includes('issues.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockIssues),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }));

      const client = new CollabClient('');
      const p1 = await client.getPullRequest(1);
      expect(p1?.title).toBe('PR 1');

      const p2 = await client.getPullRequest('2');
      expect(p2?.title).toBe('PR 2');

      const nonExistent = await client.getPullRequest(99);
      expect(nonExistent).toBeNull();

      const i1 = await client.getIssue(10);
      expect(i1?.title).toBe('Issue 10');

      const iNonExistent = await client.getIssue(999);
      expect(iNonExistent).toBeNull();
    });
  });
});
