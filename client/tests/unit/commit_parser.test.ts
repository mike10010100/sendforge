import { describe, expect, it } from 'vitest';
import {
  MalformedCommitError,
  parseCommitPayload,
  parseGitIdent,
  parseLooseObjectEnvelope,
} from '../../src/engine/parser.js';
import { createGitEnvelope } from '../fixtures.js';

describe('Commit Object Parser', () => {
  it('parses a standard single-parent commit', () => {
    const payloadStr = [
      'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      'parent e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
      'author Linus Torvalds <torvalds@linux-foundation.org> 1112911993 -0700',
      'committer Linus Torvalds <torvalds@linux-foundation.org> 1112911993 -0700',
      '',
      'Initial commit subject line',
      '',
      'Detailed body description line 1',
      'Detailed body description line 2',
    ].join('\n');

    const envelope = createGitEnvelope('commit', payloadStr);
    const commit = parseLooseObjectEnvelope(envelope, '1111111111111111111111111111111111111111');

    expect(commit.type).toBe('commit');
    if (commit.type === 'commit') {
      expect(commit.tree).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
      expect(commit.parents).toEqual(['e69de29bb2d1d6434b8b29ae775ad8c2e48c5391']);
      expect(commit.author.name).toBe('Linus Torvalds');
      expect(commit.author.email).toBe('torvalds@linux-foundation.org');
      expect(commit.author.timestamp).toBe(1112911993);
      expect(commit.author.tzOffset).toBe('-0700');
      expect(commit.subject).toBe('Initial commit subject line');
      expect(commit.body).toContain('Detailed body description line 1');
      expect(commit.gpgSig).toBeUndefined();
    }
  });

  it('parses a root commit with 0 parents', () => {
    const payloadStr = [
      'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      'author Satya Nadella <satya@microsoft.com> 1700000000 +0000',
      'committer Satya Nadella <satya@microsoft.com> 1700000000 +0000',
      '',
      'Root commit without parents',
    ].join('\n');

    const envelope = createGitEnvelope('commit', payloadStr);
    const commit = parseLooseObjectEnvelope(envelope, '2222222222222222222222222222222222222222');

    expect(commit.type).toBe('commit');
    if (commit.type === 'commit') {
      expect(commit.parents).toEqual([]);
      expect(commit.subject).toBe('Root commit without parents');
    }
  });

  it('parses a 2-parent merge commit', () => {
    const payloadStr = [
      'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      'parent 1111111111111111111111111111111111111111',
      'parent 2222222222222222222222222222222222222222',
      'author Alice <alice@example.com> 1600000000 +0200',
      'committer Alice <alice@example.com> 1600000000 +0200',
      '',
      'Merge branch feature into main',
    ].join('\n');

    const envelope = createGitEnvelope('commit', payloadStr);
    const commit = parseLooseObjectEnvelope(envelope, '3333333333333333333333333333333333333333');

    expect(commit.type).toBe('commit');
    if (commit.type === 'commit') {
      expect(commit.parents).toEqual([
        '1111111111111111111111111111111111111111',
        '2222222222222222222222222222222222222222',
      ]);
    }
  });

  it('parses an octopus merge commit with 3+ parents', () => {
    const parents = [
      '1111111111111111111111111111111111111111',
      '2222222222222222222222222222222222222222',
      '3333333333333333333333333333333333333333',
      '4444444444444444444444444444444444444444',
    ];
    const payloadStr = [
      'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      ...parents.map((p) => `parent ${p}`),
      'author Dev <dev@example.com> 1600000000 +0000',
      'committer Dev <dev@example.com> 1600000000 +0000',
      '',
      'Octopus merge of 4 branches',
    ].join('\n');

    const envelope = createGitEnvelope('commit', payloadStr);
    const commit = parseLooseObjectEnvelope(envelope, '4444444444444444444444444444444444444444');

    expect(commit.type).toBe('commit');
    if (commit.type === 'commit') {
      expect(commit.parents).toEqual(parents);
    }
  });

  it('parses a GPG signed commit with multiline signature header', () => {
    const sig = [
      '-----BEGIN PGP SIGNATURE-----',
      'Version: GnuPG v2',
      '',
      'iQEcBAABCAAGBQJb8N2VAAoJEK7h...signature...payload',
      '-----END PGP SIGNATURE-----',
    ].join('\n');

    const gpgHeader = sig
      .split('\n')
      .map((line, idx) => (idx === 0 ? `gpgsig ${line}` : ` ${line}`))
      .join('\n');

    const payloadStr = [
      'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      'parent 1111111111111111111111111111111111111111',
      'author Signed Dev <signed@example.com> 1650000000 -0400',
      'committer Signed Dev <signed@example.com> 1650000000 -0400',
      gpgHeader,
      '',
      'Signed commit message 🚀',
    ].join('\n');

    const envelope = createGitEnvelope('commit', payloadStr);
    const commit = parseLooseObjectEnvelope(envelope, '5555555555555555555555555555555555555555');

    expect(commit.type).toBe('commit');
    if (commit.type === 'commit') {
      expect(commit.gpgSig).toBeDefined();
      expect(commit.gpgSig).toContain('BEGIN PGP SIGNATURE');
      expect(commit.subject).toBe('Signed commit message 🚀');
    }
  });

  it('handles edge case idents gracefully', () => {
    const ident = parseGitIdent('No Email 1234567890 +0000');
    expect(ident.name).toBe('No Email');

    const identWithEmptyName = parseGitIdent(' <anon@example.com> 1234567890 -0500');
    expect(identWithEmptyName.email).toBe('anon@example.com');
  });

  it('throws MalformedCommitError on missing tree', () => {
    const payload = new TextEncoder().encode('author Test <t@e.com> 123 +0000\n\nNo tree');
    expect(() => parseCommitPayload(payload, 'test_oid')).toThrow(MalformedCommitError);
  });

  it('throws MalformedCommitError on invalid tree SHA length', () => {
    const payload = new TextEncoder().encode('tree short_sha\nauthor Test <t@e.com> 123 +0000\n\nMsg');
    expect(() => parseCommitPayload(payload, 'test_oid')).toThrow(MalformedCommitError);
  });
});
