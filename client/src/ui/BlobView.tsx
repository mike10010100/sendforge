import { useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { GitBlobObject } from '../engine/types.js';
import { formatBytes, formatSha, renderMarkdown } from './utils.js';

export interface BlobViewProps {
  readonly blob: GitBlobObject;
  readonly path: string;
  readonly onBack?: () => void;
}

export const BlobView: FunctionalComponent<BlobViewProps> = ({ blob, path, onBack }) => {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'code' | 'raw' | 'rendered'>(
    path.toLowerCase().endsWith('.md') ? 'rendered' : 'code'
  );
  const [selectedLine, setSelectedLine] = useState<number | null>(null);

  const lines = blob.text ? blob.text.split(/\r?\n/) : [];

  const handleCopy = async () => {
    if (!blob.text) return;
    try {
      await navigator.clipboard.writeText(blob.text);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Fallback
    }
  };

  const handleLineClick = (lineNum: number) => {
    setSelectedLine(selectedLine === lineNum ? null : lineNum);
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
            {!blob.isBinary && <span className="badge">{lines.length} lines</span>}
            <span className="badge" style={{ fontFamily: 'var(--font-mono)' }}>
              {formatSha(blob.oid)}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {path.toLowerCase().endsWith('.md') && (
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
              <button
                type="button"
                className={`btn ${viewMode === 'raw' ? 'btn-primary' : ''}`}
                onClick={() => {
                  setViewMode(viewMode === 'raw' ? 'code' : 'raw');
                }}
              >
                Raw
              </button>
            )}
            {!blob.isBinary && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void handleCopy();
                }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            )}
          </div>
        </div>

        {blob.isBinary ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '16px', marginBottom: '8px' }}>Binary file ({formatBytes(blob.size)})</p>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              This binary file cannot be displayed in the text viewer.
            </p>
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
        ) : (
          <div className="blob-container">
            <div className="line-numbers">
              {lines.map((_, idx) => {
                const lineNum = idx + 1;
                const isSelected = selectedLine === lineNum;
                return (
                  <span
                    key={lineNum}
                    className={`line-number ${isSelected ? 'highlighted' : ''}`}
                    onClick={() => {
                      handleLineClick(lineNum);
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
                const isSelected = selectedLine === lineNum;
                return (
                  <div
                    key={lineNum}
                    className={`code-line ${isSelected ? 'highlighted' : ''}`}
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
