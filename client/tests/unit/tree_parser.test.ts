import { describe, expect, it } from 'vitest';
import {
  MalformedTreeError,
  parseLooseObjectEnvelope,
  parseTreePayload,
} from '../../src/engine/parser.js';
import { createGitEnvelope, createTreePayload } from '../fixtures.js';

describe('Tree Object Parser', () => {
  it('parses flat tree with various modes', () => {
    const rawEntries = [
      { mode: '100644', name: 'README.md', oid: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' },
      { mode: '100755', name: 'build.sh', oid: '1111111111111111111111111111111111111111' },
      { mode: '120000', name: 'link_to_readme', oid: '2222222222222222222222222222222222222222' },
      { mode: '160000', name: 'submodule_lib', oid: '3333333333333333333333333333333333333333' },
      { mode: '040000', name: 'src', oid: '4444444444444444444444444444444444444444' },
    ];

    const treePayload = createTreePayload(rawEntries);
    const envelope = createGitEnvelope('tree', treePayload);
    const tree = parseLooseObjectEnvelope(envelope, '5555555555555555555555555555555555555555');

    expect(tree.type).toBe('tree');
    if (tree.type === 'tree') {
      expect(tree.entries.length).toBe(5);

      const srcDir = tree.entries.find((e) => e.name === 'src');
      expect(srcDir).toBeDefined();
      expect(srcDir?.isTree).toBe(true);
      expect(srcDir?.mode).toBe('040000');

      const readme = tree.entries.find((e) => e.name === 'README.md');
      expect(readme?.mode).toBe('100644');
      expect(readme?.isTree).toBe(false);

      const exec = tree.entries.find((e) => e.name === 'build.sh');
      expect(exec?.mode).toBe('100755');

      const symlink = tree.entries.find((e) => e.name === 'link_to_readme');
      expect(symlink?.isSymlink).toBe(true);

      const submodule = tree.entries.find((e) => e.name === 'submodule_lib');
      expect(submodule?.isSubmodule).toBe(true);
    }
  });

  it('normalizes 5-digit octal mode 40000 to 040000', () => {
    const rawEntries = [
      { mode: '40000', name: 'docs', oid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      { mode: '100664', name: 'file.txt', oid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    ];

    const treePayload = createTreePayload(rawEntries);
    const tree = parseTreePayload(treePayload, 'test_oid');

    const docs = tree.entries.find((e) => e.name === 'docs');
    expect(docs?.mode).toBe('040000');
    expect(docs?.isTree).toBe(true);

    const file = tree.entries.find((e) => e.name === 'file.txt');
    expect(file?.mode).toBe('100644');
  });

  it('parses empty tree with 0 entries', () => {
    const emptyPayload = new Uint8Array(0);
    const tree = parseTreePayload(emptyPayload, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');

    expect(tree.type).toBe('tree');
    expect(tree.size).toBe(0);
    expect(tree.entries).toEqual([]);
  });

  it('correctly handles Unicode and spaces in filenames', () => {
    const rawEntries = [
      { mode: '100644', name: 'hello world.txt', oid: '1111111111111111111111111111111111111111' },
      { mode: '100644', name: '日本語ドキュメント.md', oid: '2222222222222222222222222222222222222222' },
      { mode: '100644', name: '.hidden_config', oid: '3333333333333333333333333333333333333333' },
    ];

    const treePayload = createTreePayload(rawEntries);
    const tree = parseTreePayload(treePayload, 'test_oid');

    expect(tree.entries.map((e) => e.name)).toContain('hello world.txt');
    expect(tree.entries.map((e) => e.name)).toContain('日本語ドキュメント.md');
    expect(tree.entries.map((e) => e.name)).toContain('.hidden_config');
  });

  it('throws MalformedTreeError on missing space after mode', () => {
    const corrupted = new TextEncoder().encode('100644nospace\x0012345678901234567890');
    expect(() => parseTreePayload(corrupted, 'test_oid')).toThrow(MalformedTreeError);
  });

  it('throws MalformedTreeError on missing null terminator after path', () => {
    const corrupted = new TextEncoder().encode('100644 filename_without_null');
    expect(() => parseTreePayload(corrupted, 'test_oid')).toThrow(MalformedTreeError);
  });

  it('throws MalformedTreeError on truncated 20-byte SHA-1', () => {
    const header = new TextEncoder().encode('100644 file.txt\0');
    const truncatedSha = new Uint8Array(10); // only 10 bytes instead of 20
    const corrupted = new Uint8Array(header.length + truncatedSha.length);
    corrupted.set(header, 0);
    corrupted.set(truncatedSha, header.length);

    expect(() => parseTreePayload(corrupted, 'test_oid')).toThrow(MalformedTreeError);
  });
});
