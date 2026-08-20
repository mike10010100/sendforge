import { useEffect, useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { GitBlobObject } from '../engine/types.js';
import type { GitRepositoryClient } from '../engine/fetcher.js';
import type { BlameViewProps } from './BlameView.js';
import {
  buildPermalinkUrl,
  formatBytes,
  formatLineHash,
  formatSha,
  parseLineHash,
  renderMarkdown,
  type LineRange,
} from './utils.js';

export interface BlobViewProps {
  readonly blob: GitBlobObject;
  readonly path: string;
  readonly onBack?: () => void;
  readonly client?: GitRepositoryClient;
  readonly commitOid?: string;
  readonly onSelectCommit?: (sha: string) => void;
  readonly selectedRange?: LineRange | null;
  readonly onSelectRange?: (range: LineRange | null) => void;
  readonly initialRange?: LineRange | null;
}

export const BlobView: FunctionalComponent<BlobViewProps> = ({
  blob,
  path,
  onBack,
  client,
  commitOid,
  onSelectCommit,
  selectedRange: propSelectedRange,
  onSelectRange,
  initialRange,
}) => {
  const [copiedContent, setCopiedContent] = useState(false);
  const [copiedPermalink, setCopiedPermalink] = useState(false);
  const [viewMode, setViewMode] = useState<'code' | 'blame' | 'raw' | 'rendered'>(
    path.toLowerCase().endsWith('.md') ? 'rendered' : 'code'
  );
  const [selectedRange, setSelectedRange] = useState<LineRange | null>(
    initialRange ?? propSelectedRange ?? null
  );
  const [anchorLine, setAnchorLine] = useState<number | null>(
    initialRange ? initialRange.start : propSelectedRange ? propSelectedRange.start : null
  );
  const [BlameComponent, setBlameComponent] = useState<FunctionalComponent<BlameViewProps> | null>(null);

  useEffect(() => {
    if (viewMode === 'blame' && !BlameComponent) {
      void import('./BlameView.js').then((m) => {
        setBlameComponent(() => m.BlameView);
      });
    }
  }, [viewMode, BlameComponent]);

  const lines = blob.text ? blob.text.split(/\r?\n/) : [];

  const updateUrlLineHash = (range: LineRange | null) => {
    if (typeof window === 'undefined') return;
    const h = range ? formatLineHash(range.start, range.end) : '';
    const cur = window.location.hash;
    const base = cur.replace(/#L\d+(?:-L\d+)?$/i, '');
    const target = h ? `${base}${h}` : base;
    try {
      window.history.replaceState(null, '', target || window.location.pathname);
    } catch {
      window.location.hash = target;
    }
  };

  useEffect(() => {
    const sync = () => {
      if (typeof window === 'undefined') return;
      const parsed = parseLineHash(window.location.hash);
      if (parsed) {
        setSelectedRange(parsed);
        setAnchorLine(parsed.start);
        onSelectRange?.(parsed);
        requestAnimationFrame(() => {
          document.getElementById(`L${parsed.start}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
      }
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
    };
  }, [onSelectRange]);

  const handleCopyContent = async () => {
    if (!blob.text) return;
    try {
      if (typeof navigator !== 'undefined') {
        await navigator.clipboard.writeText(blob.text);
      }
      setCopiedContent(true);
      setTimeout(() => { setCopiedContent(false); }, 2000);
    } catch {
      // Fallback
    }
  };

  const handleCopyPermalink = async () => {
    const link = buildPermalinkUrl('', commitOid ?? blob.oid, path, selectedRange);
    const full =
      typeof window !== 'undefined' && window.location.origin !== 'null'
        ? `${window.location.origin}${window.location.pathname}${link}`
        : link;
    try {
      if (typeof navigator !== 'undefined') {
        await navigator.clipboard.writeText(full);
      }
      setCopiedPermalink(true);
      setTimeout(() => { setCopiedPermalink(false); }, 2000);
    } catch {
      // Fallback
    }
  };

  const handleLineClick = (lineNum: number, event?: MouseEvent | { shiftKey?: boolean }) => {
    const isShift = Boolean(event && 'shiftKey' in event && event.shiftKey);
    let range: LineRange;
    if (isShift && (selectedRange !== null || anchorLine !== null)) {
      const a = anchorLine ?? selectedRange?.start ?? lineNum;
      range = { start: Math.min(a, lineNum), end: Math.max(a, lineNum) };
    } else {
      range = { start: lineNum, end: lineNum };
      setAnchorLine(lineNum);
    }
    setSelectedRange(range);
    onSelectRange?.(range);
    updateUrlLineHash(range);
  };

  const isMd = path.toLowerCase().endsWith('.md');

  return (
    <div className="blob-view-wrapper">
      <div className="box">
        <div className="box-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {onBack && (
              <button type="button" className="btn" onClick={onBack} style={{ padding: '2px 8px' }}>
                ← Back
              </button>
            )}
            <span>{path}</span>
            <span className="badge">{formatBytes(blob.size)}</span>
            {!blob.isBinary && <span className="badge">{lines.length} lines</span>}
            <span className="badge" style={{ fontFamily: 'var(--font-mono)' }}>
              {formatSha(blob.oid)}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isMd && (
              <button
                type="button"
                className={`btn ${viewMode === 'rendered' ? 'btn-primary' : ''}`}
                onClick={() => {
                  setViewMode(viewMode === 'rendered' ? 'code' : 'rendered');
                }}
              >
                {viewMode === 'rendered' ? 'View Source' : 'Preview'}
              </button>
            )}

            {!blob.isBinary && (
              <div className="btn-group">
                <button
                  type="button"
                  className={`btn ${viewMode === 'code' ? 'active' : ''}`}
                  onClick={() => {
                    setViewMode('code');
                  }}
                  title="View source code"
                >
                  Code
                </button>
                <button
                  type="button"
                  className={`btn ${viewMode === 'blame' ? 'active' : ''}`}
                  onClick={() => {
                    setViewMode('blame');
                  }}
                  title="View line-by-line git blame"
                >
                  Blame
                </button>
              </div>
            )}

            {!blob.isBinary && (
              <button
                type="button"
                className={`btn ${viewMode === 'raw' ? 'btn-primary' : ''}`}
                onClick={() => {
                  setViewMode(viewMode === 'raw' ? 'code' : 'raw');
                }}
                title="View raw plain text"
                data-testid="raw-toggle-btn"
              >
                Raw
              </button>
            )}

            <button
              type="button"
              className="btn raw-download-btn"
              onClick={() => {
                const filename = path.split('/').pop() ?? 'blob.bin';
                void import('../engine/archive.js').then((m) => {
                  m.triggerDownload(filename, blob.data, 'application/octet-stream');
                });
              }}
              title="Download raw file content"
              data-testid="raw-download-btn"
            >
              📥 Download
            </button>

            {!blob.isBinary && (
              <button
                type="button"
                className={`btn copy-permalink-btn ${copiedPermalink ? 'btn-copied' : ''}`}
                onClick={() => {
                  void handleCopyPermalink();
                }}
                title="Copy immutable permalink to this commit and line range"
                data-testid="copy-permalink-btn"
              >
                {copiedPermalink ? '✓ Copied!' : '🔗 Copy Permalink'}
              </button>
            )}

            {!blob.isBinary && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void handleCopyContent();
                }}
                title="Copy file contents"
              >
                {copiedContent ? '✓ Copied' : 'Copy'}
              </button>
            )}
          </div>
        </div>

        {blob.isBinary ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '16px', marginBottom: '8px' }}>Binary file ({formatBytes(blob.size)})</p>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              This binary file cannot be displayed in the text viewer.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const filename = path.split('/').pop() ?? 'binary.bin';
                void import('../engine/archive.js').then((m) => {
                  m.triggerDownload(filename, blob.data, 'application/octet-stream');
                });
              }}
              title="Download raw binary file"
              data-testid="download-binary-btn"
            >
              📥 Download Binary File
            </button>
          </div>
        ) : viewMode === 'rendered' && blob.text ? (
          <div
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(blob.text) }}
          />
        ) : viewMode === 'raw' && blob.text ? (
          <pre
            style={{
              padding: '16px',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {blob.text}
          </pre>
        ) : viewMode === 'blame' ? (
          BlameComponent ? (
            <BlameComponent
              blob={blob}
              path={path}
              commitOid={commitOid ?? blob.oid}
              client={client}
              onSelectCommit={onSelectCommit}
              selectedLine={selectedRange ? selectedRange.start : null}
              selectedRange={selectedRange}
              onLineClick={(lineNum, e) => {
                handleLineClick(lineNum, e);
              }}
            />
          ) : (
            <div className="blame-loading-container">
              <div className="blame-spinner" />
              <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>
                Loading blame view...
              </div>
            </div>
          )
        ) : (
          <div className="blob-container">
            <div className="line-numbers">
              {lines.map((_, idx) => {
                const lineNum = idx + 1;
                const isSel =
                  selectedRange !== null &&
                  lineNum >= selectedRange.start &&
                  lineNum <= selectedRange.end;
                return (
                  <span
                    key={lineNum}
                    id={`L${lineNum}`}
                    data-line-number={lineNum}
                    className={`line-number ${isSel ? 'highlighted line-selected' : ''}`}
                    onClick={(e) => {
                      handleLineClick(lineNum, e);
                    }}
                  >
                    {lineNum}
                  </span>
                );
              })}
            </div>
            <div className="code-content">
              {lines.map((lineText, idx) => {
                const lineNum = idx + 1;
                const isSel =
                  selectedRange !== null &&
                  lineNum >= selectedRange.start &&
                  lineNum <= selectedRange.end;
                return (
                  <div
                    key={lineNum}
                    id={`LC${lineNum}`}
                    data-line-number={lineNum}
                    className={`code-line ${isSel ? 'highlighted line-highlight line-selected' : ''}`}
                  >
                    {lineText || ' '}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


