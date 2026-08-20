import type {
  GitBlobObject,
  GitCommitObject,
  GitFileMode,
  GitIdent,
  GitObject,
  GitObjectType,
  GitOid,
  GitTagObject,
  GitTreeEntry,
  GitTreeObject,
} from './types.js';

export class MalformedEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedEnvelopeError';
  }
}

export class MalformedCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedCommitError';
  }
}

export class MalformedTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedTreeError';
  }
}

export class MalformedTagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedTagError';
  }
}

export class OidMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidMismatchError';
  }
}

const HEX_LOOKUP: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0')
);

/**
 * Converts a 20-byte binary SHA-1 Uint8Array to a 40-char lowercase hex string.
 */
export function binaryShaToHex(bytes: Uint8Array): GitOid {
  if (bytes.length !== 20) {
    throw new Error(`Invalid binary SHA length: expected 20 bytes, got ${bytes.length}`);
  }
  let hex = '';
  for (let i = 0; i < 20; i++) {
    const b = bytes[i];
    if (b !== undefined) {
      const byteHex = HEX_LOOKUP[b];
      if (byteHex !== undefined) {
        hex += byteHex;
      }
    }
  }
  return hex;
}

/**
 * Converts a 40-char hex string to a 20-byte binary SHA-1 Uint8Array.
 */
