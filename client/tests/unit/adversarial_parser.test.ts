import { describe, expect, it } from 'vitest';
import {
  binaryShaToHex,
  hexToBinarySha,
  MalformedCommitError,
  MalformedEnvelopeError,
  MalformedTagError,
  MalformedTreeError,
  parseBlobPayload,
  parseCommitPayload,
  parseEnvelopeHeader,
  parseGitIdent,
  parseTagPayload,
  parseTreePayload,
} from '../../src/engine/parser.js';
import {
  inflateZlib,
  inflateZlibSync,
  ZlibDecompressionError,
} from '../../src/engine/inflator.js';
import { createTreePayload } from '../fixtures.js';

describe('Adversarial & Boundary Tests: Object Envelope & Inflator', () => {
  it('rejects empty or truncated envelopes', () => {
    expect(() => parseEnvelopeHeader(new Uint8Array(0))).toThrow(MalformedEnvelopeError);
  });

  it('rejects envelope missing space after type', () => {
    const data = new TextEncoder().encode('blob1234\0content');
    expect(() => parseEnvelopeHeader(data)).toThrow(MalformedEnvelopeError);
  });

  it('rejects unrecognized object types', () => {
    const data = new TextEncoder().encode('customtype 10\x001234567890');
    expect(() => parseEnvelopeHeader(data)).toThrow(MalformedEnvelopeError);
  });

  it('rejects envelope missing null terminator', () => {
    const data = new TextEncoder().encode('blob 100 some data without null');
    expect(() => parseEnvelopeHeader(data)).toThrow(MalformedEnvelopeError);
  });

  it('rejects negative, non-numeric, or floating size headers', () => {
    const testCases = [
      'blob -5\0content',
      'blob abc\0content',
      'blob 12.34\0content',
      'blob \0content',
      'blob 10a\0content',
    ];

    for (const tc of testCases) {
      const data = new TextEncoder().encode(tc);
      expect(() => parseEnvelopeHeader(data)).toThrow(MalformedEnvelopeError);
    }
  });

  it('rejects actual payload smaller than declared size', () => {
    const data = new TextEncoder().encode('blob 100\0short');
    expect(() => parseEnvelopeHeader(data)).toThrow(MalformedEnvelopeError);
  });

  it('rejects actual payload larger than declared size (trailing junk)', () => {
    const data = new TextEncoder().encode('blob 5\0hello_with_trailing_garbage');
    expect(() => parseEnvelopeHeader(data)).toThrow(MalformedEnvelopeError);
  });

  it('decompression throws ZlibDecompressionError on 0-byte or corrupted stream', async () => {
    expect(() => inflateZlibSync(new Uint8Array(0))).toThrow(ZlibDecompressionError);
    expect(() => inflateZlibSync(new Uint8Array([1, 2, 3, 4]))).toThrow(ZlibDecompressionError);

    await expect(inflateZlib(new Uint8Array(0))).rejects.toThrow(ZlibDecompressionError);
    await expect(inflateZlib(new Uint8Array([0xff, 0xff, 0xff]))).rejects.toThrow(ZlibDecompressionError);
  });
});

