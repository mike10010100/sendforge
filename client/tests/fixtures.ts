import crypto from 'node:crypto';
import pako from 'pako';
import type { GitObjectType } from '../src/engine/types.js';

/**
 * Creates an authentic uncompressed Git loose object envelope: "${type} ${payload.length}\0${payload}"
 */
export function createGitEnvelope(type: GitObjectType, payload: Uint8Array | string): Uint8Array {
  const payloadBytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  const headerStr = `${type} ${payloadBytes.length}\0`;
  const headerBytes = new TextEncoder().encode(headerStr);

  const fullBytes = new Uint8Array(headerBytes.length + payloadBytes.length);
  fullBytes.set(headerBytes, 0);
  fullBytes.set(payloadBytes, headerBytes.length);
  return fullBytes;
}

/**
 * Compresses an uncompressed Git envelope into authentic zlib-deflated bytes.
 */
export function createCompressedGitObject(
  type: GitObjectType,
  payload: Uint8Array | string
): { readonly compressed: Uint8Array; readonly oid: string; readonly uncompressed: Uint8Array } {
  const uncompressed = createGitEnvelope(type, payload);
  const oid = crypto.createHash('sha1').update(uncompressed).digest('hex');
  const compressed = pako.deflate(uncompressed);
  return { compressed, oid, uncompressed };
}

/**
 * Creates a raw binary Git tree payload from entry records: [mode, name, oid]
 */
export function createTreePayload(
  entries: readonly { mode: string; name: string; oid: string }[]
): Uint8Array {
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();

  for (const entry of entries) {
    const modeAndName = encoder.encode(`${entry.mode} ${entry.name}\0`);
    const shaBytes = Buffer.from(entry.oid, 'hex');
    const entryBytes = new Uint8Array(modeAndName.length + 20);
    entryBytes.set(modeAndName, 0);
    entryBytes.set(shaBytes, modeAndName.length);
    chunks.push(entryBytes);
  }

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
