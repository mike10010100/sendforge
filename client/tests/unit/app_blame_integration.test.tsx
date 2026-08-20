import { describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import render from 'preact-render-to-string';
import { App } from '../../src/ui/App.js';
import { BlobView } from '../../src/ui/BlobView.js';
import { BlameView } from '../../src/ui/BlameView.js';
import { GitRepositoryClient } from '../../src/engine/fetcher.js';
import type { GitBlobObject } from '../../src/engine/types.js';
import type { BlameResult } from '../../src/engine/blame.js';

describe('App.tsx & BlobView & BlameView Integration Verification', () => {
  const sampleCommitOid = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const parentCommitOid = '1111111111111111111111111111111111111111';

  const mockBlob: GitBlobObject = {
    type: 'blob',
    oid: '2222222222222222222222222222222222222222',
    size: 50,
    data: new TextEncoder().encode('export const greeting = "hello";\nexport const answer = 42;\n'),
    isBinary: false,
    text: 'export const greeting = "hello";\nexport const answer = 42;\n',
  };

  const mockBlameResult: BlameResult = {
    lines: [
      {
        lineNumber: 1,
        commitOid: sampleCommitOid,
        authorName: 'Alice Developer',
        authorEmail: 'alice@example.com',
        timestamp: 1700000000,
        summary: 'Add greeting constant',
      },
      {
        lineNumber: 2,
        commitOid: parentCommitOid,
        authorName: 'Bob Engineer',
        authorEmail: 'bob@example.com',
        timestamp: 1690000000,
        summary: 'Add answer constant',
      },
    ],
    hunks: [
      {
        commitOid: sampleCommitOid,
        authorName: 'Alice Developer',
        authorEmail: 'alice@example.com',
        timestamp: 1700000000,
        summary: 'Add greeting constant',
        startLine: 1,
        lineCount: 1,
      },
      {
        commitOid: parentCommitOid,
        authorName: 'Bob Engineer',
        authorEmail: 'bob@example.com',
        timestamp: 1690000000,
        summary: 'Add answer constant',
        startLine: 2,
        lineCount: 1,
      },
    ],
    oldestTimestamp: 1690000000,
    newestTimestamp: 1700000000,
  };

  it('1. Verifies BlobView receives and handles client, commitOid, onSelectCommit, and onBack props', () => {
    const onSelectCommitMock = vi.fn();
    const onBackMock = vi.fn();
    const dummyClient = new GitRepositoryClient('https://mock.repo');

    const html = render(
      h(BlobView, {
        blob: mockBlob,
        path: 'src/greeting.ts',
        client: dummyClient,
        commitOid: sampleCommitOid,
        onSelectCommit: onSelectCommitMock,
        onBack: onBackMock,
      })
    );

    expect(html).toContain('src/greeting.ts');
    expect(html).toContain('← Back');
    expect(html).toContain('Code');
    expect(html).toContain('Blame');
    expect(html).toContain('Raw');
    expect(html).toContain('export const greeting = &quot;hello&quot;;');
  });

  it('2. Verifies BlameView receives direct blame props and renders commit links with click handler support', () => {
    const onSelectCommitMock = vi.fn();
    const onLineClickMock = vi.fn();

    const html = render(
      h(BlameView, {
        blob: mockBlob,
        path: 'src/greeting.ts',
        commitOid: sampleCommitOid,
        blameResult: mockBlameResult,
        onSelectCommit: onSelectCommitMock,
        onLineClick: onLineClickMock,
      })
    );

    expect(html).toContain('Alice Developer');
    expect(html).toContain('Bob Engineer');
    expect(html).toContain('AD');
    expect(html).toContain('BE');
    expect(html).toContain('Add greeting constant');
    expect(html).toContain('Add answer constant');
    expect(html).toContain('4b825dc');
    expect(html).toContain('1111111');
    expect(html).toContain('href="#/commit/4b825dc642cb6eb9a060e54bf8d69288fbee4904"');
    expect(html).toContain('href="#/commit/1111111111111111111111111111111111111111"');
  });

  it('3. Verifies initial App render structure with navigation tabs and branding', () => {
    const html = render(h(App, { baseUrl: 'https://mock.repo' }));

    expect(html).toContain('app-container');
    expect(html).toContain('📁 Code');
    expect(html).toContain('📜 Commits');
    expect(html).toContain('⚡ Diffs');
    expect(html).toContain('🔍 Find file');
    expect(html).toContain('Loading repository data...');
  });

  it('4. Verifies BlameView handles empty file / 0 lines gracefully', () => {
    const emptyBlob: GitBlobObject = {
      type: 'blob',
      oid: '0000000000000000000000000000000000000000',
      size: 0,
      data: new Uint8Array(0),
      isBinary: false,
      text: '',
    };

    const emptyBlame: BlameResult = {
      lines: [],
      hunks: [],
      oldestTimestamp: 0,
      newestTimestamp: 0,
    };

    const html = render(
      h(BlameView, {
        blob: emptyBlob,
        path: 'empty.ts',
        blameResult: emptyBlame,
      })
    );

    expect(html).toContain('Empty file');
    expect(html).toContain('(0 lines)');
  });

  it('5. Verifies BlameView line selection highlighting', () => {
    const html = render(
      h(BlameView, {
        blob: mockBlob,
        path: 'src/greeting.ts',
        blameResult: mockBlameResult,
        selectedLine: 2,
      })
    );

    expect(html).toContain('highlighted');
  });
});

describe('Adversarial & Edge Case Integration Tests', () => {
  it('6. Verifies BlameView empty state without path or content', () => {
    const html = render(
      h(BlameView, {
        blob: undefined,
        path: undefined,
        commitOid: undefined,
        client: undefined,
      })
    );

    expect(html).toContain('Empty file');
    expect(html).toContain('(0 lines)');
  });

  it('7. Verifies Unicode and multi-byte author initials rendering in BlameView', () => {
    const unicodeBlame: BlameResult = {
      lines: [
        {
          lineNumber: 1,
          commitOid: 'abcdef1234567890abcdef1234567890abcdef12',
          authorName: '🦀 Ferris Rustacean',
          authorEmail: 'ferris@rust.org',
          timestamp: 1700000000,
          summary: 'Add emoji support',
        },
        {
          lineNumber: 2,
          commitOid: '1234567890abcdef1234567890abcdef12345678',
          authorName: '⚡ Zeus Olympians',
          authorEmail: 'zeus@olympus.org',
          timestamp: 1700000000,
          summary: 'Add lightning fast diff',
        },
      ],
      hunks: [
        {
          commitOid: 'abcdef1234567890abcdef1234567890abcdef12',
          authorName: '🦀 Ferris Rustacean',
          authorEmail: 'ferris@rust.org',
          timestamp: 1700000000,
          summary: 'Add emoji support',
          startLine: 1,
          lineCount: 1,
        },
        {
          commitOid: '1234567890abcdef1234567890abcdef12345678',
          authorName: '⚡ Zeus Olympians',
          authorEmail: 'zeus@olympus.org',
          timestamp: 1700000000,
          summary: 'Add lightning fast diff',
          startLine: 2,
          lineCount: 1,
        },
      ],
      oldestTimestamp: 1700000000,
      newestTimestamp: 1700000000,
    };

    const html = render(
      h(BlameView, {
        blameResult: unicodeBlame,
        fileLines: ['// line 1', '// line 2'],
        path: 'emoji.ts',
      })
    );

    expect(html).toContain('🦀 Ferris Rustacean');
    expect(html).toContain('⚡ Zeus Olympians');
    // Multi-byte initials should be extracted without splitting surrogates
    expect(html).toContain('🦀R');
    expect(html).toContain('⚡O');
  });

  it('8. Verifies Markdown file in BlobView renders preview by default with toggle to source', () => {
    const mdBlob: GitBlobObject = {
      type: 'blob',
      oid: '3333333333333333333333333333333333333333',
      size: 40,
      data: new TextEncoder().encode('# Heading\n**Bold text**\n'),
      isBinary: false,
      text: '# Heading\n**Bold text**\n',
    };

    const html = render(
      h(BlobView, {
        blob: mdBlob,
        path: 'README.md',
      })
    );

    expect(html).toContain('markdown-body');
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>Bold text</strong>');
    expect(html).toContain('View Source');
  });

  it('9. Verifies binary file in BlobView suppresses Blame and Raw controls', () => {
    const binBlob: GitBlobObject = {
      type: 'blob',
      oid: '4444444444444444444444444444444444444444',
      size: 512,
      data: new Uint8Array([0, 1, 2, 3]),
      isBinary: true,
    };

    const html = render(
      h(BlobView, {
        blob: binBlob,
        path: 'logo.png',
      })
    );

    expect(html).toContain('Binary file (512.0 B)');
    expect(html).toContain('This binary file cannot be displayed in the text viewer.');
    expect(html).not.toContain('title="View line-by-line git blame"');
  });
});
