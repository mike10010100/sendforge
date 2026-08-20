import { useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { GitCommitObject } from '../engine/types.js';
import type { FileDiff } from '../worker/diff-types.js';
import { formatIsoDate, formatRelativeTime, formatSha } from './utils.js';

export interface DiffViewProps {
  readonly fileDiffs: readonly FileDiff[];
  readonly commit?: GitCommitObject | null;
  readonly onSelectCommit?: (sha: string) => void;
}

export const DiffView: FunctionalComponent<DiffViewProps> = ({
  fileDiffs,
  commit,
  onSelectCommit,
}) => {
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});

  const toggleFile = (pathKey: string) => {
    setCollapsedFiles((prev) => ({
      ...prev,
      [pathKey]: !prev[pathKey],
    }));
  };

  const totalAdditions = fileDiffs.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = fileDiffs.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="diff-view-container">
      {commit && (
        <div className="box" style={{ marginBottom: '16px' }}>
          <div className="box-header">
            <span style={{ fontSize: '15px' }}>{commit.subject || 'Commit Details'}</span>
            <span className="commit-sha-badge">{formatSha(commit.oid, 10)}</span>
          </div>
          <div style={{ padding: '16px' }}>
            {commit.body && (
              <pre
                style={{
                  fontSize: '13px',
                  fontFamily: 'var(--font-mono)',
                  marginBottom: '12px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {commit.body}
              </pre>
            )}
            <div className="commit-meta">
              <span className="commit-author">{commit.author.name}</span>
              <span title={formatIsoDate(commit.author.timestamp)}>
                committed {formatRelativeTime(commit.author.timestamp)}
              </span>
              {commit.parents.length > 0 && (
                <span>
                  Parents:{' '}
                  {commit.parents.map((p) => (
                    <a
                      key={p}
                      href={`#/commit/${p}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onSelectCommit?.(p);
                      }}
                      style={{ marginRight: '6px' }}
                    >
                      {formatSha(p)}
                    </a>
                  ))}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="controls-bar">
        <div className="diff-summary">
          <span>
            <strong>{fileDiffs.length}</strong> changed files
          </span>
          <span className="diff-stat-add">+{totalAdditions}</span>
          <span className="diff-stat-del">-{totalDeletions}</span>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`btn ${viewMode === 'unified' ? 'btn-primary' : ''}`}
            onClick={() => {
              setViewMode('unified');
            }}
          >
            Unified
          </button>
          <button
            type="button"
            className={`btn ${viewMode === 'split' ? 'btn-primary' : ''}`}
            onClick={() => {
              setViewMode('split');
            }}
          >
            Split
          </button>
        </div>
      </div>

      {fileDiffs.map((fileDiff) => {
        const pathKey = fileDiff.newPath ?? fileDiff.oldPath ?? 'unknown';
        const isCollapsed = Boolean(collapsedFiles[pathKey]);

        return (
          <div key={pathKey} className="diff-card">
            <div
              className="diff-card-header"
              onClick={() => {
                toggleFile(pathKey);
              }}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{isCollapsed ? '▶' : '▼'}</span>
                <span>{fileDiff.newPath ?? fileDiff.oldPath}</span>
                {fileDiff.oldPath && fileDiff.newPath && fileDiff.oldPath !== fileDiff.newPath && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    (renamed from {fileDiff.oldPath})
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="diff-stat-add">+{fileDiff.additions}</span>
                <span className="diff-stat-del">-{fileDiff.deletions}</span>
              </div>
            </div>

            {!isCollapsed && (
              <>
                {fileDiff.isBinary ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Binary file differs
                  </div>
                ) : fileDiff.hunks.length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No visible changes
                  </div>
                ) : viewMode === 'unified' ? (
                  <table className="diff-table">
                    <tbody>
                      {fileDiff.hunks.map((hunk, hIdx) => (
                        <>
                          <tr key={`hunk-${hIdx}`}>
                            <td colSpan={3} className="diff-line-hunk">
                              {hunk.header}
                            </td>
                          </tr>
                          {hunk.lines.map((line, lIdx) => {
                            const isAdd = line.type === 'add';
                            const isDel = line.type === 'delete';
                            const rowClass = isAdd
                              ? 'diff-line-add'
                              : isDel
                              ? 'diff-line-del'
                              : '';
                            return (
                              <tr key={`line-${hIdx}-${lIdx}`} className={rowClass}>
                                <td className="diff-gutter">
                                  {line.oldLineNumber ?? ''}
                                </td>
                                <td className="diff-gutter">
                                  {line.newLineNumber ?? ''}
                                </td>
                                <td className="diff-code">
                                  {isAdd ? '+' : isDel ? '-' : ' '} {line.content}
                                </td>
                              </tr>
                            );
                          })}
                        </>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="split-diff-table">
                    <tbody>
                      {fileDiff.splitRows.map((row, rIdx) => {
                        const leftClass =
                          row.left.type === 'delete' ? 'diff-line-del' : '';
                        const rightClass =
                          row.right.type === 'add' ? 'diff-line-add' : '';
                        return (
                          <tr key={`split-${rIdx}`}>
                            {/* Left side (old) */}
                            <td className={`split-gutter ${leftClass}`}>
                              {row.left.lineNumber ?? ''}
                            </td>
                            <td className={`split-content split-side ${leftClass}`}>
                              {row.left.content !== null ? `${row.left.type === 'delete' ? '-' : ' '} ${row.left.content}` : ''}
                            </td>
                            {/* Right side (new) */}
                            <td className={`split-gutter ${rightClass}`}>
                              {row.right.lineNumber ?? ''}
                            </td>
                            <td className={`split-content split-side ${rightClass}`}>
                              {row.right.content !== null ? `${row.right.type === 'add' ? '+' : ' '} ${row.right.content}` : ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
