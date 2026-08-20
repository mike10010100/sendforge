import pako from 'pako';

export class ZlibDecompressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZlibDecompressionError';
  }
}

/**
 * Synchronously decompresses a zlib-deflated buffer using pako.
 */
export function inflateZlibSync(compressed: Uint8Array): Uint8Array {
  if (compressed.length === 0) {
    throw new ZlibDecompressionError('Unexpected end of input: 0-byte compressed buffer');
  }

  try {
    return pako.inflate(compressed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ZlibDecompressionError(`Corrupted zlib stream: ${msg}`);
  }
}

/**
 * Asynchronously decompresses a zlib-deflated buffer.
 * Uses DecompressionStream('deflate') if available in the browser runtime,
 * falling back seamlessly to pako.
 */
export async function inflateZlib(compressed: Uint8Array): Promise<Uint8Array> {
  if (compressed.length === 0) {
    throw new ZlibDecompressionError('Unexpected end of input: 0-byte compressed buffer');
  }

  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      const writePromise = writer.write(compressed as unknown as BufferSource).then(() => writer.close());
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      const readAll = async (): Promise<void> => {
        for (;;) {
          const res = await reader.read();
          if (res.done) {
            break;
          }
          chunks.push(res.value);
          totalLength += res.value.length;
        }
      };

      await Promise.all([writePromise, readAll()]);

      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    } catch {
      // Fallback to pako
      return inflateZlibSync(compressed);
    }
  }

  return inflateZlibSync(compressed);
}
