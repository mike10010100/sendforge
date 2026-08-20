import { describe, expect, it, vi } from 'vitest';
import render from 'preact-render-to-string';
import { TreeView } from '../../src/ui/TreeView.js';
import { BlobView } from '../../src/ui/BlobView.js';
import { CommitLog } from '../../src/ui/CommitLog.js';
import { DiffView } from '../../src/ui/DiffView.js';
import { FileFinder } from '../../src/ui/FileFinder.js';
import { formatBytes, formatRelativeTime, formatSha, renderMarkdown } from '../../src/ui/utils.js';
import type { GitBlobObject, GitCommitObject, GitTreeEntry } from '../../src/engine/types.js';
import type { FileDiff } from '../../src/worker/diff-types.js';

describe('UI Components & Renderers', () => {
  it('formats bytes and relative times correctly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');

    expect(formatSha('4b825dc642cb6eb9a060e54bf8d69288fbee4904')).toBe('4b825dc');
    expect(formatSha('4b825dc642cb6eb9a060e54bf8d69288fbee4904', 10)).toBe('4b825dc642');

    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeTime(now - 10)).toBe('10s ago');
    expect(formatRelativeTime(now - 120)).toBe('2m ago');
    expect(formatRelativeTime(now - 7200)).toBe('2h ago');
    expect(formatRelativeTime(now - 86400 * 3)).toBe('3d ago');
  });

  it('renders markdown to safe HTML with code blocks and headers', () => {
    const md = [
      '# Project Title',
      '## Subtitle',
      'This is **bold** and *italic* with `inline code` and [link](https://sendforge.dev).',
      '- Item 1',
      '- Item 2',
      '```rust',
      'fn main() { println!("Hello"); }',
      '```',
    ].join('\n');

    const html = renderMarkdown(md);
    expect(html).toContain('<h1>Project Title</h1>');
    expect(html).toContain('<h2>Subtitle</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>inline code</code>');
    expect(html).toContain('<a href="https://sendforge.dev" target="_blank" rel="noopener noreferrer">link</a>');
    expect(html).toContain('<li>Item 1</li>');
    expect(html).toContain('<pre><code class="language-rust">fn main() { println!(&quot;Hello&quot;); }</code></pre>');
  });

  it('renders TreeView component with file and directory entries', () => {
    const entries: readonly GitTreeEntry[] = [
      { mode: '040000', name: 'src', oid: '1111111111111111111111111111111111111111', isTree: true, isSubmodule: false, isSymlink: false },
      { mode: '100644', name: 'README.md', oid: '2222222222222222222222222222222222222222', isTree: false, isSubmodule: false, isSymlink: false },
      { mode: '100755', name: 'run.sh', oid: '3333333333333333333333333333333333333333', isTree: false, isSubmodule: false, isSymlink: false },
    ];

    const html = render(
      <TreeView
        entries={entries}
        currentPath=""
        onNavigate={vi.fn()}
      />
    );

    expect(html).toContain('src');
    expect(html).toContain('README.md');
    expect(html).toContain('run.sh');
    expect(html).toContain('040000');
    expect(html).toContain('100644');
    expect(html).toContain('100755');
  });

  it('renders BlobView for text and binary files', () => {
    const textBlob: GitBlobObject = {
      type: 'blob',
      oid: '1111111111111111111111111111111111111111',
      size: 32,
      data: new TextEncoder().encode('const x = 42;\nconst y = 100;\n'),
      isBinary: false,
      text: 'const x = 42;\nconst y = 100;\n',
    };

    const textHtml = render(<BlobView blob={textBlob} path="src/index.ts" />);
    expect(textHtml).toContain('src/index.ts');
    expect(textHtml).toContain('const x = 42;');
    expect(textHtml).toContain('const y = 100;');

    const binaryBlob: GitBlobObject = {
      type: 'blob',
      oid: '2222222222222222222222222222222222222222',
      size: 1024,
      data: new Uint8Array([0x00, 0x01]),
      isBinary: true,
    };

    const binaryHtml = render(<BlobView blob={binaryBlob} path="image.png" />);
    expect(binaryHtml).toContain('Binary file');

    const withPropsHtml = render(
      <BlobView
        blob={textBlob}
        path="src/index.ts"
        commitOid="1111111111111111111111111111111111111111"
        onSelectCommit={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(withPropsHtml).toContain('Blame');
    expect(withPropsHtml).toContain('src/index.ts');
  });

  it('renders CommitLog component with commit details and GPG badge', () => {
    const commits: readonly GitCommitObject[] = [
      {
        type: 'commit',
        oid: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
        size: 200,
        tree: '1111111111111111111111111111111111111111',
        parents: [],
        author: { name: 'Linus', email: 'linus@kernel.org', timestamp: 1700000000, tzOffset: '+0000' },
        committer: { name: 'Linus', email: 'linus@kernel.org', timestamp: 1700000000, tzOffset: '+0000' },
        message: 'Initial commit message',
        subject: 'Initial commit message',
        body: '',
        gpgSig: '-----BEGIN PGP SIGNATURE-----...',
      },
    ];

    const html = render(<CommitLog commits={commits} />);
    expect(html).toContain('Initial commit message');
    expect(html).toContain('Linus');
    expect(html).toContain('Verified');
    expect(html).toContain('4b825dc');
  });

  it('renders DiffView component with hunks and stats', () => {
    const fileDiffs: readonly FileDiff[] = [
      {
        oldPath: 'src/main.ts',
        newPath: 'src/main.ts',
        isBinary: false,
        additions: 1,
        deletions: 1,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            header: '@@ -1,1 +1,1 @@',
            lines: [
              { type: 'delete', content: 'const a = 1;', oldLineNumber: 1, newLineNumber: null },
              { type: 'add', content: 'const a = 2;', oldLineNumber: null, newLineNumber: 1 },
            ],
          },
        ],
        splitRows: [],
      },
    ];

    const html = render(<DiffView fileDiffs={fileDiffs} />);
    expect(html).toContain('src/main.ts');
    expect(html).toContain('+1');
    expect(html).toContain('-1');
    expect(html).toContain('const a = 1;');
    expect(html).toContain('const a = 2;');
  });

  it('renders FileFinder modal when open', () => {
    const files = [
      { path: 'src/index.ts', entry: { mode: '100644' as const, name: 'index.ts', oid: '1111111111111111111111111111111111111111', isTree: false, isSubmodule: false, isSymlink: false } },
      { path: 'README.md', entry: { mode: '100644' as const, name: 'README.md', oid: '2222222222222222222222222222222222222222', isTree: false, isSubmodule: false, isSymlink: false } },
    ];

    const openHtml = render(
      <FileFinder
        files={files}
        isOpen={true}
        onClose={vi.fn()}
        onSelectFile={vi.fn()}
      />
    );
    expect(openHtml).toContain('src/index.ts');
    expect(openHtml).toContain('README.md');

    const closedHtml = render(
      <FileFinder
        files={files}
        isOpen={false}
        onClose={vi.fn()}
        onSelectFile={vi.fn()}
      />
    );
    expect(closedHtml).toBe('');
  });
});
