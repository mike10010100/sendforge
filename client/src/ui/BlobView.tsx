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
  getImageMimeType,
  isImageFileName,
  parseLineHash,
  renderMarkdown,
  type LineRange,
} from './utils.js';
import { useEventListener, useStableCallback } from './hooks/useLifecycle.js';

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return typeof btoa !== 'undefined' ? btoa(binary) : '';
}

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
  const isImage = isImageFileName(path);
  const isMd = path.toLowerCase().endsWith('.md');

  const [copiedContent, setCopiedContent] = useState(false);
  const [copiedPermalink, setCopiedPermalink] = useState(false);
  const [viewMode, setViewMode] = useState<'code' | 'blame' | 'raw' | 'rendered'>(
    isMd ? 'rendered' : isImage ? 'rendered' : 'code'
  );
  const [selectedRange, setSelectedRange] = useState<LineRange | null>(
    initialRange ?? propSelectedRange ?? null
  );
  const [anchorLine, setAnchorLine] = useState<number | null>(
    initialRange ? initialRange.start : propSelectedRange ? propSelectedRange.start : null
  );
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [BlameComponent, setBlameComponent] = useState<FunctionalComponent<BlameViewProps> | null>(null);

  // Manage Object URL for image blobs with clean auto-revocation
  useEffect(() => {
    if (isImage && typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
      const mimeType = getImageMimeType(path);
      const blobObj = new Blob([blob.data as BlobPart], { type: mimeType });
      const url = URL.createObjectURL(blobObj);
      setImageUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
    setImageUrl(null);
    return undefined;
  }, [blob.data, isImage, path]);

  useEffect(() => {
    if (viewMode === 'blame' && !BlameComponent) {
      void import('./BlameView.js').then((m) => {
        setBlameComponent(() => m.BlameView);
      });
    }
  }, [viewMode, BlameComponent]);

  const lines = blob.text ? blob.text.split(/\r?\n/) : [];
  const imageSrc = imageUrl ?? (isImage ? `data:${getImageMimeType(path)};base64,${uint8ArrayToBase64(blob.data)}` : undefined);

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

  const syncLineHash = useStableCallback(() => {
    if (typeof window === 'undefined') return;
    const parsed = parseLineHash(window.location.hash);
    if (parsed) {
      setSelectedRange(parsed);
      setAnchorLine(parsed.start);
      onSelectRange?.(parsed);
      requestAnimationFrame(() => {
        document.getElementById(`L${String(parsed.start)}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
  });

  useEffect(() => {
    syncLineHash();
  }, [syncLineHash]);

  useEventListener(typeof window !== 'undefined' ? window : null, 'hashchange', syncLineHash);

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
            {imageDimensions && (
              <span className="badge" style={{ color: 'var(--accent-color)' }}>
                {imageDimensions.width} × {imageDimensions.height} px
              </span>
            )}
            {!blob.isBinary && !isImage && <span className="badge">{lines.length} lines</span>}
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

            {isImage && blob.text && (
              <button
                type="button"
                className={`btn ${viewMode === 'rendered' ? 'btn-primary' : ''}`}
                onClick={() => {
                  setViewMode(viewMode === 'rendered' ? 'code' : 'rendered');
                }}
              >
                {viewMode === 'rendered' ? 'View Source' : 'Preview Image'}
              </button>
            )}

            {!blob.isBinary && !isImage && (
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

            {!blob.isBinary && !isImage && (
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
                const filename = path.split('/').pop() ?? (isImage ? 'image.png' : 'blob.bin');
                const mime = isImage ? getImageMimeType(path) : 'application/octet-stream';
                void import('../engine/archive.js').then((m) => {
                  m.triggerDownload(filename, blob.data, mime);
                });
              }}
              title="Download file content"
              data-testid="raw-download-btn"
            >
              📥 Download
            </button>

            {!blob.isBinary && !isImage && (
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

            {!blob.isBinary && !isImage && (
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

        {/* View Mode Rendering */}
        {isImage && viewMode === 'rendered' && imageSrc ? (
          <div className="image-viewer-container" data-testid="image-viewer">
            <div className="image-preview-frame">
              <img
                src={imageSrc}
                alt={path}
                className="image-preview-img"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                }}
              />
            </div>
            <div className="image-metadata-bar">
              <span>🖼️ {getImageMimeType(path)}</span>
              {imageDimensions && (
                <span>📐 {imageDimensions.width} × {imageDimensions.height} px</span>
              )}
              <span>💾 {formatBytes(blob.size)}</span>
            </div>
          </div>
        ) : blob.isBinary && !isImage ? (
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
                    id={`L${String(lineNum)}`}
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
                    id={`LC${String(lineNum)}`}
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
