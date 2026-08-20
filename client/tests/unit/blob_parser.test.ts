import { describe, expect, it } from 'vitest';
import {
  MalformedEnvelopeError,
  parseBlobPayload,
  parseEnvelopeHeader,
  parseLooseObjectEnvelope,
} from '../../src/engine/parser.js';
import { createGitEnvelope } from '../fixtures.js';

describe('Blob Object & Envelope Parser', () => {
  it('parses empty blob (0 bytes)', () => {
    const emptyPayload = new Uint8Array(0);
    const envelope = createGitEnvelope('blob', emptyPayload);
    const blob = parseLooseObjectEnvelope(envelope, 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');

    expect(blob.type).toBe('blob');
    if (blob.type === 'blob') {
      expect(blob.size).toBe(0);
      expect(blob.isBinary).toBe(false);
      expect(blob.text).toBe('');
      expect(blob.data.length).toBe(0);
    }
  });

  it('parses ASCII text blob', () => {
    const textContent = 'console.log("Hello from Sendforge!");\n';
    const envelope = createGitEnvelope('blob', textContent);
    const blob = parseLooseObjectEnvelope(envelope, '1111111111111111111111111111111111111111');

    expect(blob.type).toBe('blob');
    if (blob.type === 'blob') {
      expect(blob.size).toBe(textContent.length);
      expect(blob.isBinary).toBe(false);
      expect(blob.text).toBe(textContent);
    }
  });

  it('parses UTF-8 multibyte text blob', () => {
    const textContent = '🚀 Sendforge: 静的ファーストのGitフォージ\n';
    const payload = new TextEncoder().encode(textContent);
    const envelope = createGitEnvelope('blob', payload);
    const blob = parseLooseObjectEnvelope(envelope, '2222222222222222222222222222222222222222');

    expect(blob.type).toBe('blob');
    if (blob.type === 'blob') {
      expect(blob.isBinary).toBe(false);
      expect(blob.text).toBe(textContent);
    }
  });

  it('detects binary file containing null bytes', () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
    const blob = parseBlobPayload(pngHeader, '3333333333333333333333333333333333333333');

    expect(blob.type).toBe('blob');
    expect(blob.isBinary).toBe(true);
    expect(blob.text).toBeUndefined();
    expect(blob.data).toEqual(pngHeader);
  });

  it('throws MalformedEnvelopeError on empty envelope buffer', () => {
    expect(() => parseEnvelopeHeader(new Uint8Array(0))).toThrow(MalformedEnvelopeError);
  });

  it('throws MalformedEnvelopeError on missing space after object type', () => {
    const corrupted = new TextEncoder().encode('blob10\x001234567890');
    expect(() => parseEnvelopeHeader(corrupted)).toThrow(MalformedEnvelopeError);
  });

  it('throws MalformedEnvelopeError on unrecognized object type', () => {
    const corrupted = new TextEncoder().encode('custom 5\0hello');
    expect(() => parseEnvelopeHeader(corrupted)).toThrow(MalformedEnvelopeError);
  });

  it('throws MalformedEnvelopeError on missing null terminator after size', () => {
    const corrupted = new TextEncoder().encode('blob 5hello');
    expect(() => parseEnvelopeHeader(corrupted)).toThrow(MalformedEnvelopeError);
  });

  it('throws MalformedEnvelopeError on payload size shorter than header', () => {
    const corrupted = new TextEncoder().encode('blob 100\0short');
    expect(() => parseEnvelopeHeader(corrupted)).toThrow(MalformedEnvelopeError);
  });

  it('throws MalformedEnvelopeError on extra trailing bytes after payload', () => {
    const corrupted = new TextEncoder().encode('blob 4\0helloworld');
    expect(() => parseEnvelopeHeader(corrupted)).toThrow(MalformedEnvelopeError);
  });
});
