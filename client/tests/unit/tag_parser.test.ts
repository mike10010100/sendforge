import { describe, expect, it } from 'vitest';
import {
  MalformedTagError,
  parseLooseObjectEnvelope,
  parseTagPayload,
} from '../../src/engine/parser.js';
import { createGitEnvelope } from '../fixtures.js';

describe('Annotated Tag Parser', () => {
  it('parses an annotated tag object pointing to a commit', () => {
    const payloadStr = [
      'object 1111111111111111111111111111111111111111',
      'type commit',
      'tag v1.0.0',
      'tagger Release Manager <rel@example.com> 1700000000 +0000',
      '',
      'Release v1.0.0 official build',
      '- Feature A',
      '- Feature B',
    ].join('\n');

    const envelope = createGitEnvelope('tag', payloadStr);
    const tag = parseLooseObjectEnvelope(envelope, '2222222222222222222222222222222222222222');

    expect(tag.type).toBe('tag');
    if (tag.type === 'tag') {
      expect(tag.targetOid).toBe('1111111111111111111111111111111111111111');
      expect(tag.targetType).toBe('commit');
      expect(tag.tagName).toBe('v1.0.0');
      expect(tag.tagger?.name).toBe('Release Manager');
      expect(tag.tagger?.email).toBe('rel@example.com');
      expect(tag.message).toContain('Release v1.0.0 official build');
    }
  });

  it('parses a tag without tagger header', () => {
    const payloadStr = [
      'object 3333333333333333333333333333333333333333',
      'type commit',
      'tag v0.9.0',
      '',
      'Simple tag without tagger ident',
    ].join('\n');

    const envelope = createGitEnvelope('tag', payloadStr);
    const tag = parseLooseObjectEnvelope(envelope, '4444444444444444444444444444444444444444');

    expect(tag.type).toBe('tag');
    if (tag.type === 'tag') {
      expect(tag.targetOid).toBe('3333333333333333333333333333333333333333');
      expect(tag.tagName).toBe('v0.9.0');
      expect(tag.tagger).toBeUndefined();
    }
  });

  it('throws MalformedTagError on missing target object', () => {
    const payload = new TextEncoder().encode('type commit\ntag v1.0\n\nMsg');
    expect(() => parseTagPayload(payload, 'test_oid')).toThrow(MalformedTagError);
  });

  it('throws MalformedTagError on missing target type', () => {
    const payload = new TextEncoder().encode('object 1111111111111111111111111111111111111111\ntag v1.0\n\nMsg');
    expect(() => parseTagPayload(payload, 'test_oid')).toThrow(MalformedTagError);
  });

  it('throws MalformedTagError on missing tag name', () => {
    const payload = new TextEncoder().encode('object 1111111111111111111111111111111111111111\ntype commit\n\nMsg');
    expect(() => parseTagPayload(payload, 'test_oid')).toThrow(MalformedTagError);
  });
});
