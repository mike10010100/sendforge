/**
 * Reference In-Harness Git Object Parser & Diff Engine
 * Used by E2E tests to cross-verify Git loose objects, binary trees, commits,
 * tags, blobs, and Web Worker diffing contracts.
 */

import zlib from 'node:zlib';
import crypto from 'node:crypto';

export class GitParser {
  /**
   * Decompress a raw Git loose object buffer, parse header `<type> <size>\0<payload>`
   * and verify SHA-1 checksum against expected OID.
   */
  static inflateLooseObject(compressedBuffer, expectedOid = null) {
    let decompressed;
    try {
      decompressed = zlib.inflateSync(compressedBuffer);
    } catch (err) {
      const e = new Error(`Zlib decompression failed: ${err.message}`);
      e.code = 'DECOMPRESSION_FAILED';
      throw e;
    }

    const nullIdx = decompressed.indexOf(0);
    if (nullIdx === -1) {
      const e = new Error('Malformed Git object: missing null terminator in header');
      e.code = 'MALFORMED_HEADER';
      throw e;
    }

    const header = decompressed.subarray(0, nullIdx).toString('utf-8');
    const parts = header.split(' ');
    if (parts.length !== 2) {
      const e = new Error(`Malformed Git object header: "${header}"`);
      e.code = 'MALFORMED_HEADER';
      throw e;
    }

    const type = parts[0];
    const size = parseInt(parts[1], 10);
    if (Number.isNaN(size) || size < 0) {
      const e = new Error(`Invalid Git object size: "${parts[1]}"`);
      e.code = 'INVALID_SIZE';
      throw e;
    }

    const payload = decompressed.subarray(nullIdx + 1);
    if (payload.length !== size) {
      const e = new Error(`Git object size mismatch: header says ${size}, payload is ${payload.length}`);
      e.code = 'SIZE_MISMATCH';
      throw e;
    }

    const computedOid = crypto.createHash('sha1').update(decompressed).digest('hex');
    if (expectedOid && computedOid.toLowerCase() !== expectedOid.toLowerCase()) {
      const e = new Error(`SHA-1 checksum mismatch: expected ${expectedOid}, computed ${computedOid}`);
      e.code = 'CHECKSUM_MISMATCH';
      throw e;
    }

    return {
      type,
      size,
      payload,
      oid: computedOid,
      raw: decompressed
    };
  }

  /**
   * Parse commit object payload
   */
  static parseCommit(payloadBuffer) {
    const text = payloadBuffer.toString('utf-8');
    const lines = text.split('\n');
    let tree = null;
    const parents = [];
    let author = null;
    let committer = null;
    let gpgsig = null;
    let inGpg = false;
    let gpgLines = [];
    let messageIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (inGpg) {
        if (line.startsWith(' ')) {
          gpgLines.push(line.slice(1));
          continue;
        } else {
          gpgsig = gpgLines.join('\n');
          inGpg = false;
        }
      }

      if (line.startsWith('tree ')) {
        tree = line.slice(5).trim();
      } else if (line.startsWith('parent ')) {
        parents.push(line.slice(7).trim());
      } else if (line.startsWith('author ')) {
        author = this._parseIdentity(line.slice(7));
      } else if (line.startsWith('committer ')) {
        committer = this._parseIdentity(line.slice(10));
      } else if (line.startsWith('gpgsig ')) {
        inGpg = true;
        gpgLines = [line.slice(7)];
      } else if (line === '') {
        messageIndex = i + 1;
        break;
      }
    }

    const message = messageIndex !== -1 ? lines.slice(messageIndex).join('\n') : '';