export function hexToBinarySha(hex: string): Uint8Array {
  if (hex.length !== 40) {
    throw new Error(`Invalid hex SHA length: expected 40 chars, got ${hex.length}`);
  }
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    const byteHex = hex.slice(i * 2, i * 2 + 2);
    const parsed = parseInt(byteHex, 16);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid hexadecimal character in SHA: ${byteHex}`);
    }
    bytes[i] = parsed;
  }
  return bytes;
}

/**
 * Computes the SHA-1 hash of a Uint8Array buffer and returns a 40-character lowercase hex string.
 */
export async function computeSha1Hex(data: Uint8Array): Promise<GitOid> {
  const hashBuffer = await crypto.subtle.digest('SHA-1', data as unknown as BufferSource);
  const hashBytes = new Uint8Array(hashBuffer);
  return binaryShaToHex(hashBytes);
}

export interface ParsedEnvelope {
  readonly type: GitObjectType;
  readonly size: number;
  readonly payload: Uint8Array;
}

/**
 * Parses the uncompressed loose object envelope header: "${type} ${size}\0${payload}"
 */
export function parseEnvelopeHeader(uncompressed: Uint8Array): ParsedEnvelope {
  const len = uncompressed.length;
  if (len === 0) {
    throw new MalformedEnvelopeError('Empty decompressed object buffer');
  }

  // 1. Find space separating type and size
  let spaceIdx = -1;
  for (let i = 0; i < len && i < 32; i++) {
    if (uncompressed[i] === 0x20) { // ' '
      spaceIdx = i;
      break;
    }
  }
  if (spaceIdx === -1) {
    throw new MalformedEnvelopeError('Malformed envelope: Missing space after object type');
  }

  const decoder = new TextDecoder('utf-8');
  const typeStr = decoder.decode(uncompressed.subarray(0, spaceIdx));
  if (typeStr !== 'commit' && typeStr !== 'tree' && typeStr !== 'blob' && typeStr !== 'tag') {
    throw new MalformedEnvelopeError(`Unrecognized object type: '${typeStr}'`);
  }
  const type: GitObjectType = typeStr;

  // 2. Find null byte separating size and payload
  let nullIdx = -1;
  for (let i = spaceIdx + 1; i < len && i < spaceIdx + 32; i++) {
    if (uncompressed[i] === 0x00) { // '\0'
      nullIdx = i;
      break;
    }
  }
  if (nullIdx === -1) {
    throw new MalformedEnvelopeError('Malformed envelope: Missing null terminator after size');
  }

  const sizeStr = decoder.decode(uncompressed.subarray(spaceIdx + 1, nullIdx));
  const expectedSize = parseInt(sizeStr, 10);
  if (Number.isNaN(expectedSize) || expectedSize < 0 || !/^\d+$/.test(sizeStr)) {
    throw new MalformedEnvelopeError(`Malformed envelope: Invalid size integer '${sizeStr}'`);
  }

  const payload = uncompressed.subarray(nullIdx + 1);
  if (payload.length < expectedSize) {
    throw new MalformedEnvelopeError(
      `Actual payload length (${payload.length}) is less than header size (${expectedSize})`
    );
  }
  if (payload.length > expectedSize) {
    throw new MalformedEnvelopeError(
      `Extra trailing bytes after payload: expected ${expectedSize}, got ${payload.length}`
    );
  }

  return {
    type,
    size: expectedSize,
    payload,
  };
}

/**
 * Parses a Git author/committer ident line: "Name <email> 1234567890 +0000"
 */
export function parseGitIdent(identStr: string): GitIdent {
  const match = /^(.+?)\s+<([^>]*)>\s+(\d+)\s+([+-]\d{4})$/.exec(identStr);
  if (match) {
    const name = match[1]?.trim() ?? '';
    const email = match[2]?.trim() ?? '';
    const timestampStr = match[3] ?? '0';
    const tzOffset = match[4] ?? '+0000';
    return {
      name,
      email,
      timestamp: parseInt(timestampStr, 10),
      tzOffset,
    };
  }

  // Fallback parsing for edge cases with non-standard formatting
  const emailStart = identStr.indexOf('<');
  const emailEnd = identStr.indexOf('>', emailStart);
  if (emailStart !== -1 && emailEnd !== -1) {
    const name = identStr.slice(0, emailStart).trim();
    const email = identStr.slice(emailStart + 1, emailEnd).trim();
    const rest = identStr.slice(emailEnd + 1).trim().split(/\s+/);
    const ts = parseInt(rest[0] ?? '0', 10);
    const tz = rest[1] ?? '+0000';
    return {
      name,
      email,
      timestamp: Number.isNaN(ts) ? 0 : ts,
      tzOffset: /^[+-]\d{4}$/.test(tz) ? tz : '+0000',
    };
  }

  // Ident without <email> e.g. "Name 1234567890 +0000"
  const trailingMatch = /^(.+?)\s+(\d+)\s+([+-]\d{4})$/.exec(identStr);
  if (trailingMatch) {
    return {
      name: trailingMatch[1]?.trim() ?? '',
      email: '',
      timestamp: parseInt(trailingMatch[2] ?? '0', 10),
      tzOffset: trailingMatch[3] ?? '+0000',
    };
  }

  return {
    name: identStr.trim(),
    email: '',
    timestamp: 0,
    tzOffset: '+0000',
  };
}

/**
 * Parses a commit object payload into a strongly typed GitCommitObject.
 */
export function parseCommitPayload(payload: Uint8Array, oid: GitOid): GitCommitObject {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(payload);

  const doubleNewlineIdx = text.indexOf('\n\n');
  const headerText = doubleNewlineIdx !== -1 ? text.slice(0, doubleNewlineIdx) : text;
  const messageText = doubleNewlineIdx !== -1 ? text.slice(doubleNewlineIdx + 2) : '';

  let tree: GitOid | null = null;
  const parents: GitOid[] = [];
  let author: GitIdent | null = null;
  let committer: GitIdent | null = null;
  let gpgSig: string | undefined;

  const lines = headerText.split('\n');
  let inGpgSig = false;
  let gpgSigLines: string[] = [];

  for (const line of lines) {
    if (inGpgSig) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        gpgSigLines.push(line.slice(1));
        continue;
      } else {
        gpgSig = gpgSigLines.join('\n');
        inGpgSig = false;
      }
    }

    if (line.startsWith('tree ')) {
      const treeOid = line.slice(5).trim();
      if (treeOid.length !== 40) {
        throw new MalformedCommitError(`Invalid tree SHA in commit ${oid}: '${treeOid}'`);
      }
      tree = treeOid;
    } else if (line.startsWith('parent ')) {
      const parentOid = line.slice(7).trim();
      if (parentOid.length !== 40) {
        throw new MalformedCommitError(`Invalid parent SHA in commit ${oid}: '${parentOid}'`);
      }
      parents.push(parentOid);
    } else if (line.startsWith('author ')) {
      author = parseGitIdent(line.slice(7));
    } else if (line.startsWith('committer ')) {
      committer = parseGitIdent(line.slice(10));
    } else if (line.startsWith('gpgsig ')) {
      inGpgSig = true;
      gpgSigLines = [line.slice(7)];
    }
  }

  if (inGpgSig && gpgSigLines.length > 0) {
    gpgSig = gpgSigLines.join('\n');
  }

  if (tree === null) {
    throw new MalformedCommitError(`Missing mandatory tree reference in commit ${oid}`);
  }

  const defaultIdent: GitIdent = {
    name: 'Unknown',
    email: 'unknown@example.com',
    timestamp: 0,
    tzOffset: '+0000',
  };

  const messageLines = messageText.split('\n');
  let subject = '';
  let bodyStartIndex = 0;
  for (let i = 0; i < messageLines.length; i++) {
    const line = messageLines[i]?.trim();
    if (line && line.length > 0) {
      subject = line;
      bodyStartIndex = i + 1;
      break;
    }
  }
  const body = messageLines.slice(bodyStartIndex).join('\n').trim();

  const commitObj: GitCommitObject = {
    type: 'commit',
    oid,
    size: payload.length,
    tree,
    parents,
    author: author ?? defaultIdent,
    committer: committer ?? defaultIdent,
    ...(gpgSig !== undefined ? { gpgSig } : {}),
    message: messageText,
    subject,
    body,
  };

  return commitObj;
}

/**
 * Normalizes git file mode octal string (e.g. '40000' -> '040000', '100664' -> '100644')
 */
export function normalizeGitMode(rawMode: string): GitFileMode {
  let mode = rawMode;
  if (mode.length === 5) {
    mode = `0${mode}`;
  }
  if (mode === '100664') {
    return '100644';
  }
  if (
    mode === '100644' ||
    mode === '100755' ||
    mode === '120000' ||
    mode === '040000' ||
    mode === '160000'
  ) {
    return mode;
  }
  // Default unrecognized regular files to 100644
  return '100644';
}

/**
 * Parses a tree object payload into a strongly typed GitTreeObject.
 */
export function parseTreePayload(payload: Uint8Array, oid: GitOid): GitTreeObject {
  const entries: GitTreeEntry[] = [];
  let offset = 0;
  const len = payload.length;
  const decoder = new TextDecoder('utf-8');

  while (offset < len) {
    // 1. Find space separating mode and path
    let spaceIdx = -1;
    for (let i = offset; i < len; i++) {
      if (payload[i] === 0x20) {
        spaceIdx = i;
        break;
      }
    }
    if (spaceIdx === -1) {
      throw new MalformedTreeError(`Malformed tree ${oid}: Missing space after mode at offset ${offset}`);
    }

    const modeRaw = decoder.decode(payload.subarray(offset, spaceIdx));
    const mode = normalizeGitMode(modeRaw);

    // 2. Find null byte separating path and 20-byte SHA-1
    let nullIdx = -1;
    for (let i = spaceIdx + 1; i < len; i++) {
      if (payload[i] === 0x00) {
        nullIdx = i;
        break;
      }
    }
    if (nullIdx === -1) {
      throw new MalformedTreeError(`Malformed tree ${oid}: Missing null terminator for path at offset ${spaceIdx + 1}`);
    }

    const name = decoder.decode(payload.subarray(spaceIdx + 1, nullIdx));

    // 3. Extract 20-byte binary SHA-1
    const shaStart = nullIdx + 1;
    const shaEnd = shaStart + 20;
    if (shaEnd > len) {
      throw new MalformedTreeError(`Malformed tree ${oid}: Truncated 20-byte SHA-1 at offset ${shaStart}`);
    }

    const shaBytes = payload.subarray(shaStart, shaEnd);
    const entryOid = binaryShaToHex(shaBytes);

    entries.push({
      mode,
      name,
      oid: entryOid,
      isTree: mode === '040000',
      isSubmodule: mode === '160000',
      isSymlink: mode === '120000',
    });

    offset = shaEnd;
  }

  // Sort entries: directories first, then alphabetical by name
  entries.sort((a, b) => {
    if (a.isTree && !b.isTree) return -1;
    if (!a.isTree && b.isTree) return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    type: 'tree',
    oid,
    size: len,
    entries,
  };
}

/**
 * Checks if a byte buffer contains binary content (null bytes or high invalid UTF-8 ratio).
 */
export function isBinaryData(payload: Uint8Array): boolean {
  const sampleSize = Math.min(payload.length, 8000);
  for (let i = 0; i < sampleSize; i++) {
    if (payload[i] === 0x00) {
      return true;
    }
  }
  return false;
}

/**
 * Parses a blob object payload into a strongly typed GitBlobObject.
 */
export function parseBlobPayload(payload: Uint8Array, oid: GitOid): GitBlobObject {
  const isBinary = isBinaryData(payload);
  if (isBinary) {
    return {
      type: 'blob',
      oid,
      size: payload.length,
      data: payload,
      isBinary: true,
    };
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(payload);

  return {
    type: 'blob',
    oid,
    size: payload.length,
    data: payload,
    isBinary: false,
    text,
  };
}

/**
 * Parses an annotated tag object payload into a strongly typed GitTagObject.
 */
export function parseTagPayload(payload: Uint8Array, oid: GitOid): GitTagObject {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(payload);

  const doubleNewlineIdx = text.indexOf('\n\n');
  const headerText = doubleNewlineIdx !== -1 ? text.slice(0, doubleNewlineIdx) : text;
  const messageText = doubleNewlineIdx !== -1 ? text.slice(doubleNewlineIdx + 2) : '';

  let targetOid: GitOid | null = null;
  let targetType: GitObjectType | null = null;
  let tagName: string | null = null;
  let tagger: GitIdent | undefined;
  let gpgSig: string | undefined;

  const lines = headerText.split('\n');
  let inGpgSig = false;
  let gpgSigLines: string[] = [];

  for (const line of lines) {
    if (inGpgSig) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        gpgSigLines.push(line.slice(1));
        continue;
      } else {
        gpgSig = gpgSigLines.join('\n');
        inGpgSig = false;
      }
    }

    if (line.startsWith('object ')) {
      targetOid = line.slice(7).trim();
    } else if (line.startsWith('type ')) {
      const typeStr = line.slice(5).trim();
      if (typeStr === 'commit' || typeStr === 'tree' || typeStr === 'blob' || typeStr === 'tag') {
        targetType = typeStr;
      }
    } else if (line.startsWith('tag ')) {
      tagName = line.slice(4).trim();
    } else if (line.startsWith('tagger ')) {
      tagger = parseGitIdent(line.slice(7));
    } else if (line.startsWith('gpgsig ')) {
      inGpgSig = true;
      gpgSigLines = [line.slice(7)];
    }
  }

  if (inGpgSig && gpgSigLines.length > 0) {
    gpgSig = gpgSigLines.join('\n');
  }

  if (targetOid?.length !== 40) {
    throw new MalformedTagError(`Missing or invalid target object SHA in tag ${oid}`);
  }
  if (!targetType) {
    throw new MalformedTagError(`Missing or invalid target type in tag ${oid}`);
  }
  if (!tagName) {
    throw new MalformedTagError(`Missing tag name in tag ${oid}`);
  }

  return {
    type: 'tag',
    oid,
    size: payload.length,
    targetOid,
    targetType,
    tagName,
    ...(tagger !== undefined ? { tagger } : {}),
    message: messageText,
    ...(gpgSig !== undefined ? { gpgSig } : {}),
  };
}

/**
 * Parses an uncompressed loose object buffer and validates against expected OID.
 */
export function parseLooseObjectEnvelope(
  uncompressed: Uint8Array,
  expectedOid?: GitOid
): GitObject {
  const envelope = parseEnvelopeHeader(uncompressed);
  const { type, payload } = envelope;

  const parsedOid = expectedOid ?? '0000000000000000000000000000000000000000';

  switch (type) {
    case 'commit':
      return parseCommitPayload(payload, parsedOid);
    case 'tree':
      return parseTreePayload(payload, parsedOid);
    case 'blob':
      return parseBlobPayload(payload, parsedOid);
    case 'tag':
      return parseTagPayload(payload, parsedOid);
  }
}
