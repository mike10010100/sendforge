import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
import {
  detectLanguage,
  LineSyntaxCache,
  sliceTokensForSearch,
  tokenizeFile,
} from './syntax.js';

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

interface SearchMatchLocation {
  readonly lineIndex: number;
  readonly startCol: number;
  readonly endCol: number;
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

  // In-file search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Syntax highlighting caching
  const syntaxCache = useMemo(() => new LineSyntaxCache(), []);
  const language = useMemo(() => detectLanguage(path), [path]);
  const lines = useMemo(() => (blob.text ? blob.text.split(/\r?\n/) : []), [blob.text]);

  const highlightedLines = useMemo(() => {
    if (!blob.text || blob.isBinary || isImage || viewMode !== 'code') return [];
    return tokenizeFile(blob.text, path, syntaxCache).lines;
  }, [blob.text, blob.isBinary, isImage, viewMode, path, syntaxCache]);

  // Compute all in-file search matches
  const allMatches = useMemo<SearchMatchLocation[]>(() => {
    if (!searchQuery || !blob.text || blob.isBinary || isImage) return [];
    const queryLower = searchQuery.toLowerCase();
    const results: SearchMatchLocation[] = [];
    for (let lIdx = 0; lIdx < lines.length; lIdx++) {
      const line = lines[lIdx] ?? '';
      const lineLower = line.toLowerCase();
      let pos = 0;
      while (pos < lineLower.length) {
        const mIdx = lineLower.indexOf(queryLower, pos);
        if (mIdx === -1) break;
        results.push({
          lineIndex: lIdx,
          startCol: mIdx,
          endCol: mIdx + queryLower.length,
        });
        pos = mIdx + queryLower.length;
      }
    }
    return results;
  }, [searchQuery, blob.text, blob.isBinary, isImage, lines]);

  const validActiveIndex =
    allMatches.length > 0
      ? ((activeMatchIndex % allMatches.length) + allMatches.length) % allMatches.length
      : 0;
  const currentMatch = allMatches[validActiveIndex];

  const scrollToMatch = useCallback((match: SearchMatchLocation | undefined) => {
    if (!match || typeof document === 'undefined') return;
    const lineEl = document.getElementById(`LC${String(match.lineIndex + 1)}`);
    lineEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  const handleNextMatch = useCallback(() => {
    if (allMatches.length === 0) return;
    const nextIdx = (validActiveIndex + 1) % allMatches.length;
    setActiveMatchIndex(nextIdx);
    scrollToMatch(allMatches[nextIdx]);
  }, [allMatches, validActiveIndex, scrollToMatch]);

  const handlePrevMatch = useCallback(() => {
    if (allMatches.length === 0) return;
    const prevIdx = (validActiveIndex - 1 + allMatches.length) % allMatches.length;
    setActiveMatchIndex(prevIdx);
    scrollToMatch(allMatches[prevIdx]);
  }, [allMatches, validActiveIndex, scrollToMatch]);

  const handleCloseSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setActiveMatchIndex(0);
  }, []);

