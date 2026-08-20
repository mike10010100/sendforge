import { describe, expect, it, vi } from 'vitest';
import pako from 'pako';
import {
  crc32,
  createZipArchive,
  createTarGzArchive,
  triggerDownload,
  exportRepositorySnapshot,
  type ArchiveFileEntry,
} from '../../src/engine/archive.js';
import { GitRepositoryClient } from '../../src/engine/fetcher.js';
import { createCompressedGitObject, createTreePayload } from '../fixtures.js';

describe('Milestone M4: Archive Engine & Serialization', () => {
  describe('1. CRC-32 Checksum Algorithm', () => {
    it('computes CRC-32 for empty buffer as 0', () => {
      const empty = new Uint8Array(0);
      expect(crc32(empty)).toBe(0);
    });

    it('computes standard IEEE 802.3 test vector "123456789"', () => {
      const input = new TextEncoder().encode('123456789');
      // 0xCBF43926 = 3421780262
      expect(crc32(input)).toBe(0xcbf43926);
    });

    it('computes known test vector for pangram sentence', () => {
      const input = new TextEncoder().encode('The quick brown fox jumps over the lazy dog');
      // CRC-32 for this pangram is 0x414FA339 = 1095762745
      expect(crc32(input)).toBe(0x414fa339);
    });

    it('handles arbitrary binary data chunks and byte values 0x00 to 0xFF', () => {
      const allBytes = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        allBytes[i] = i;
      }
      const crc = crc32(allBytes);
      expect(typeof crc).toBe('number');
      expect(crc).toBeGreaterThan(0);
      // Repeated calculation produces identical checksum
      expect(crc32(allBytes)).toBe(crc);
    });
  });

  describe('2. Client-Side PKWARE ZIP Archive Serialization', () => {
    it('creates an empty ZIP archive with valid EOCD record', () => {
      const zipBytes = createZipArchive('my-repo-main', []);
      expect(zipBytes.length).toBe(22); // EOCD record length is 22 bytes

      const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
      expect(view.getUint32(0, true)).toBe(0x06054b50); // EOCD magic PK\x05\x06
      expect(view.getUint16(4, true)).toBe(0); // Disk number
      expect(view.getUint16(8, true)).toBe(0); // Entries on disk
      expect(view.getUint16(10, true)).toBe(0); // Total entries
      expect(view.getUint32(12, true)).toBe(0); // CD size
      expect(view.getUint32(16, true)).toBe(0); // CD offset
    });

    it('creates a single file ZIP archive with valid PK0304, PK0102, and PK0506 structures', () => {
      const content = new TextEncoder().encode('Hello Sendforge ZIP!');
      const files: ArchiveFileEntry[] = [
        { path: 'hello.txt', data: content, mode: 0o100644 },
      ];

      const zipBytes = createZipArchive('repo-v1', files);
      expect(zipBytes.length).toBeGreaterThan(0);

      const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

      // 1. Verify Local File Header (PK0304)
      expect(view.getUint32(0, true)).toBe(0x04034b50); // PK\x03\x04
      expect(view.getUint16(4, true)).toBe(20);         // Version needed
      const compMethod = view.getUint16(8, true);
      expect(compMethod === 0 || compMethod === 8).toBe(true);
      expect(view.getUint32(14, true)).toBe(crc32(content));
      expect(view.getUint32(22, true)).toBe(content.length);

      const nameLen = view.getUint16(26, true);
      const expectedPath = 'repo-v1/hello.txt';
      const nameBytes = zipBytes.subarray(30, 30 + nameLen);
      expect(new TextDecoder().decode(nameBytes)).toBe(expectedPath);

      // Data extraction
      const compSize = view.getUint32(18, true);
      const dataOffset = 30 + nameLen;
      const compData = zipBytes.subarray(dataOffset, dataOffset + compSize);
      const decompressed = compMethod === 8 ? pako.inflateRaw(compData) : compData;
      expect(new TextDecoder().decode(decompressed)).toBe('Hello Sendforge ZIP!');

      // 2. Central Directory Header (PK0102)
      const cdOffset = dataOffset + compSize;
      expect(view.getUint32(cdOffset, true)).toBe(0x02014b50); // PK\x01\x02
      expect(view.getUint16(cdOffset + 4, true)).toBe((3 << 8) | 20); // Unix + 2.0
      expect(view.getUint32(cdOffset + 16, true)).toBe(crc32(content));
      expect(view.getUint32(cdOffset + 24, true)).toBe(content.length);
      expect(view.getUint32(cdOffset + 42, true)).toBe(0); // Offset of local header

      // External file attributes should preserve POSIX mode 0o100644
      const extAttrs = view.getUint32(cdOffset + 38, true);
      expect((extAttrs >>> 16) & 0o777).toBe(0o644);

      // 3. EOCD (PK0506)
      const eocdOffset = cdOffset + 46 + nameLen;
      expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50); // PK\x05\x06
      expect(view.getUint16(eocdOffset + 8, true)).toBe(1);      // 1 entry
      expect(view.getUint16(eocdOffset + 10, true)).toBe(1);
      expect(view.getUint32(eocdOffset + 16, true)).toBe(cdOffset);
    });

    it('creates a multi-file ZIP archive with executable permissions preserved', () => {
      const files: ArchiveFileEntry[] = [
        {
          path: 'src/index.ts',
          data: new TextEncoder().encode('export const main = () => console.log("ok");'),
          mode: 0o100644,
        },
        {
          path: 'scripts/run.sh',
          data: new TextEncoder().encode('#!/bin/sh\necho "Running script"'),
          mode: 0o100755,
        },
        {
          path: '.gitkeep',
          data: new Uint8Array(0),
          mode: 0o100644,
        },
      ];

      const zipBytes = createZipArchive('project-main', files);
      const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

      // Find EOCD
      let eocdPos = -1;
      for (let i = zipBytes.length - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
          eocdPos = i;
          break;
        }
      }
      expect(eocdPos).toBeGreaterThan(-1);
      expect(view.getUint16(eocdPos + 10, true)).toBe(3); // 3 total entries

      // Traverse Central Directory
      let cdPos = view.getUint32(eocdPos + 16, true);
      const extractedEntries: { name: string; mode: number; size: number }[] = [];

      for (let i = 0; i < 3; i++) {
        expect(view.getUint32(cdPos, true)).toBe(0x02014b50);
        const nameLength = view.getUint16(cdPos + 28, true);
        const uncompSize = view.getUint32(cdPos + 24, true);
        const extAttrs = view.getUint32(cdPos + 38, true);
        const mode = (extAttrs >>> 16) & 0o777;
        const entryName = new TextDecoder().decode(zipBytes.subarray(cdPos + 46, cdPos + 46 + nameLength));

        extractedEntries.push({ name: entryName, mode, size: uncompSize });
        cdPos += 46 + nameLength;
      }

      expect(extractedEntries[0]?.name).toBe('project-main/src/index.ts');
      expect(extractedEntries[0]?.mode).toBe(0o644);

      expect(extractedEntries[1]?.name).toBe('project-main/scripts/run.sh');
      expect(extractedEntries[1]?.mode).toBe(0o755);

      expect(extractedEntries[2]?.name).toBe('project-main/.gitkeep');
      expect(extractedEntries[2]?.size).toBe(0);
    });

    it('normalizes directory prefix with trailing slashes or empty prefix', () => {
      const files: ArchiveFileEntry[] = [
        { path: 'file.txt', data: new TextEncoder().encode('text') },
      ];

      const withSlash = createZipArchive('prefix/', files);
      const withoutSlash = createZipArchive('prefix', files);
      const emptyPrefix = createZipArchive('', files);

      const getName = (buf: Uint8Array): string => {
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const nameLen = view.getUint16(26, true);
        return new TextDecoder().decode(buf.subarray(30, 30 + nameLen));
      };

      expect(getName(withSlash)).toBe('prefix/file.txt');
      expect(getName(withoutSlash)).toBe('prefix/file.txt');
      expect(getName(emptyPrefix)).toBe('file.txt');
    });
  });

  describe('3. Client-Side POSIX ustar .tar.gz Archive Serialization', () => {
    it('creates an empty TAR.GZ archive containing two 512-byte zero trailer blocks', () => {
      const tarGzBytes = createTarGzArchive('empty-repo', []);
      expect(tarGzBytes.length).toBeGreaterThan(0);

      // Decompress gzip
      const rawTar = pako.ungzip(tarGzBytes);
      expect(rawTar.length).toBe(1024); // Exactly 1024 zero trailer bytes
      for (const b of rawTar) {
        expect(b).toBe(0);
      }
    });

    it('creates a valid POSIX ustar archive and verifies 512-byte header fields', () => {
      const content = new TextEncoder().encode('# Test Tarball Content');
      const files: ArchiveFileEntry[] = [
        { path: 'README.md', data: content, mode: 0o100644 },
      ];

      const tarGzBytes = createTarGzArchive('my-package-1.0', files);
      const rawTar = pako.ungzip(tarGzBytes);

      // At least 512 header + 512 data + 1024 trailer = 2048 bytes
      expect(rawTar.length).toBe(2048);

      const header = rawTar.subarray(0, 512);

      // Name field (100 bytes at 0)
      const name = new TextDecoder().decode(header.subarray(0, 100)).replace(/\0+$/, '');
      expect(name).toBe('my-package-1.0/README.md');

      // Mode field (8 bytes at 100)
      const modeStr = new TextDecoder().decode(header.subarray(100, 108)).trim();
      expect(parseInt(modeStr, 8) & 0o777).toBe(0o644);

      // UID & GID (8 bytes at 108, 116)
      expect(parseInt(new TextDecoder().decode(header.subarray(108, 116)).trim(), 8)).toBe(0);
      expect(parseInt(new TextDecoder().decode(header.subarray(116, 124)).trim(), 8)).toBe(0);

      // Size field (12 bytes at 124)
      const sizeStr = new TextDecoder().decode(header.subarray(124, 136)).trim();
      expect(parseInt(sizeStr, 8)).toBe(content.length);

      // Typeflag (1 byte at 156) = '0' (regular file)
      expect(String.fromCharCode(header[156] ?? 0x30)).toBe('0');

      // Magic (6 bytes at 257) = "ustar\0"
      const magic = new TextDecoder().decode(header.subarray(257, 263));
      expect(magic).toBe('ustar\0');

      // Version (2 bytes at 263) = "00"
      const version = new TextDecoder().decode(header.subarray(263, 265));
      expect(version).toBe('00');

      // Uname & Gname (32 bytes at 265, 297) = "sendforge\0"
      expect(new TextDecoder().decode(header.subarray(265, 275))).toBe('sendforge\0');
      expect(new TextDecoder().decode(header.subarray(297, 307))).toBe('sendforge\0');

      // Checksum validation:
      let sum = 0;
      for (let i = 0; i < 512; i++) {
        if (i >= 148 && i < 156) {
          sum += 0x20; // 8 blank spaces
        } else {
          sum += header[i] ?? 0;
        }
      }
      const chksumInHeader = parseInt(new TextDecoder().decode(header.subarray(148, 156)).trim(), 8);
      expect(chksumInHeader).toBe(sum);

      // Data block (512 bytes at 512)
      const dataBlock = rawTar.subarray(512, 512 + 512);
      expect(new TextDecoder().decode(dataBlock.subarray(0, content.length))).toBe('# Test Tarball Content');
      // Padding bytes should all be 0
      for (let i = content.length; i < 512; i++) {
        expect(dataBlock[i]).toBe(0);
      }
    });

    it('handles long paths (> 100 chars) with POSIX ustar prefix splitting', () => {
      const longPath = 'deeply/nested/directory/structure/that/is/exceptionally/long/to/properly/test/tar/prefix/splitting/file.txt';
      expect(longPath.length).toBeGreaterThan(100);

      const files: ArchiveFileEntry[] = [
        { path: longPath, data: new TextEncoder().encode('Long path content'), mode: 0o100644 },
      ];

      const tarGz = createTarGzArchive('long-repo', files);
      const rawTar = pako.ungzip(tarGz);

      const header = rawTar.subarray(0, 512);
      const rawName = new TextDecoder().decode(header.subarray(0, 100)).replace(/\0+$/, '');
      const rawPrefix = new TextDecoder().decode(header.subarray(345, 500)).replace(/\0+$/, '');

      expect(rawPrefix.length).toBeGreaterThan(0);
      const reconstituted = `${rawPrefix}/${rawName}`;
      expect(reconstituted).toBe(`long-repo/${longPath}`);
    });
  });

  describe('4. Browser triggerDownload Helper', () => {
    it('creates a Blob, object URL, anchor element, and triggers click in DOM environment', () => {
      const clickMock = vi.fn();
      const appendChildMock = vi.fn();
      const removeChildMock = vi.fn();
      const createObjectURLMock = vi.fn().mockReturnValue('blob:http://localhost/mock-uuid');
      const revokeObjectURLMock = vi.fn();

      vi.stubGlobal('URL', {
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock,
      });

      const mockAnchor = {
        href: '',
        download: '',
        style: { display: '' },
        click: clickMock,
      };

      vi.stubGlobal('document', {
        createElement: vi.fn().mockReturnValue(mockAnchor),
        body: {
          appendChild: appendChildMock,
          removeChild: removeChildMock,
        },
      });

      vi.stubGlobal('window', {});

      const data = new Uint8Array([1, 2, 3, 4]);
      triggerDownload('archive.zip', data, 'application/zip');

      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      expect(mockAnchor.download).toBe('archive.zip');
      expect(mockAnchor.href).toBe('blob:http://localhost/mock-uuid');
      expect(appendChildMock).toHaveBeenCalledWith(mockAnchor);
      expect(clickMock).toHaveBeenCalledTimes(1);
      expect(removeChildMock).toHaveBeenCalledWith(mockAnchor);

      vi.unstubAllGlobals();
    });

    it('safely handles non-browser environments without errors', () => {
      // Stub window/document as undefined
      const origWindow = globalThis.window;
      // @ts-expect-error - testing undefined window environment
      delete globalThis.window;

      expect(() => {
        triggerDownload('test.zip', new Uint8Array([1, 2, 3]), 'application/zip');
      }).not.toThrow();

      globalThis.window = origWindow;
    });
  });

  describe('5. exportRepositorySnapshot Integration with GitRepositoryClient', () => {
    it('recursively fetches all tree blobs and exports a valid ZIP snapshot', async () => {
      const readmeBlob = createCompressedGitObject('blob', '# Root README\nWelcome!');
      const codeBlob = createCompressedGitObject('blob', 'export const answer = 42;\n');

      const srcTreePayload = createTreePayload([
        { mode: '100644', name: 'main.ts', oid: codeBlob.oid },
      ]);
      const srcTree = createCompressedGitObject('tree', srcTreePayload);

      const rootTreePayload = createTreePayload([
        { mode: '100644', name: 'README.md', oid: readmeBlob.oid },
        { mode: '040000', name: 'src', oid: srcTree.oid },
      ]);
      const rootTree = createCompressedGitObject('tree', rootTreePayload);

      const objectMap = new Map<string, Uint8Array>([
        [readmeBlob.oid, readmeBlob.compressed],
        [codeBlob.oid, codeBlob.compressed],
        [srcTree.oid, srcTree.compressed],
        [rootTree.oid, rootTree.compressed],
      ]);

      const client = new GitRepositoryClient('https://example.com/repo.git');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          const parts = url.split('/');
          const p1 = parts[parts.length - 2] ?? '';
          const p2 = parts[parts.length - 1] ?? '';
          const oid = p1 + p2;
          const data = objectMap.get(oid);
          if (data) {
            return Promise.resolve({
              ok: true,
              status: 200,
              arrayBuffer: () => Promise.resolve(data.buffer),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        })
      );

      const progressMock = vi.fn();

      // Export as ZIP
      const zipBytes = await exportRepositorySnapshot(
        client,
        rootTree.oid,
        'my-repo-main',
        'zip',
        progressMock
      );

      expect(zipBytes.length).toBeGreaterThan(0);
      expect(progressMock).toHaveBeenCalledWith(1, 2);
      expect(progressMock).toHaveBeenCalledWith(2, 2);

      // Verify ZIP contents
      const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
      expect(view.getUint32(0, true)).toBe(0x04034b50);

      // Export as TAR.GZ
      const tarGzBytes = await exportRepositorySnapshot(
        client,
        rootTree.oid,
        'my-repo-main',
        'tar.gz'
      );

      expect(tarGzBytes.length).toBeGreaterThan(0);
      const rawTar = pako.ungzip(tarGzBytes);
      expect(rawTar.length).toBeGreaterThan(1024);

      vi.unstubAllGlobals();
    });

    it('handles empty repository root tree snapshot export gracefully', async () => {
      const emptyTreePayload = createTreePayload([]);
      const emptyTree = createCompressedGitObject('tree', emptyTreePayload);

      const client = new GitRepositoryClient('https://example.com/repo.git');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(emptyTree.compressed.buffer),
        })
      );

      const zipBytes = await exportRepositorySnapshot(
        client,
        emptyTree.oid,
        'empty-repo',
        'zip'
      );
      expect(zipBytes.length).toBe(22); // Empty ZIP EOCD

      const tarGzBytes = await exportRepositorySnapshot(
        client,
        emptyTree.oid,
        'empty-repo',
        'tar.gz'
      );
      const rawTar = pako.ungzip(tarGzBytes);
      expect(rawTar.length).toBe(1024); // Empty TAR trailer

      vi.unstubAllGlobals();
    });
  });

  describe('6. UI Integration & Component Triggers', () => {
    it('renders Raw view and Download triggers in BlobView for text blobs', async () => {
      const { render } = await import('preact-render-to-string');
      const { h } = await import('preact');
      const { BlobView } = await import('../../src/ui/BlobView.js');

      const mockTextBlob = {
        type: 'blob' as const,
        oid: '1111111111111111111111111111111111111111',
        size: 25,
        data: new TextEncoder().encode('export const sum = 100;\n'),
        isBinary: false,
        text: 'export const sum = 100;\n',
      };

      const html = render(
        h(BlobView, {
          blob: mockTextBlob,
          path: 'src/sum.ts',
        })
      );

      expect(html).toContain('Raw');
      expect(html).toContain('Download');
      expect(html).toContain('data-testid="raw-download-btn"');
    });

    it('renders Download Binary File button for binary blobs in BlobView', async () => {
      const { render } = await import('preact-render-to-string');
      const { h } = await import('preact');
      const { BlobView } = await import('../../src/ui/BlobView.js');

      const mockBinBlob = {
        type: 'blob' as const,
        oid: '2222222222222222222222222222222222222222',
        size: 1024,
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        isBinary: true,
      };

      const html = render(
        h(BlobView, {
          blob: mockBinBlob,
          path: 'assets/logo.png',
        })
      );

      expect(html).toContain('Binary file (1.0 KB)');
      expect(html).toContain('Download Binary File');
      expect(html).toContain('data-testid="download-binary-btn"');
    });

    it('renders Download Snapshot dropdown button in App controls bar', async () => {
      const { render } = await import('preact-render-to-string');
      const { h } = await import('preact');
      const { App } = await import('../../src/ui/App.js');

      const html = render(h(App, { baseUrl: 'https://example.com' }));
      expect(html).toContain('controls-bar');
      expect(html).toContain('download-dropdown-container');
      expect(html).toContain('data-testid="download-snapshot-btn"');
    });
  });
});