    return {
      tree,
      parents,
      author,
      committer,
      gpgsig,
      message: message.trimEnd(),
      rawMessage: message
    };
  }

  static _parseIdentity(identityStr) {
    // Format: "Name <email@example.com> 1724100000 +0000"
    const match = identityStr.match(/^(.*?)\s+<([^>]+)>\s+(\d+)\s+([+-]\d{4})$/);
    if (match) {
      return {
        name: match[1],
        email: match[2],
        timestamp: parseInt(match[3], 10),
        tz: match[4],
        raw: identityStr
      };
    }
    return { name: identityStr, email: '', timestamp: 0, tz: '+0000', raw: identityStr };
  }

  /**
   * Parse binary tree object payload
   * Entry format: `<mode> <name>\0<20-byte-oid>`
   */
  static parseTree(payloadBuffer) {
    const entries = [];
    let offset = 0;

    while (offset < payloadBuffer.length) {
      // Find space between mode and name
      let spaceIdx = -1;
      for (let i = offset; i < payloadBuffer.length; i++) {
        if (payloadBuffer[i] === 0x20) { // ' '
          spaceIdx = i;
          break;
        }
      }
      if (spaceIdx === -1) {
        throw new Error(`Corrupted tree: missing space delimiter at offset ${offset}`);
      }

      const mode = payloadBuffer.subarray(offset, spaceIdx).toString('utf-8');

      // Find null byte after name
      let nullIdx = -1;
      for (let i = spaceIdx + 1; i < payloadBuffer.length; i++) {
        if (payloadBuffer[i] === 0x00) {
          nullIdx = i;
          break;
        }
      }
      if (nullIdx === -1) {
        throw new Error(`Corrupted tree: missing null delimiter after name at offset ${spaceIdx}`);
      }

      const name = payloadBuffer.subarray(spaceIdx + 1, nullIdx).toString('utf-8');
      const oidStart = nullIdx + 1;
      const oidEnd = oidStart + 20;

      if (oidEnd > payloadBuffer.length) {
        throw new Error(`Corrupted tree: truncated 20-byte SHA-1 for entry "${name}"`);
      }

      const oidBytes = payloadBuffer.subarray(oidStart, oidEnd);
      const oid = oidBytes.toString('hex');

      let type = 'blob';
      if (mode.startsWith('04') || mode === '40000') {
        type = 'tree';
      } else if (mode === '120000') {
        type = 'symlink';
      } else if (mode === '160000') {
        type = 'submodule';
      } else if (mode === '100755') {
        type = 'executable';
      }

      entries.push({
        mode,
        name,
        oid,
        type
      });

      offset = oidEnd;
    }

    return entries;
  }

  /**
   * Parse blob object payload (detect binary vs text)
   */
  static parseBlob(payloadBuffer) {
    // Check first 8KB for null bytes
    const checkLen = Math.min(payloadBuffer.length, 8192);
    let isBinary = false;
    for (let i = 0; i < checkLen; i++) {
      if (payloadBuffer[i] === 0) {
        isBinary = true;
        break;
      }
    }

    if (isBinary) {
      return {
        isBinary: true,
        size: payloadBuffer.length,
        lines: [],
        text: null,
        raw: payloadBuffer
      };
    }

    const text = payloadBuffer.toString('utf-8');
    const lines = text.length === 0 ? [] : text.split(/\r?\n/);

    return {
      isBinary: false,
      size: payloadBuffer.length,
      lines,
      lineCount: lines.length,
      text,
      raw: payloadBuffer
    };
  }

  /**
   * Parse annotated tag object payload
   */
  static parseTag(payloadBuffer) {
    const text = payloadBuffer.toString('utf-8');
    const lines = text.split('\n');
    let object = null;
    let type = null;
    let tag = null;
    let tagger = null;
    let messageIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('object ')) {
        object = line.slice(7).trim();
      } else if (line.startsWith('type ')) {
        type = line.slice(5).trim();
      } else if (line.startsWith('tag ')) {
        tag = line.slice(4).trim();
      } else if (line.startsWith('tagger ')) {
        tagger = this._parseIdentity(line.slice(7));
      } else if (line === '') {
        messageIndex = i + 1;
        break;
      }
    }

    const message = messageIndex !== -1 ? lines.slice(messageIndex).join('\n') : '';

    return {
      object,
      targetType: type,
      tag,
      tagger,
      message: message.trimEnd()
    };
  }

  /**
   * Compute unified diff hunks using LCS algorithm
   */
  static computeUnifiedDiff(oldText, newText, options = {}) {
    const contextLines = options.contextLines !== undefined ? options.contextLines : 3;
    const oldLines = oldText === '' ? [] : oldText.split(/\r?\n/);
    const newLines = newText === '' ? [] : newText.split(/\r?\n/);

    // Dynamic programming LCS table
    const m = oldLines.length;
    const n = newLines.length;
    const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));

    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (oldLines[i] === newLines[j]) {
          dp[i + 1][j + 1] = dp[i][j] + 1;
        } else {
          dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    // Backtrack edits
    const edits = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        edits.push({ type: 'equal', oldLine: i, newLine: j, text: oldLines[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        edits.push({ type: 'add', oldLine: null, newLine: j, text: newLines[j - 1] });
        j--;
      } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
        edits.push({ type: 'delete', oldLine: i, newLine: null, text: oldLines[i - 1] });
        i--;
      }
    }
    edits.reverse();

    let additions = 0;
    let deletions = 0;
    for (const e of edits) {
      if (e.type === 'add') additions++;
      if (e.type === 'delete') deletions++;
    }

    return {
      edits,
      stats: { additions, deletions },
      isIdentical: additions === 0 && deletions === 0
    };
  }
}
