import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inflateZlibSync } from '../../src/engine/inflator.js';
import {
  MalformedEnvelopeError,
  parseLooseObjectEnvelope,
} from '../../src/engine/parser.js';

describe('Browser Git Runtime Binary Fixture Integration', () => {
  const fixturesDir = path.resolve(__dirname, '../fixtures/objects');

  it('loads and parses binary blob fixtures', () => {
    const emptyBlobBytes = fs.readFileSync(path.join(fixturesDir, 'blob_empty.bin'));
    const uncompressedEmpty = inflateZlibSync(new Uint8Array(emptyBlobBytes));
    const emptyBlob = parseLooseObjectEnvelope(uncompressedEmpty, 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');

    expect(emptyBlob.type).toBe('blob');
    if (emptyBlob.type === 'blob') {
      expect(emptyBlob.size).toBe(0);
      expect(emptyBlob.isBinary).toBe(false);
    }

    const asciiBytes = fs.readFileSync(path.join(fixturesDir, 'blob_ascii.bin'));
    const uncompressedAscii = inflateZlibSync(new Uint8Array(asciiBytes));
    const asciiBlob = parseLooseObjectEnvelope(uncompressedAscii);
    expect(asciiBlob.type).toBe('blob');
    if (asciiBlob.type === 'blob') {
      expect(asciiBlob.text).toContain('export function add');
    }

    const utf8Bytes = fs.readFileSync(path.join(fixturesDir, 'blob_utf8.bin'));
    const uncompressedUtf8 = inflateZlibSync(new Uint8Array(utf8Bytes));
    const utf8Blob = parseLooseObjectEnvelope(uncompressedUtf8);
    expect(utf8Blob.type).toBe('blob');
    if (utf8Blob.type === 'blob') {
      expect(utf8Blob.text).toContain('静的ファースト');
    }

    const binaryBytes = fs.readFileSync(path.join(fixturesDir, 'blob_binary.bin'));
    const uncompressedBinary = inflateZlibSync(new Uint8Array(binaryBytes));
    const binaryBlob = parseLooseObjectEnvelope(uncompressedBinary);
    expect(binaryBlob.type).toBe('blob');
    if (binaryBlob.type === 'blob') {
      expect(binaryBlob.isBinary).toBe(true);
      expect(binaryBlob.text).toBeUndefined();
    }
  });

  it('loads and parses binary tree fixtures', () => {
    const treeBytes = fs.readFileSync(path.join(fixturesDir, 'tree_flat.bin'));
    const uncompressedTree = inflateZlibSync(new Uint8Array(treeBytes));
    const tree = parseLooseObjectEnvelope(uncompressedTree);

    expect(tree.type).toBe('tree');
    if (tree.type === 'tree') {
      expect(tree.entries.length).toBe(2);
      expect(tree.entries.map((e) => e.name)).toContain('README.md');
      expect(tree.entries.map((e) => e.name)).toContain('build.sh');
    }
  });

  it('loads and parses binary commit fixtures', () => {
    const rootBytes = fs.readFileSync(path.join(fixturesDir, 'commit_root.bin'));
    const uncompressedRoot = inflateZlibSync(new Uint8Array(rootBytes));
    const rootCommit = parseLooseObjectEnvelope(uncompressedRoot);

    expect(rootCommit.type).toBe('commit');
    if (rootCommit.type === 'commit') {
      expect(rootCommit.parents).toEqual([]);
      expect(rootCommit.subject).toBe('Initial root commit');
    }

    const stdBytes = fs.readFileSync(path.join(fixturesDir, 'commit_standard.bin'));
    const uncompressedStd = inflateZlibSync(new Uint8Array(stdBytes));
    const stdCommit = parseLooseObjectEnvelope(uncompressedStd);

    expect(stdCommit.type).toBe('commit');
    if (stdCommit.type === 'commit') {
      expect(stdCommit.parents.length).toBe(1);
    }

    const mergeBytes = fs.readFileSync(path.join(fixturesDir, 'commit_merge.bin'));
    const uncompressedMerge = inflateZlibSync(new Uint8Array(mergeBytes));
    const mergeCommit = parseLooseObjectEnvelope(uncompressedMerge);

    expect(mergeCommit.type).toBe('commit');
    if (mergeCommit.type === 'commit') {
      expect(mergeCommit.parents.length).toBe(2);
    }
  });

  it('loads and parses binary tag fixture', () => {
    const tagBytes = fs.readFileSync(path.join(fixturesDir, 'tag_annotated.bin'));
    const uncompressedTag = inflateZlibSync(new Uint8Array(tagBytes));
    const tag = parseLooseObjectEnvelope(uncompressedTag);

    expect(tag.type).toBe('tag');
    if (tag.type === 'tag') {
      expect(tag.tagName).toBe('v1.0.0');
      expect(tag.targetType).toBe('commit');
    }
  });

  it('handles corrupted fixture envelopes', () => {
    const corruptHeaderBytes = fs.readFileSync(path.join(fixturesDir, 'corrupt_header.bin'));
    const uncompressed = inflateZlibSync(new Uint8Array(corruptHeaderBytes));

    expect(() => parseLooseObjectEnvelope(uncompressed)).toThrow(MalformedEnvelopeError);
  });
});
