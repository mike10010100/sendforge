import { describe, expect, it, vi } from 'vitest';
import pako from 'pako';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
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

describe('Adversarial Stress Testing: Milestone M4 Archive Generation Engine', () => {
  // Helper to create temporary directory for extraction testing
  function withTempDir<T>(fn: (dir: string) => T): T {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-stress-'));
    try {
      return fn(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // Helper to extract TAR.GZ with system tar command
  function extractTarGzWithSystem(tarGzBytes: Uint8Array, destDir: string): void {
    const tarGzFile = path.join(destDir, 'archive.tar.gz');
    fs.writeFileSync(tarGzFile, tarGzBytes);
    execFileSync('tar', ['-xzf', tarGzFile, '-C', destDir], { stdio: 'pipe' });
  }

  // Helper to extract ZIP with system unzip command
  function extractZipWithSystem(zipBytes: Uint8Array, destDir: string): void {
    const zipFile = path.join(destDir, 'archive.zip');
    fs.writeFileSync(zipFile, zipBytes);
    execFileSync('unzip', ['-q', zipFile, '-d', destDir], { stdio: 'pipe' });
  }

  describe('1. Empty Files and 0-Byte Payload Edge Cases', () => {
    it('generates valid ZIP archive containing single 0-byte file (.gitkeep)', () => {
      const files: ArchiveFileEntry[] = [
        { path: 'src/.gitkeep', data: new Uint8Array(0), mode: 0o100644 },
      ];
      const zipBytes = createZipArchive('my-repo', files);
      expect(zipBytes.length).toBeGreaterThan(0);

      withTempDir((tmpDir) => {
        extractZipWithSystem(zipBytes, tmpDir);
        const extractedPath = path.join(tmpDir, 'my-repo', 'src', '.gitkeep');
        expect(fs.existsSync(extractedPath)).toBe(true);
        const stat = fs.statSync(extractedPath);
        expect(stat.size).toBe(0);
      });
    });

    it('generates valid TAR.GZ archive containing single 0-byte file (.gitkeep)', () => {
      const files: ArchiveFileEntry[] = [
        { path: 'src/.gitkeep', data: new Uint8Array(0), mode: 0o100644 },
      ];
      const tarGzBytes = createTarGzArchive('my-repo', files);
      expect(tarGzBytes.length).toBeGreaterThan(0);

      withTempDir((tmpDir) => {
        extractTarGzWithSystem(tarGzBytes, tmpDir);
        const extractedPath = path.join(tmpDir, 'my-repo', 'src', '.gitkeep');
        expect(fs.existsSync(extractedPath)).toBe(true);
        const stat = fs.statSync(extractedPath);
        expect(stat.size).toBe(0);
      });
    });

    it('handles multiple 0-byte files across deep directory structure in ZIP and TAR.GZ', () => {
      const files: ArchiveFileEntry[] = [
        { path: '.gitkeep', data: new Uint8Array(0), mode: 0o100644 },
        { path: 'a/.gitkeep', data: new Uint8Array(0), mode: 0o100644 },
        { path: 'a/b/.gitkeep', data: new Uint8Array(0), mode: 0o100644 },
        { path: 'a/b/c/.gitkeep', data: new Uint8Array(0), mode: 0o100644 },
        { path: 'empty_exec.sh', data: new Uint8Array(0), mode: 0o100755 },
      ];

      const zipBytes = createZipArchive('empty-test', files);
      const tarGzBytes = createTarGzArchive('empty-test', files);

      withTempDir((tmpDir) => {
        const zipDir = path.join(tmpDir, 'zip');
        fs.mkdirSync(zipDir);
        extractZipWithSystem(zipBytes, zipDir);

        for (const file of files) {
          const p = path.join(zipDir, 'empty-test', file.path);
          expect(fs.existsSync(p)).toBe(true);
          expect(fs.statSync(p).size).toBe(0);
        }
      });

      withTempDir((tmpDir) => {
        const tarDir = path.join(tmpDir, 'tar');
        fs.mkdirSync(tarDir);
        extractTarGzWithSystem(tarGzBytes, tarDir);

        for (const file of files) {
          const p = path.join(tarDir, 'empty-test', file.path);
          expect(fs.existsSync(p)).toBe(true);
          expect(fs.statSync(p).size).toBe(0);
        }
      });
    });

    it('handles mixed 0-byte and populated files seamlessly', () => {
      const files: ArchiveFileEntry[] = [
        { path: 'empty.txt', data: new Uint8Array(0), mode: 0o100644 },
        { path: 'normal.txt', data: new TextEncoder().encode('Some content here\n'), mode: 0o100644 },
        { path: 'another_empty.bin', data: new Uint8Array(0), mode: 0o100644 },
      ];

      const zipBytes = createZipArchive('mixed', files);
      const tarGzBytes = createTarGzArchive('mixed', files);

      withTempDir((tmpDir) => {
        extractZipWithSystem(zipBytes, tmpDir);
        expect(fs.readFileSync(path.join(tmpDir, 'mixed', 'empty.txt')).length).toBe(0);
        expect(fs.readFileSync(path.join(tmpDir, 'mixed', 'normal.txt'), 'utf-8')).toBe('Some content here\n');
        expect(fs.readFileSync(path.join(tmpDir, 'mixed', 'another_empty.bin')).length).toBe(0);
      });

      withTempDir((tmpDir) => {
        extractTarGzWithSystem(tarGzBytes, tmpDir);
        expect(fs.readFileSync(path.join(tmpDir, 'mixed', 'empty.txt')).length).toBe(0);
        expect(fs.readFileSync(path.join(tmpDir, 'mixed', 'normal.txt'), 'utf-8')).toBe('Some content here\n');
        expect(fs.readFileSync(path.join(tmpDir, 'mixed', 'another_empty.bin')).length).toBe(0);
      });
    });
  });

  describe('2. Incompressible Random Binary Data & Entropy Stress Tests', () => {
    it('preserves 100% data integrity for high-entropy random binary data chunks', () => {
      const sizes = [1, 7, 16, 512, 1024, 4096, 32768, 65536, 131072];
      const files: ArchiveFileEntry[] = sizes.map((sz, idx) => ({
        path: `binary/random_${sz}_${idx}.bin`,
        data: crypto.randomBytes(sz),
        mode: 0o100644,
      }));

      const zipBytes = createZipArchive('random-repo', files);
      const tarGzBytes = createTarGzArchive('random-repo', files);

      // Verify ZIP roundtrip via system unzip
      withTempDir((tmpDir) => {
        extractZipWithSystem(zipBytes, tmpDir);
        for (const file of files) {
          const extractedPath = path.join(tmpDir, 'random-repo', file.path);
          expect(fs.existsSync(extractedPath)).toBe(true);
          const readData = fs.readFileSync(extractedPath);
          expect(readData.length).toBe(file.data.length);
          expect(Buffer.compare(readData, Buffer.from(file.data))).toBe(0);
        }
      });

      // Verify TAR.GZ roundtrip via system tar
      withTempDir((tmpDir) => {
        extractTarGzWithSystem(tarGzBytes, tmpDir);
        for (const file of files) {
          const extractedPath = path.join(tmpDir, 'random-repo', file.path);
          expect(fs.existsSync(extractedPath)).toBe(true);
          const readData = fs.readFileSync(extractedPath);
          expect(readData.length).toBe(file.data.length);
          expect(Buffer.compare(readData, Buffer.from(file.data))).toBe(0);
        }
      });
    });

    it('correctly uses Store fallback (compMethod 0) in ZIP when Deflate increases size', () => {
      // 16 bytes of cryptographically random data almost always expands when deflated
      const tinyRandom = crypto.randomBytes(16);
      const file: ArchiveFileEntry = {
        path: 'tiny_random.bin',
        data: tinyRandom,
        mode: 0o100644,
      };

      const zipBytes = createZipArchive('store-test', [file]);
      const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

      // Local file header compMethod is at offset 8
      const compMethod = view.getUint16(8, true);
      const deflated = pako.deflateRaw(tinyRandom, { level: 6 });
      if (deflated.length >= tinyRandom.length) {
        expect(compMethod).toBe(0);
      }

      // Verify extraction
      withTempDir((tmpDir) => {
        extractZipWithSystem(zipBytes, tmpDir);
        const extracted = fs.readFileSync(path.join(tmpDir, 'store-test', 'tiny_random.bin'));
        expect(Buffer.compare(extracted, Buffer.from(tinyRandom))).toBe(0);
      });
    });

    it('handles large binary files (512 KB and 1 MB compressible data) efficiently', () => {
      // 512KB binary random
      const bin512k = crypto.randomBytes(512 * 1024);
      // 1MB compressible text
      const text1m = new TextEncoder().encode('ABCDEFGHIJ0123456789\n'.repeat(50000));

      const files: ArchiveFileEntry[] = [
        { path: 'assets/large_random.bin', data: bin512k, mode: 0o100644 },
        { path: 'data/large_text.log', data: text1m, mode: 0o100644 },
      ];

      const zipBytes = createZipArchive('large-payload-repo', files);
      const tarGzBytes = createTarGzArchive('large-payload-repo', files);

      withTempDir((tmpDir) => {
        extractZipWithSystem(zipBytes, tmpDir);
        const readBin = fs.readFileSync(path.join(tmpDir, 'large-payload-repo', 'assets', 'large_random.bin'));
        const readTxt = fs.readFileSync(path.join(tmpDir, 'large-payload-repo', 'data', 'large_text.log'));
        expect(Buffer.compare(readBin, Buffer.from(bin512k))).toBe(0);
        expect(Buffer.compare(readTxt, Buffer.from(text1m))).toBe(0);
      });

      withTempDir((tmpDir) => {
        extractTarGzWithSystem(tarGzBytes, tmpDir);
        const readBin = fs.readFileSync(path.join(tmpDir, 'large-payload-repo', 'assets', 'large_random.bin'));
        const readTxt = fs.readFileSync(path.join(tmpDir, 'large-payload-repo', 'data', 'large_text.log'));
        expect(Buffer.compare(readBin, Buffer.from(bin512k))).toBe(0);
        expect(Buffer.compare(readTxt, Buffer.from(text1m))).toBe(0);
      });
    });

    it('handles all 256 byte values (0x00 through 0xFF) and binary control bytes', () => {
      const allBytes = new Uint8Array(256 * 10);
      for (let i = 0; i < allBytes.length; i++) {
        allBytes[i] = i % 256;
      }

      const files: ArchiveFileEntry[] = [
        { path: 'all_bytes.dat', data: allBytes, mode: 0o100644 },
      ];

      const zipBytes = createZipArchive('all-bytes', files);
      const tarGzBytes = createTarGzArchive('all-bytes', files);

      withTempDir((tmpDir) => {
        extractZipWithSystem(zipBytes, tmpDir);
        const extracted = fs.readFileSync(path.join(tmpDir, 'all-bytes', 'all_bytes.dat'));
        expect(Buffer.compare(extracted, Buffer.from(allBytes))).toBe(0);
      });

      withTempDir((tmpDir) => {
        extractTarGzWithSystem(tarGzBytes, tmpDir);
        const extracted = fs.readFileSync(path.join(tmpDir, 'all-bytes', 'all_bytes.dat'));
        expect(Buffer.compare(extracted, Buffer.from(allBytes))).toBe(0);
      });
    });
  });

  describe('3. Long File Paths and Nested Directory Structures (> 100 Chars)', () => {
    it('handles paths > 100 characters in ZIP archives', () => {
      const longPaths = [
        'packages/nested-module-a-extended-namespace/src/submodules/controllers/handlers/userAuthenticationAndSessionManagementService.ts',
        'a/very/long/path/with/lots/of/nested/subdirectories/to/test/if/the/archive/engine/handles/paths/greater/than/one/hundred/characters/index.js',
        'directory_1234567890_1234567890_1234567890/subdir_1234567890_1234567890_1234567890/file_1234567890_1234567890.txt',
      ];

      const files: ArchiveFileEntry[] = longPaths.map((p, i) => ({
        path: p,
        data: new TextEncoder().encode(`Content for long path ${i}: ${p}`),
        mode: 0o100644,
      }));

      const zipBytes = createZipArchive('long-repo', files);

      withTempDir((tmpDir) => {
        extractZipWithSystem(zipBytes, tmpDir);
        for (const file of files) {
          const extractedPath = path.join(tmpDir, 'long-repo', file.path);
          expect(fs.existsSync(extractedPath)).toBe(true);
          const content = fs.readFileSync(extractedPath, 'utf-8');
          expect(content).toBe(`Content for long path ${longPaths.indexOf(file.path)}: ${file.path}`);
        }
      });
    });

    it('handles paths > 100 characters in TAR.GZ archives via POSIX ustar prefix splitting', () => {
      const longPaths = [
        'packages/nested-module-a-extended-namespace/src/submodules/controllers/handlers/userAuthenticationService.ts',
        'a/very/long/path/with/lots/of/nested/subdirectories/to/test/tar/ustar/prefix/splitting/file.js',
        'directory_1234567890_1234567890_1234567890/subdir_1234567890_1234567890_1234567890/file_1234567890_1234567890.txt',
      ];

      const files: ArchiveFileEntry[] = longPaths.map((p, i) => {
        expect(`tar-long-repo/${p}`.length).toBeGreaterThan(100);
        return {
          path: p,
          data: new TextEncoder().encode(`Content for tar long path ${i}: ${p}`),
          mode: 0o100644,
        };
      });

      const tarGzBytes = createTarGzArchive('tar-long-repo', files);

      withTempDir((tmpDir) => {
        extractTarGzWithSystem(tarGzBytes, tmpDir);
        for (const file of files) {
          const extractedPath = path.join(tmpDir, 'tar-long-repo', file.path);
          expect(fs.existsSync(extractedPath)).toBe(true);
          const content = fs.readFileSync(extractedPath, 'utf-8');
          expect(content).toBe(`Content for tar long path ${longPaths.indexOf(file.path)}: ${file.path}`);
        }
      });
    });

    it('handles boundary path of exactly 100 characters', () => {
      const prefix = 'exact100-repo'; // 13 chars
      // prefix (13) + '/' (1) + 'dir/' (4) + suffix (82) = 100 chars
      const pathSuffix = 'x'.repeat(78) + '.txt';
      const exactPath = `dir/${pathSuffix}`;
      const full = `${prefix}/${exactPath}`;
      expect(full.length).toBe(100);

      const file: ArchiveFileEntry = {
        path: exactPath,
        data: new TextEncoder().encode('Exact 100 chars path content'),
        mode: 0o100644,
      };

      const zipBytes = createZipArchive(prefix, [file]);
      const tarGzBytes = createTarGzArchive(prefix, [file]);

      withTempDir((tmpDir) => {
        extractZipWithSystem(zipBytes, tmpDir);
        const extracted = path.join(tmpDir, full);
        expect(fs.existsSync(extracted)).toBe(true);
        expect(fs.readFileSync(extracted, 'utf-8')).toBe('Exact 100 chars path content');
      });

      withTempDir((tmpDir) => {
        extractTarGzWithSystem(tarGzBytes, tmpDir);
        const extracted = path.join(tmpDir, full);
        expect(fs.existsSync(extracted)).toBe(true);
        expect(fs.readFileSync(extracted, 'utf-8')).toBe('Exact 100 chars path content');
      });
    });

    it('handles deeply nested directories (15+ levels)', () => {
      const deepPath = Array.from({ length: 15 }, (_, i) => `lvl${i}`).join('/') + '/leaf.txt';
      const file: ArchiveFileEntry = {
        path: deepPath,
        data: new TextEncoder().encode('I am deep in the tree'),
        mode: 0o100644,
      };

      const zipBytes = createZipArchive('deep-tree', [file]);
      const tarGzBytes = createTarGzArchive('deep-tree', [file]);

      withTempDir((tmpDir) => {
        extractZipWithSystem(zipBytes, tmpDir);
        const extracted = path.join(tmpDir, 'deep-tree', deepPath);
        expect(fs.existsSync(extracted)).toBe(true);
        expect(fs.readFileSync(extracted, 'utf-8')).toBe('I am deep in the tree');
      });

      withTempDir((tmpDir) => {
        extractTarGzWithSystem(tarGzBytes, tmpDir);
        const extracted = path.join(tmpDir, 'deep-tree', deepPath);
        expect(fs.existsSync(extracted)).toBe(true);
        expect(fs.readFileSync(extracted, 'utf-8')).toBe('I am deep in the tree');
      });
    });
  });

  describe('4. Special Characters, Spaces, and Unicode in File Paths', () => {
    it('handles spaces and special symbols in file paths for ZIP and TAR.GZ', () => {
      const specialPaths = [
        'my directory name with spaces/my file name with spaces.txt',
        'symbols/file!@#$%^&()-_=+[]{};,~.txt',
        'kebab-case/snake_case/camelCase.component.ts',
        '.github/workflows/deploy-production.yml',
        '.config/.secret.env.example',
      ];

      const files: ArchiveFileEntry[] = specialPaths.map((p, i) => ({
        path: p,
        data: new TextEncoder().encode(`Special Path ${i}: ${p}`),
        mode: 0o100644,
      }));

      const zipBytes = createZipArchive('special-repo', files);
      const tarGzBytes = createTarGzArchive('special-repo', files);

      withTempDir((tmpDir) => {
        extractZipWithSystem(zipBytes, tmpDir);
        for (const file of files) {
          const extractedPath = path.join(tmpDir, 'special-repo', file.path);
          expect(fs.existsSync(extractedPath)).toBe(true);
          expect(fs.readFileSync(extractedPath, 'utf-8')).toBe(`Special Path ${specialPaths.indexOf(file.path)}: ${file.path}`);
        }
      });

      withTempDir((tmpDir) => {
        extractTarGzWithSystem(tarGzBytes, tmpDir);
        for (const file of files) {
          const extractedPath = path.join(tmpDir, 'special-repo', file.path);
          expect(fs.existsSync(extractedPath)).toBe(true);
          expect(fs.readFileSync(extractedPath, 'utf-8')).toBe(`Special Path ${specialPaths.indexOf(file.path)}: ${file.path}`);
        }
      });
    });

    it('handles non-ASCII Unicode (UTF-8 multi-byte) characters in file paths', () => {
      const unicodePaths = [
        'docs/中文/指南.md',
        'locales/日本語/設定.json',
        'i18n/русский/документ.txt',
        'accented/café/naïve/ñoño.ts',
        'emoji/🚀_launch/📦_build/🎉_done.txt',
      ];

      const files: ArchiveFileEntry[] = unicodePaths.map((p, i) => ({
        path: p,
        data: new TextEncoder().encode(`Unicode Content for ${p} [index=${i}]`),
        mode: 0o100644,
      }));

      const zipBytes = createZipArchive('unicode-repo', files);
      const tarGzBytes = createTarGzArchive('unicode-repo', files);

      withTempDir((tmpDir) => {
        extractZipWithSystem(zipBytes, tmpDir);
        for (const file of files) {
          const extractedPath = path.join(tmpDir, 'unicode-repo', file.path);
          expect(fs.existsSync(extractedPath)).toBe(true);
          expect(fs.readFileSync(extractedPath, 'utf-8')).toBe(`Unicode Content for ${file.path} [index=${unicodePaths.indexOf(file.path)}]`);
        }
      });

      withTempDir((tmpDir) => {
        extractTarGzWithSystem(tarGzBytes, tmpDir);
        for (const file of files) {
          const extractedPath = path.join(tmpDir, 'unicode-repo', file.path);
          expect(fs.existsSync(extractedPath)).toBe(true);
          expect(fs.readFileSync(extractedPath, 'utf-8')).toBe(`Unicode Content for ${file.path} [index=${unicodePaths.indexOf(file.path)}]`);
        }
      });
    });
  });

  describe('5. POSIX File Permissions & Mode Preservation', () => {
    it('preserves executable bits (0o755 vs 0o644) in ZIP external attributes and TAR headers', () => {
      const files: ArchiveFileEntry[] = [
        { path: 'bin/run.sh', data: new TextEncoder().encode('#!/bin/sh\necho "run"\n'), mode: 0o100755 },
        { path: 'bin/install.bash', data: new TextEncoder().encode('#!/bin/bash\necho "install"\n'), mode: 0o755 },
        { path: 'src/main.ts', data: new TextEncoder().encode('export const x = 1;\n'), mode: 0o100644 },
        { path: 'config.json', data: new TextEncoder().encode('{}\n'), mode: 0o644 },
      ];

      const zipBytes = createZipArchive('perms-repo', files);
      const tarGzBytes = createTarGzArchive('perms-repo', files);

      // Verify ZIP external attributes
      const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
      let eocdPos = -1;
      for (let i = zipBytes.length - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
          eocdPos = i;
          break;
        }
      }
      expect(eocdPos).toBeGreaterThan(-1);
      let cdPos = view.getUint32(eocdPos + 16, true);

      // Entry 1: bin/run.sh (0o755)
      expect((view.getUint32(cdPos + 38, true) >>> 16) & 0o777).toBe(0o755);
      cdPos += 46 + view.getUint16(cdPos + 28, true);

      // Entry 2: bin/install.bash (0o755)
      expect((view.getUint32(cdPos + 38, true) >>> 16) & 0o777).toBe(0o755);
      cdPos += 46 + view.getUint16(cdPos + 28, true);

      // Entry 3: src/main.ts (0o644)
      expect((view.getUint32(cdPos + 38, true) >>> 16) & 0o777).toBe(0o644);
      cdPos += 46 + view.getUint16(cdPos + 28, true);

      // Entry 4: config.json (0o644)
      expect((view.getUint32(cdPos + 38, true) >>> 16) & 0o777).toBe(0o644);

      // Verify TAR extraction preserves modes
      withTempDir((tmpDir) => {
        extractTarGzWithSystem(tarGzBytes, tmpDir);
        const scriptStat = fs.statSync(path.join(tmpDir, 'perms-repo', 'bin', 'run.sh'));
        expect((scriptStat.mode & 0o777) & 0o111).not.toBe(0); // Executable bit set

        const normalStat = fs.statSync(path.join(tmpDir, 'perms-repo', 'src', 'main.ts'));
        expect((normalStat.mode & 0o777) & 0o111).toBe(0); // Not executable
      });
    });
  });

  describe('6. High-Volume Multi-File Archive Stress Test', () => {
    it('generates and extracts an archive containing 250 files across 25 directories without error', () => {
      const files: ArchiveFileEntry[] = [];
      for (let dirIdx = 0; dirIdx < 25; dirIdx++) {
        for (let fileIdx = 0; fileIdx < 10; fileIdx++) {
          const content = `Directory ${dirIdx}, File ${fileIdx}: ${crypto.randomBytes(32).toString('hex')}\n`;
          files.push({
            path: `module_${dirIdx}/sub_${fileIdx}/resource_${dirIdx}_${fileIdx}.txt`,
            data: new TextEncoder().encode(content),
            mode: fileIdx === 0 ? 0o100755 : 0o100644,
          });
        }
      }
      expect(files.length).toBe(250);

      const zipBytes = createZipArchive('large-repo', files);
      const tarGzBytes = createTarGzArchive('large-repo', files);

      expect(zipBytes.length).toBeGreaterThan(10000);
      expect(tarGzBytes.length).toBeGreaterThan(10000);

      // Extract ZIP and verify all 250 files
      withTempDir((tmpDir) => {
        extractZipWithSystem(zipBytes, tmpDir);
        for (const file of files) {
          const p = path.join(tmpDir, 'large-repo', file.path);
          expect(fs.existsSync(p)).toBe(true);
          const readData = fs.readFileSync(p);
          expect(Buffer.compare(readData, Buffer.from(file.data))).toBe(0);
        }
      });

      // Extract TAR.GZ and verify all 250 files
      withTempDir((tmpDir) => {
        extractTarGzWithSystem(tarGzBytes, tmpDir);
        for (const file of files) {
          const p = path.join(tmpDir, 'large-repo', file.path);
          expect(fs.existsSync(p)).toBe(true);
          const readData = fs.readFileSync(p);
          expect(Buffer.compare(readData, Buffer.from(file.data))).toBe(0);
        }
      });
    });
  });

  describe('7. Prefix Normalization and Boundary Edge Cases', () => {
    it('handles various prefix styles cleanly', () => {
      const file: ArchiveFileEntry = {
        path: 'nested/file.txt',
        data: new TextEncoder().encode('test'),
      };

      const p1 = createZipArchive('prefix-normal', [file]);
      const p2 = createZipArchive('prefix-normal/', [file]);
      const p3 = createZipArchive('prefix-normal///', [file]);
      const p4 = createZipArchive('', [file]);

      const t1 = createTarGzArchive('prefix-normal', [file]);
      const t2 = createTarGzArchive('prefix-normal/', [file]);
      const t3 = createTarGzArchive('prefix-normal///', [file]);
      const t4 = createTarGzArchive('', [file]);

      withTempDir((tmpDir) => {
        const d1 = path.join(tmpDir, 'd1');
        const d2 = path.join(tmpDir, 'd2');
        const d3 = path.join(tmpDir, 'd3');
        const d4 = path.join(tmpDir, 'd4');
        fs.mkdirSync(d1);
        fs.mkdirSync(d2);
        fs.mkdirSync(d3);
        fs.mkdirSync(d4);

        extractZipWithSystem(p1, d1);
        extractZipWithSystem(p2, d2);
        extractZipWithSystem(p3, d3);
        extractZipWithSystem(p4, d4);

        expect(fs.existsSync(path.join(d1, 'prefix-normal', 'nested', 'file.txt'))).toBe(true);
        expect(fs.existsSync(path.join(d2, 'prefix-normal', 'nested', 'file.txt'))).toBe(true);
        expect(fs.existsSync(path.join(d3, 'prefix-normal', 'nested', 'file.txt'))).toBe(true);
        expect(fs.existsSync(path.join(d4, 'nested', 'file.txt'))).toBe(true);
      });

      withTempDir((tmpDir) => {
        const d1 = path.join(tmpDir, 'd1');
        const d2 = path.join(tmpDir, 'd2');
        const d3 = path.join(tmpDir, 'd3');
        const d4 = path.join(tmpDir, 'd4');
        fs.mkdirSync(d1);
        fs.mkdirSync(d2);
        fs.mkdirSync(d3);
        fs.mkdirSync(d4);

        extractTarGzWithSystem(t1, d1);
        extractTarGzWithSystem(t2, d2);
        extractTarGzWithSystem(t3, d3);
        extractTarGzWithSystem(t4, d4);

        expect(fs.existsSync(path.join(d1, 'prefix-normal', 'nested', 'file.txt'))).toBe(true);
        expect(fs.existsSync(path.join(d2, 'prefix-normal', 'nested', 'file.txt'))).toBe(true);
        expect(fs.existsSync(path.join(d3, 'prefix-normal', 'nested', 'file.txt'))).toBe(true);
        expect(fs.existsSync(path.join(d4, 'nested', 'file.txt'))).toBe(true);
      });
    });

    it('strips leading slashes on individual file paths', () => {
      const files: ArchiveFileEntry[] = [
        { path: '/leading/slash.txt', data: new TextEncoder().encode('slash') },
        { path: '///multi/slash.txt', data: new TextEncoder().encode('multi') },
      ];

      const zipBytes = createZipArchive('slash-repo', files);
      const tarGzBytes = createTarGzArchive('slash-repo', files);

      withTempDir((tmpDir) => {
        extractZipWithSystem(zipBytes, tmpDir);
        expect(fs.existsSync(path.join(tmpDir, 'slash-repo', 'leading', 'slash.txt'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, 'slash-repo', 'multi', 'slash.txt'))).toBe(true);
      });

      withTempDir((tmpDir) => {
        extractTarGzWithSystem(tarGzBytes, tmpDir);
        expect(fs.existsSync(path.join(tmpDir, 'slash-repo', 'leading', 'slash.txt'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, 'slash-repo', 'multi', 'slash.txt'))).toBe(true);
      });
    });
  });

  describe('8. CRC-32 Adversarial Vectors', () => {
    it('accurately verifies CRC32 for boundary chunks and patterns', () => {
      // Zero byte buffer
      expect(crc32(new Uint8Array([]))).toBe(0);

      // Single byte 0x00
      expect(crc32(new Uint8Array([0x00]))).toBe(0xd202ef8d);

      // Single byte 0xFF
      expect(crc32(new Uint8Array([0xff]))).toBe(0xff000000);

      // Standard IEEE 802.3 test vectors
      expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
      expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);

      // Repeated patterns
      const rep = new TextEncoder().encode('A'.repeat(10000));
      const crcA = crc32(rep);
      expect(typeof crcA).toBe('number');
      expect(crcA).toBeGreaterThan(0);
      expect(crc32(rep)).toBe(crcA); // deterministic
    });
  });

  describe('9. Browser triggerDownload and DOM Triggers', () => {
    it('creates object URL and triggers download in browser DOM environment', () => {
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

      const dummy = new Uint8Array([10, 20, 30]);
      triggerDownload('repo.zip', dummy, 'application/zip');

      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      expect(mockAnchor.download).toBe('repo.zip');
      expect(mockAnchor.href).toBe('blob:http://localhost/mock-uuid');
      expect(clickMock).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });
  });

  describe('10. Snapshot Export End-to-End Stress Test with Synthetic Trees', () => {
    it('exports multi-tree repository snapshot with varied blob types', async () => {
      const blob1 = createCompressedGitObject('blob', '# Adversarial Readme\n');
      const blob2 = createCompressedGitObject('blob', crypto.randomBytes(2048));
      const blob3 = createCompressedGitObject('blob', new Uint8Array(0)); // empty

      const subTreePayload = createTreePayload([
        { mode: '100755', name: 'script.sh', oid: blob1.oid },
        { mode: '100644', name: 'data.bin', oid: blob2.oid },
        { mode: '100644', name: '.gitkeep', oid: blob3.oid },
      ]);
      const subTree = createCompressedGitObject('tree', subTreePayload);

      const rootPayload = createTreePayload([
        { mode: '100644', name: 'README.md', oid: blob1.oid },
        { mode: '040000', name: 'subdir', oid: subTree.oid },
      ]);
      const rootTree = createCompressedGitObject('tree', rootPayload);

      const objectMap = new Map<string, Uint8Array>([
        [blob1.oid, blob1.compressed],
        [blob2.oid, blob2.compressed],
        [blob3.oid, blob3.compressed],
        [subTree.oid, subTree.compressed],
        [rootTree.oid, rootTree.compressed],
      ]);

      const client = new GitRepositoryClient('https://example.com/repo.git');
      // Mock fetch
      const origFetch = globalThis.fetch;
      globalThis.fetch = (url: RequestInfo | URL) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        const parts = urlStr.split('/');
        const p1 = parts[parts.length - 2] ?? '';
        const p2 = parts[parts.length - 1] ?? '';
        const oid = p1 + p2;
        const data = objectMap.get(oid);
        if (data) {
          return Promise.resolve(new Response(data as unknown as BodyInit));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      };

      try {
        const zipBytes = await exportRepositorySnapshot(
          client,
          rootTree.oid,
          'snapshot-v1',
          'zip'
        );

        withTempDir((tmpDir) => {
          extractZipWithSystem(zipBytes, tmpDir);
          expect(fs.existsSync(path.join(tmpDir, 'snapshot-v1', 'README.md'))).toBe(true);
          expect(fs.existsSync(path.join(tmpDir, 'snapshot-v1', 'subdir', 'script.sh'))).toBe(true);
          expect(fs.existsSync(path.join(tmpDir, 'snapshot-v1', 'subdir', 'data.bin'))).toBe(true);
          expect(fs.existsSync(path.join(tmpDir, 'snapshot-v1', 'subdir', '.gitkeep'))).toBe(true);
        });

        const tarGzBytes = await exportRepositorySnapshot(
          client,
          rootTree.oid,
          'snapshot-v1',
          'tar.gz'
        );

        withTempDir((tmpDir) => {
          extractTarGzWithSystem(tarGzBytes, tmpDir);
          expect(fs.existsSync(path.join(tmpDir, 'snapshot-v1', 'README.md'))).toBe(true);
          expect(fs.existsSync(path.join(tmpDir, 'snapshot-v1', 'subdir', 'script.sh'))).toBe(true);
          expect(fs.existsSync(path.join(tmpDir, 'snapshot-v1', 'subdir', 'data.bin'))).toBe(true);
          expect(fs.existsSync(path.join(tmpDir, 'snapshot-v1', 'subdir', '.gitkeep'))).toBe(true);
        });
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});
