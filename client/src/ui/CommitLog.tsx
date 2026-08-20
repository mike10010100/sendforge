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

  const toggleExpand = (oid: string) => {
    setExpandedCommits((prev) => ({
      ...prev,
      [oid]: !prev[oid],
    }));
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
                <span className="commit-sha-badge">{formatSha(commit.oid)}</span>
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
