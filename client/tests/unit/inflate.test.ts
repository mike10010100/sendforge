import { describe, expect, it } from 'vitest';
import pako from 'pako';
import { inflateZlib, inflateZlibSync, ZlibDecompressionError } from '../../src/engine/inflator.js';

describe('Zlib Inflator', () => {
  it('decompresses valid zlib payload synchronously', () => {
    const originalText = 'Hello, Sendforge In-Browser Git Engine!';
    const compressed = pako.deflate(new TextEncoder().encode(originalText));

    const decompressed = inflateZlibSync(compressed);
    const resultText = new TextDecoder().decode(decompressed);

    expect(resultText).toBe(originalText);
  });

  it('decompresses valid zlib payload asynchronously', async () => {
    const originalText = 'Async decompression test string with multi-byte chars: 🚀 日本語';
    const compressed = pako.deflate(new TextEncoder().encode(originalText));

    const decompressed = await inflateZlib(compressed);
    const resultText = new TextDecoder().decode(decompressed);

    expect(resultText).toBe(originalText);
  });

  it('throws ZlibDecompressionError on 0-byte input', () => {
    expect(() => inflateZlibSync(new Uint8Array(0))).toThrow(ZlibDecompressionError);
  });

  it('throws ZlibDecompressionError on corrupted zlib stream', () => {
    const corrupted = new Uint8Array([0x78, 0x9c, 0x12, 0x34, 0x56]); // bad payload
    expect(() => inflateZlibSync(corrupted)).toThrow(ZlibDecompressionError);
  });

  it('throws ZlibDecompressionError on truncated input', () => {
    const original = pako.deflate(new TextEncoder().encode('Some large string to be truncated'));
    const truncated = original.subarray(0, 10);
    expect(() => inflateZlibSync(truncated)).toThrow(ZlibDecompressionError);
  });
});
