import { useMemo } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { Issue } from '../engine/collab-client.js';
import {
  formatRelativeTime,
  getAuthorColor,
  getAuthorInitials,
  renderMarkdown,
} from './utils.js';

export interface IssueDetailViewProps {
  readonly issue: Issue;
  readonly onBack: () => void;
  readonly onSelectLabel?: ((label: string) => void) | undefined;
}

export const IssueDetailView: FunctionalComponent<IssueDetailViewProps> = ({
  issue,
  onBack,
  onSelectLabel,
}) => {
  const isOpen = issue.status === 'open';

  // Extract unique participants (author + comment authors)
  const participants = useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();
    map.set(issue.author.name, issue.author);
    for (const comment of issue.comments) {
      if (comment.author.name) {
        map.set(comment.author.name, comment.author);
      }
    }
    return Array.from(map.values());
  }, [issue]);

  const authorBg = getAuthorColor(issue.author.name, issue.author.email);
  const authorInitials = getAuthorInitials(issue.author.name);

  return (
    <div className="issue-detail-container" data-testid="issue-detail-view">
      {/* Navigation & Header */}
      <div className="collab-detail-header">
        <button
          type="button"
          className="btn btn-back collab-back-btn"
          onClick={onBack}
          data-testid="back-to-issues-btn"
        >
          ← Back to Issues
        </button>

        <div className="issue-detail-title-section">
          <h1 className="issue-detail-title" data-testid="issue-title">
            <span>{issue.title || 'Untitled Issue'}</span>
            <span className="issue-number-badge" data-testid="issue-number-badge">
              #{issue.number || issue.id}
            </span>
          </h1>

          <div className="issue-detail-status-bar">
            <span
              className={`status-pill ${isOpen ? 'status-pill-open' : 'status-pill-closed'}`}
              data-testid="issue-status-badge"
            >
              <span className="status-pill-icon">{isOpen ? '🎯' : '✓'}</span>
              <span>{isOpen ? 'Open' : 'Closed'}</span>
            </span>

            <div className="issue-detail-subtitle">
              <span
                className="author-avatar-sm"
                style={{
                  backgroundColor: authorBg,
                }}
                title={`${issue.author.name} <${issue.author.email}>`}
              >
                {authorInitials}
              </span>
              <strong className="author-name">{issue.author.name}</strong>
              <span className="meta-text">
                opened this issue {formatRelativeTime(issue.createdAt)} • {issue.comments.length}{' '}
                comment{issue.comments.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Layout: Timeline + Sidebar */}
      <div className="collab-detail-layout">
        <div className="collab-timeline-column">
          {/* Issue Original Post / Description Card */}
          <div className="timeline-card op-card" data-testid="issue-description-card">
            <div className="timeline-card-header">
              <div className="timeline-author-info">
                <span
                  className="timeline-avatar"
                  style={{
                    backgroundColor: authorBg,
                  }}
                >
                  {authorInitials}
                </span>
                <span className="timeline-author-name">{issue.author.name}</span>
                <span className="author-role-badge">Author</span>
                <span className="timeline-timestamp">
                  opened {formatRelativeTime(issue.createdAt)}
                </span>
              </div>
            </div>

            <div
              className="timeline-card-body markdown-body"
              data-testid="issue-description-body"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(issue.description || '*No description provided.*'),
              }}
            />
          </div>

          {/* Chronological Comments Timeline */}
          {issue.comments.length > 0 && (
            <div className="timeline-comments-list" data-testid="comments-timeline">
              {issue.comments.map((comment, index) => {
                const isAuthor = comment.author.name === issue.author.name;
                const commentAuthorBg = getAuthorColor(
                  comment.author.name,
                  comment.author.email
                );
                const commentInitials = getAuthorInitials(comment.author.name);

                return (
                  <div
                    key={comment.id || String(index)}
                    className="timeline-card comment-card"
                    data-testid={`comment-card-${comment.id || String(index)}`}
                  >
                    <div className="timeline-card-header">
                      <div className="timeline-author-info">
                        <span
                          className="timeline-avatar"
                          style={{
                            backgroundColor: commentAuthorBg,
                          }}
                        >
                          {commentInitials}
                        </span>
                        <span className="timeline-author-name">{comment.author.name}</span>
                        {isAuthor && <span className="author-role-badge">Author</span>}
                        <span className="timeline-timestamp">
                          commented {formatRelativeTime(comment.createdAt)}
                        </span>
                      </div>
                    </div>

                    <div
                      className="timeline-card-body markdown-body"
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(comment.body),
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sidebar Pane */}
        <aside className="collab-sidebar" aria-label="Issue metadata sidebar">
          {/* Labels Section */}
          <div className="sidebar-section" data-testid="sidebar-labels-section">
            <h4 className="sidebar-section-title">Labels</h4>
            {issue.labels.length === 0 ? (
              <span className="sidebar-empty-text">None yet</span>
            ) : (
              <div className="sidebar-labels-list">
                {issue.labels.map((label) => (
                  <span
                    key={label}
                    className="label-badge sidebar-label-badge"
                    onClick={() => {
                      if (onSelectLabel) onSelectLabel(label);
                    }}
                    style={onSelectLabel ? { cursor: 'pointer' } : undefined}
                    data-testid={`sidebar-label-${label}`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Participants Section */}
          <div className="sidebar-section" data-testid="sidebar-participants-section">
            <h4 className="sidebar-section-title">
              Participants <span className="sidebar-count">({participants.length})</span>
            </h4>
            <div className="sidebar-participants-list">
              {participants.map((p) => (
                <div key={p.name} className="participant-row">
                  <span
                    className="participant-avatar"
                    style={{ backgroundColor: getAuthorColor(p.name, p.email) }}
                  >
                    {getAuthorInitials(p.name)}
                  </span>
                  <span className="participant-name">{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
