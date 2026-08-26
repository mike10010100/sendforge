import { useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { GitCommitObject } from '../engine/types.js';
import { formatIsoDate, formatRelativeTime, formatSha } from './utils.js';

export interface CommitLogProps {
  readonly commits: readonly GitCommitObject[];
  readonly onSelectCommit?: (sha: string) => void;
}

export const CommitLog: FunctionalComponent<CommitLogProps> = ({
  commits,
  onSelectCommit,
}) => {
  const [expandedCommits, setExpandedCommits] = useState<Record<string, boolean>>({});
  const [copiedSha, setCopiedSha] = useState<string | null>(null);

  const toggleExpand = (oid: string) => {
    setExpandedCommits((prev) => ({
      ...prev,
      [oid]: !prev[oid],
    }));
  };

  const handleCopySha = async (sha: string, e: MouseEvent) => {
    e.stopPropagation();
    try {
      if (typeof navigator !== 'undefined' && 'clipboard' in navigator) {
        await navigator.clipboard.writeText(sha);
      }
      setCopiedSha(sha);
      setTimeout(() => {
        setCopiedSha((cur) => (cur === sha ? null : cur));
      }, 2000);
    } catch {
      // Fallback gracefully
    }
  };

  return (
    <div className="commit-timeline">
      {commits.length === 0 ? (
        <div className="box" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
          No commits found.
        </div>
      ) : (
        commits.map((commit) => {
          const isExpanded = Boolean(expandedCommits[commit.oid]);
          const hasBody = commit.body.trim().length > 0;

          return (
            <div key={commit.oid} className="commit-card">
              <div className="commit-info">
                <div className="commit-subject">
                  <a
                    href={`#/commit/${commit.oid}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onSelectCommit?.(commit.oid);
                    }}
                  >
                    {commit.subject || 'No commit message'}
                  </a>
                  {hasBody && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '0 4px', fontSize: '11px', marginLeft: '6px' }}
                      onClick={() => {
                        toggleExpand(commit.oid);
                      }}
                    >
                      ...
                    </button>
                  )}
                </div>

                {isExpanded && hasBody && (
                  <pre
                    style={{
                      marginTop: '8px',
                      marginBottom: '8px',
                      padding: '8px',
                      backgroundColor: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
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
                  {commit.gpgSig && <span className="gpg-badge">✓ Verified</span>}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="commit-sha-wrapper">
                  <span className="commit-sha-badge">{formatSha(commit.oid)}</span>
                  <button
                    type="button"
                    className={`commit-copy-btn ${copiedSha === commit.oid ? 'copied' : ''}`}
                    title={copiedSha === commit.oid ? 'Copied!' : 'Copy full SHA'}
                    aria-label={
                      copiedSha === commit.oid
                        ? 'Copied to clipboard'
                        : `Copy full commit SHA for ${formatSha(commit.oid)}`
                    }
                    onClick={(e) => {
                      void handleCopySha(commit.oid, e);
                    }}
                    data-testid={`copy-sha-${commit.oid}`}
                  >
                    {copiedSha === commit.oid ? (
                      <span className="copy-feedback">✓ Copied</span>
                    ) : (
                      <svg
                        className="copy-icon"
                        viewBox="0 0 16 16"
                        width="12"
                        height="12"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
                        <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
                      </svg>
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '4px 8px' }}
                  onClick={() => {
                    onSelectCommit?.(commit.oid);
                  }}
                >
                  Diff
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