  // Keyboard shortcut: Ctrl+F / Cmd+F to find, Esc to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (!blob.isBinary && !isImage) {
          e.preventDefault();
          setIsSearchOpen(true);
          setTimeout(() => {
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
          }, 50);
        }
      } else if (e.key === 'Escape' && isSearchOpen) {
        e.preventDefault();
        handleCloseSearch();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
    return undefined;
  }, [blob.isBinary, isImage, isSearchOpen, handleCloseSearch]);

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

  const imageSrc =
    imageUrl ??
    (isImage ? `data:${getImageMimeType(path)};base64,${uint8ArrayToBase64(blob.data)}` : undefined);

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
        document.getElementById(`L${String(parsed.start)}`)?.scrollIntoView({
          block: 'center',
          behavior: 'smooth',
        });
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
      setTimeout(() => {
        setCopiedContent(false);
      }, 2000);
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
      setTimeout(() => {
        setCopiedPermalink(false);
      }, 2000);
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
            {!blob.isBinary && !isImage && language !== 'plain' && (
              <span className="badge" style={{ textTransform: 'uppercase' }}>
                {language}
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

            {!blob.isBinary && !isImage && (
              <button
                type="button"
                className={`btn ${isSearchOpen ? 'active' : ''}`}
                onClick={() => {
                  setIsSearchOpen((prev) => {
                    const next = !prev;
                    if (next) {
                      setTimeout(() => {
                        searchInputRef.current?.focus();
                      }, 50);
                    }
                    return next;
                  });
                }}
                title="Find in file (Ctrl+F / ⌘F)"
                data-testid="find-in-file-btn"
              >
                🔍 Find
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

        {/* In-File Search Bar */}
        {isSearchOpen && !blob.isBinary && !isImage && (
          <div className="blob-search-bar" data-testid="blob-search-bar">
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Find:</span>
            <input
              ref={searchInputRef}
              type="text"
              className="blob-search-input"
              placeholder="Find in file... (Enter for next)"
              value={searchQuery}
              onInput={(e) => {
                setSearchQuery(e.currentTarget.value);
                setActiveMatchIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) {
                    handlePrevMatch();
                  } else {
                    handleNextMatch();
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCloseSearch();
                }
              }}
              data-testid="blob-search-input"
            />
            <span className="blob-search-counter" data-testid="blob-search-counter">
              {searchQuery
                ? allMatches.length > 0
                  ? `${String(validActiveIndex + 1)} of ${String(allMatches.length)} matches`
                  : 'No matches'
                : ''}
            </span>
            <button
              type="button"
              className="blob-search-nav-btn"
              onClick={handlePrevMatch}
              disabled={allMatches.length === 0}
              title="Previous match (Shift+Enter)"
              data-testid="blob-search-prev-btn"
            >
              ▲
            </button>
            <button
              type="button"
              className="blob-search-nav-btn"
              onClick={handleNextMatch}
              disabled={allMatches.length === 0}
              title="Next match (Enter)"
              data-testid="blob-search-next-btn"
            >
              ▼
            </button>
            <button
              type="button"
              className="blob-search-close-btn"
              onClick={handleCloseSearch}
              title="Close search (Esc)"
              data-testid="blob-search-close-btn"
            >
              ✕
            </button>
          </div>
        )}

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
                const lineTokens = highlightedLines[idx] ?? [{ type: 'plain', text: lineText || ' ' }];

                let renderedContent;
                if (searchQuery) {
                  const isLineActiveMatch = currentMatch?.lineIndex === idx;
                  const segments = sliceTokensForSearch(
                    lineTokens,
                    searchQuery,
                    isLineActiveMatch,
                    isLineActiveMatch ? currentMatch.startCol : undefined
                  );
                  renderedContent =
                    segments.length > 0 ? (
                      segments.map((seg, sIdx) =>
                        seg.isSearchMatch ? (
                          <mark
                            key={sIdx}
                            className={`syn-search-match ${seg.isCurrentMatch ? 'syn-search-active' : ''} syn-${seg.type}`}
                          >
                            {seg.text}
                          </mark>
                        ) : (
                          <span key={sIdx} className={`syn-${seg.type}`}>
                            {seg.text}
                          </span>
                        )
                      )
                    ) : (
                      ' '
                    );
                } else {
                  renderedContent =
                    lineTokens.length > 0 ? (
                      lineTokens.map((token, tIdx) => (
                        <span key={tIdx} className={`syn-${token.type}`}>
                          {token.text}
                        </span>
                      ))
                    ) : (
                      ' '
                    );
                }

                return (
                  <div
                    key={lineNum}
                    id={`LC${String(lineNum)}`}
                    data-line-number={lineNum}
                    className={`code-line ${isSel ? 'highlighted line-highlight line-selected' : ''}`}
                    data-line-text={lineText}
                  >
                    {renderedContent}
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