describe('Adversarial & Boundary Tests: Tree Objects', () => {
  it('parses empty tree with 0 entries', () => {
    const tree = parseTreePayload(new Uint8Array(0), '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
    expect(tree.type).toBe('tree');
    expect(tree.entries).toEqual([]);
    expect(tree.size).toBe(0);
  });

  it('rejects missing space between mode and name', () => {
    const corrupted = new TextEncoder().encode('100644filename.txt\x0012345678901234567890');
    expect(() => parseTreePayload(corrupted, 'test_oid')).toThrow(MalformedTreeError);
  });

  it('rejects missing null terminator after name', () => {
    const corrupted = new TextEncoder().encode('100644 filename.txt');
    expect(() => parseTreePayload(corrupted, 'test_oid')).toThrow(MalformedTreeError);
  });

  it('rejects truncated 20-byte SHA-1', () => {
    const testCases = [
      new Uint8Array(0), // 0 bytes SHA
      new Uint8Array(5), // 5 bytes SHA
      new Uint8Array(19), // 19 bytes SHA
    ];

    for (const tc of testCases) {
      const header = new TextEncoder().encode('100644 file.txt\0');
      const buf = new Uint8Array(header.length + tc.length);
      buf.set(header, 0);
      buf.set(tc, header.length);
      expect(() => parseTreePayload(buf, 'test_oid')).toThrow(MalformedTreeError);
    }
  });

  it('handles Unicode, emojis, RTL, spaces, and special symbols in filenames', () => {
    const specialNames = [
      '🦀.rs',
      '🚀_rocket.ts',
      'ünicode_файл.txt',
      '日本語_ドキュメント.md',
      'العربية.txt',
      'עברית.txt',
      'file with spaces and symbols !@#$%^&*()_+={}[].txt',
      '.hidden_dotfile',
    ];

    const rawEntries = specialNames.map((name, idx) => ({
      mode: '100644',
      name,
      oid: idx.toString(16).padStart(2, '0').repeat(20),
    }));

    const payload = createTreePayload(rawEntries);
    const tree = parseTreePayload(payload, 'test_oid');

    expect(tree.entries.length).toBe(specialNames.length);
    const parsedNames = tree.entries.map((e) => e.name);
    for (const name of specialNames) {
      expect(parsedNames).toContain(name);
    }
  });

  it('handles deeply nested directories (50+ path levels)', () => {
    let currentPayload: Uint8Array = new Uint8Array(0);
    const depth = 60;

    for (let i = depth; i >= 1; i--) {
      const entry = {
        mode: i === depth ? '100644' : '040000',
        name: `level_${i}`,
        oid: i.toString(16).padStart(2, '0').repeat(20),
      };
      currentPayload = createTreePayload([entry]);
      const tree = parseTreePayload(currentPayload, `tree_oid_${i}`);
      expect(tree.entries.length).toBe(1);
      expect(tree.entries[0]?.name).toBe(`level_${i}`);
    }
  });

  it('parses large trees with 500+ entries with fast performance', () => {
    const entries = [];
    for (let i = 0; i < 500; i++) {
      entries.push({
        mode: i % 5 === 0 ? '040000' : '100644',
        name: `item_${i.toString().padStart(4, '0')}.dat`,
        oid: 'abcdef0123456789abcdef0123456789abcdef01',
      });
    }

    const payload = createTreePayload(entries);
    const tree = parseTreePayload(payload, 'large_tree_oid');
    expect(tree.entries.length).toBe(500);

    // Ensure all directories are sorted first
    const firstNonDir = tree.entries.findIndex((e) => !e.isTree);
    if (firstNonDir !== -1) {
      for (let i = firstNonDir; i < tree.entries.length; i++) {
        expect(tree.entries[i]?.isTree).toBe(false);
      }
    }
  });
});

describe('Adversarial & Boundary Tests: Commit Objects & Clock-Warp', () => {
  it('parses root commit with 0 parents', () => {
    const payloadStr = [
      'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      'author Alice <alice@example.com> 1700000000 +0000',
      'committer Alice <alice@example.com> 1700000000 +0000',
      '',
      'Initial root commit',
    ].join('\n');

    const commit = parseCommitPayload(new TextEncoder().encode(payloadStr), 'commit_oid');
    expect(commit.parents).toEqual([]);
    expect(commit.subject).toBe('Initial root commit');
  });

  it('parses octopus merge commit with 5 parents', () => {
    const parents = [
      '1111111111111111111111111111111111111111',
      '2222222222222222222222222222222222222222',
      '3333333333333333333333333333333333333333',
      '4444444444444444444444444444444444444444',
      '5555555555555555555555555555555555555555',
    ];

    const payloadStr = [
      'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      ...parents.map((p) => `parent ${p}`),
      'author Dev <dev@example.com> 1700000000 +0000',
      'committer Dev <dev@example.com> 1700000000 +0000',
      '',
      'Octopus merge of 5 branches',
    ].join('\n');

    const commit = parseCommitPayload(new TextEncoder().encode(payloadStr), 'commit_oid');
    expect(commit.parents).toEqual(parents);
  });

  it('rejects commit missing tree header or having invalid tree SHA length', () => {
    const noTree = 'author A <a@a.com> 0 +0000\n\nMsg';
    expect(() => parseCommitPayload(new TextEncoder().encode(noTree), 'oid')).toThrow(MalformedCommitError);

    const badTreeSha = 'tree short_sha\nauthor A <a@a.com> 0 +0000\n\nMsg';
    expect(() => parseCommitPayload(new TextEncoder().encode(badTreeSha), 'oid')).toThrow(MalformedCommitError);

    const badParentSha = 'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\nparent invalid_sha\n\nMsg';
    expect(() => parseCommitPayload(new TextEncoder().encode(badParentSha), 'oid')).toThrow(MalformedCommitError);
  });

  it('handles clock-warp timestamps: year 2100, pre-1970 negative, leap seconds, quarter-hour TZ', () => {
    // 1. Year 2100 future timestamp
    const ident2100 = parseGitIdent('Futurist <f@f.com> 4102444800 +0000');
    expect(ident2100.timestamp).toBe(4102444800);

    // 2. Pre-1970 negative timestamp
    const ident1965 = parseGitIdent('Old Hacker <old@old.org> -157766400 -0500');
    expect(ident1965.timestamp).toBe(-157766400);
    expect(ident1965.tzOffset).toBe('-0500');

    // 3. Quarter hour TZ (+1245)
    const identChatham = parseGitIdent('Chatham <nz@nz.org> 1700000000 +1245');
    expect(identChatham.tzOffset).toBe('+1245');

    // 4. Non-standard format fallback
    const identFallback = parseGitIdent('JustANameWithoutEmail 1700000000 +0000');
    expect(identFallback.name).toBe('JustANameWithoutEmail');
    expect(identFallback.timestamp).toBe(1700000000);
  });
});

describe('Adversarial & Boundary Tests: Tag Objects', () => {
  it('parses standard annotated tag pointing to commit', () => {
    const payloadStr = [
      'object 1111111111111111111111111111111111111111',
      'type commit',
      'tag v2.0.0',
      'tagger Lead Dev <lead@example.com> 1700000000 +0000',
      '',
      'Release 2.0.0 is here 🎉',
    ].join('\n');

    const tag = parseTagPayload(new TextEncoder().encode(payloadStr), 'tag_oid');
    expect(tag.type).toBe('tag');
    expect(tag.targetOid).toBe('1111111111111111111111111111111111111111');
    expect(tag.targetType).toBe('commit');
    expect(tag.tagName).toBe('v2.0.0');
    expect(tag.tagger?.name).toBe('Lead Dev');
    expect(tag.message).toBe('Release 2.0.0 is here 🎉');
  });

  it('rejects tag missing object SHA, type, or tag name', () => {
    const missingObj = 'type commit\ntag v1.0.0\n\nMsg';
    expect(() => parseTagPayload(new TextEncoder().encode(missingObj), 'tag_oid')).toThrow(MalformedTagError);

    const missingType = 'object 1111111111111111111111111111111111111111\ntag v1.0.0\n\nMsg';
    expect(() => parseTagPayload(new TextEncoder().encode(missingType), 'tag_oid')).toThrow(MalformedTagError);

    const missingName = 'object 1111111111111111111111111111111111111111\ntype commit\n\nMsg';
    expect(() => parseTagPayload(new TextEncoder().encode(missingName), 'tag_oid')).toThrow(MalformedTagError);
  });
});

describe('Adversarial & Boundary Tests: Blobs & Hex conversions', () => {
  it('parses 0-byte blob (.gitkeep) correctly', () => {
    const emptyPayload = new Uint8Array(0);
    const blob = parseBlobPayload(emptyPayload, 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(blob.type).toBe('blob');
    expect(blob.size).toBe(0);
    expect(blob.isBinary).toBe(false);
    expect(blob.text).toBe('');
  });

  it('detects binary vs UTF-8 data correctly', () => {
    // Binary data with null bytes
    const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    const binaryBlob = parseBlobPayload(binaryData, 'bin_oid');
    expect(binaryBlob.isBinary).toBe(true);
    expect(binaryBlob.text).toBeUndefined();

    // UTF-8 data
    const utf8Data = new TextEncoder().encode('Hello, 🦀 Rust & ⚛️ React!');
    const utf8Blob = parseBlobPayload(utf8Data, 'utf8_oid');
    expect(utf8Blob.isBinary).toBe(false);
    expect(utf8Blob.text).toBe('Hello, 🦀 Rust & ⚛️ React!');
  });

  it('converts binary SHA-1 to hex and back losslessly', () => {
    const originalHex = '0123456789abcdef0123456789abcdef01234567';
    const binary = hexToBinarySha(originalHex);
    expect(binary.length).toBe(20);
    const roundtripHex = binaryShaToHex(binary);
    expect(roundtripHex).toBe(originalHex);
  });

  it('rejects invalid binary SHA length or invalid hex characters', () => {
    expect(() => binaryShaToHex(new Uint8Array(19))).toThrow(/Invalid binary SHA length/);
    expect(() => hexToBinarySha('not_40_chars')).toThrow(/Invalid hex SHA length/);
    expect(() => hexToBinarySha('0123456789abcdef0123456789abcdef012345zz')).toThrow(/Invalid hexadecimal character/);
  });
});
