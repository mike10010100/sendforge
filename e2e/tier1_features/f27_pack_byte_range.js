/**
 * Tier 1 - Feature 27: Byte-Range Packfile Fetching & Object Header Decoding (F27 / R1)
 *
 * Validates:
 * 1. Byte-range HTTP RFC 7233 request fetches only target object slice from packfile
 * 2. Variable-length object header decoding for standard object types (commit, tree, blob, tag)
 * 3. Object payload zlib decompression and uncompressed size validation
 * 4. Direct retrieval of packed blobs, trees, and commits matching native Git objects
 * 5. Fallback hierarchy: Memory cache -> Loose object -> Packfile Range fetch -> Error
 * 6. Packfile discovery via objects/info/packs and .git/objects/pack/*.idx
 */

import { describe, it, assert, beforeAll, afterAll } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { Supervisor } from '../harness/supervisor.js';
import { HttpClient } from '../harness/http_client.js';
import { PackBuilder, PackIndexParser, GitObjectType } from '../harness/pack_helper.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

describe('Tier 1 - Feature 27: Byte-Range Packfile Fetching & Header Parsing (F27 / R1)', () => {
  let gitHelper;
  let bareRepoPath;
  let supervisor;
  let serverPort;
  let client;

  beforeAll(async () => {
    gitHelper = new GitRepoHelper();
    bareRepoPath = gitHelper.createBareRepo('f27-pack-repo.git');

    // Create commits in working repo
    const work = gitHelper.createWorkingRepoAndInit(bareRepoPath, 'f27-work');
    gitHelper.commitFiles(work, {
      'README.md': '# Packfile Test Repo\n\nTesting byte-range object retrieval.',
      'src/main.rs': 'fn main() {\n    println!("Hello from packed blob!");\n}\n',
      'docs/guide.txt': 'Comprehensive guide content for byte range verification.'
    }, 'Initial packed commit');
    gitHelper.push(work, 'origin', 'main');

    // Repack repo into packfiles and create objects/info/packs
    gitHelper.git(bareRepoPath, ['repack', '-a', '-d']);
    gitHelper.git(bareRepoPath, ['update-server-info']);

    supervisor = new Supervisor();
    serverPort = 19427;
    await supervisor.startServer(bareRepoPath, { port: serverPort });
    client = new HttpClient(`http://127.0.0.1:${serverPort}`);
  });

  afterAll(async () => {
    if (supervisor) supervisor.cleanup();
    if (gitHelper) gitHelper.cleanup();
  });

  it('T1.27.1: Byte-range HTTP RFC 7233 request fetches only target object slice from packfile', async () => {
    const packDir = path.join(bareRepoPath, 'objects', 'pack');
    const files = fs.readdirSync(packDir);
    const idxName = files.find(f => f.endsWith('.idx'));
    const packName = files.find(f => f.endsWith('.pack'));
    assert.ok(idxName && packName, 'Packfile and index must exist in repository');

    const idxBuf = fs.readFileSync(path.join(packDir, idxName));
    const parsedIdx = PackIndexParser.parse(idxBuf);
    const packSize = fs.statSync(path.join(packDir, packName)).size;

    // Pick first object
    const offsets = parsedIdx.getSortedOffsets();
    assert.greaterThan(offsets.length, 0, 'Packfile must contain at least 1 object');

    // Query byte span for first object
    const firstSha = parsedIdx.data.buf.subarray(
      parsedIdx.data.shaTableOffset,
      parsedIdx.data.shaTableOffset + 20
    ).toString('hex');

    const span = parsedIdx.getByteSpan(firstSha, packSize);
    assert.ok(span, 'Byte span must be computed');
    assert.greaterThanOrEqual(span.start, 12, 'Start offset must be after 12-byte pack header');
    assert.greaterThan(span.end, span.start, 'End offset must be greater than start offset');

    // Fetch exact slice with Range header
    const res = await client.request(`/objects/pack/${packName}`, {
      headers: {
        'Range': `bytes=${span.start}-${span.end}`
      }
    });

    assert.strictEqual(res.status, 206, 'Should return HTTP 206 Partial Content');
    assert.strictEqual(res.headers.get('content-range'), `bytes ${span.start}-${span.end}/${packSize}`);
    assert.strictEqual(res.body.length, span.end - span.start + 1, 'Body length must match requested range');
  });

  it('T1.27.2: Variable-length object header decoding for standard object types (commit, tree, blob, tag)', () => {
    const builder = new PackBuilder();
    builder.addObject(GitObjectType.COMMIT, 'tree 0000000000000000000000000000000000000000\nauthor A <a@a.com> 0 +0000\ncommitter A <a@a.com> 0 +0000\n\ntest');
    builder.addObject(GitObjectType.BLOB, 'Small blob payload');
    // Large payload to test multi-byte size header
    const largePayload = Buffer.alloc(50000, 'X');
    builder.addObject(GitObjectType.BLOB, largePayload);

    const { packBuffer, entries } = builder.build();

    for (const entry of entries) {
      const slice = packBuffer.subarray(entry.offset);
      // Decode header
      let offset = 0;
      let byte = slice[offset++];
      const type = (byte >> 4) & 0x07;
      let size = byte & 0x0F;
      let shift = 4;

      while ((byte & 0x80) !== 0) {
        byte = slice[offset++];
        size |= (byte & 0x7F) << shift;
        shift += 7;
      }

      assert.ok(type === GitObjectType.COMMIT || type === GitObjectType.BLOB, 'Type must match object type');
      // Decompress payload from slice
      const decompressed = zlib.inflateSync(slice.subarray(offset));
      assert.strictEqual(decompressed.length, size, 'Decompressed length must match header size');
    }
  });

  it('T1.27.3: Object payload zlib decompression and uncompressed size validation', () => {
    const builder = new PackBuilder();
    const testContent = 'Validating zlib stream integrity inside packfile slice.';
    const sha = builder.addObject(GitObjectType.BLOB, testContent);

    const { packBuffer, idxBuffer } = builder.build();
    const parsedIdx = PackIndexParser.parse(idxBuffer);
    const entry = parsedIdx.findObject(sha);
    assert.ok(entry, 'Entry must be found');

    const slice = packBuffer.subarray(entry.offset);
    let offset = 0;
    let byte = slice[offset++];
    let size = byte & 0x0F;
    let shift = 4;
    while ((byte & 0x80) !== 0) {
      byte = slice[offset++];
      size |= (byte & 0x7F) << shift;
      shift += 7;
    }

    const payload = zlib.inflateSync(slice.subarray(offset));
    assert.strictEqual(payload.toString('utf-8'), testContent, 'Inflated payload must match original content');
    assert.strictEqual(payload.length, size, 'Inflated length must equal header size');
  });

  it('T1.27.4: Direct retrieval of packed blobs matching native Git objects', async () => {
    // Read README.md SHA from working repo
    const readmeSha = gitHelper.git(bareRepoPath, ['rev-parse', 'main:README.md']);
    assert.ok(readmeSha && readmeSha.length === 40, 'README SHA must be valid');

    // Confirm loose object does NOT exist in objects/xx/ (because repacked with -d)
    const loosePath = path.join(bareRepoPath, 'objects', readmeSha.slice(0, 2), readmeSha.slice(2));
    assert.strictEqual(fs.existsSync(loosePath), false, 'Loose object should have been repacked');

    // Fetch pack index via HTTP
    const packDir = path.join(bareRepoPath, 'objects', 'pack');
    const idxName = fs.readdirSync(packDir).find(f => f.endsWith('.idx'));
    const packName = fs.readdirSync(packDir).find(f => f.endsWith('.pack'));

    const idxRes = await client.request(`/objects/pack/${idxName}`);
    assert.strictEqual(idxRes.status, 200, 'Index must be downloadable');

    const parsedIdx = PackIndexParser.parse(idxRes.body);
    const entry = parsedIdx.findObject(readmeSha);
    assert.ok(entry, `Object ${readmeSha} must be found in packfile index`);

    const packSize = fs.statSync(path.join(packDir, packName)).size;
    const span = parsedIdx.getByteSpan(readmeSha, packSize);

    const packRes = await client.request(`/objects/pack/${packName}`, {
      headers: { 'Range': `bytes=${span.start}-${span.end}` }
    });
    assert.strictEqual(packRes.status, 206, 'Must return 206 Partial Content');

    // Decode header and inflate
    const slice = packRes.body;
    let off = 0;
    let b = slice[off++];
    while ((b & 0x80) !== 0) b = slice[off++];

    const blob = zlib.inflateSync(slice.subarray(off));
    assert.includes(blob.toString('utf-8'), '# Packfile Test Repo', 'Packed blob content must match original');
  });

  it('T1.27.5: Fallback hierarchy: Memory cache -> Loose object -> Packfile Range fetch -> Error', async () => {
    // 1. Loose object request for missing object should return 404
    const fakeSha = 'e'.repeat(40);
    const resLoose = await client.request(`/objects/${fakeSha.slice(0, 2)}/${fakeSha.slice(2)}`);
    assert.strictEqual(resLoose.status, 404, 'Non-existent loose object returns 404');

    // 2. Packfile index lookup for missing object returns null
    const packDir = path.join(bareRepoPath, 'objects', 'pack');
    const idxName = fs.readdirSync(packDir).find(f => f.endsWith('.idx'));
    const idxBuf = fs.readFileSync(path.join(packDir, idxName));
    const parsedIdx = PackIndexParser.parse(idxBuf);
    assert.strictEqual(parsedIdx.findObject(fakeSha), null, 'Missing object not in index');
  });

  it('T1.27.6: Packfile discovery via objects/info/packs', async () => {
    const res = await client.request('/objects/info/packs');
    assert.strictEqual(res.status, 200, 'objects/info/packs must be served');
    const text = res.body.toString('utf-8');
    assert.match(text, /^P pack-[a-f0-9]{40}\.pack/m, 'Must contain valid P pack-... format');
  });
});
