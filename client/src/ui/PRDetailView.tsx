import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { PullRequest, ReviewNote } from '../engine/collab-client.js';
import { loadReviewNotes } from '../engine/collab-client.js';
import { findMergeBase, getCommitHistoryRange, type CommitSummary } from '../engine/dag.js';
import type { GitRepositoryClient } from '../engine/fetcher.js';
import { attachReviewNotes, computeTreeFullDiff } from '../worker/diff-algo.js';
import type { FileDiff, SplitDiffRow } from '../worker/diff-types.js';
import {
  formatIsoDate,
  formatRelativeTime,
  formatSha,
  getAuthorColor,
  getAuthorInitials,
  renderMarkdown,
} from './utils.js';

export interface PRDetailViewProps {
  readonly pr: PullRequest;
  readonly client: GitRepositoryClient;
  readonly activeTab?: 'conversation' | 'commits' | 'files' | undefined;
  readonly onTabChange?: ((tab: 'conversation' | 'commits' | 'files') => void) | undefined;
  readonly onBack?: (() => void) | undefined;
  readonly onSelectCommit?: ((sha: string) => void) | undefined;
}

export const PRDetailView: FunctionalComponent<PRDetailViewProps> = ({
  pr,
  client,
  activeTab = 'conversation',
  onTabChange,
  onBack,
  onSelectCommit,
}) => {
  const [currentTab, setCurrentTab] = useState<'conversation' | 'commits' | 'files'>(activeTab);
  const [commits, setCommits] = useState<readonly CommitSummary[]>([]);
  const [fileDiffs, setFileDiffs] = useState<readonly FileDiff[]>([]);
  const [reviewNotes, setReviewNotes] = useState<readonly ReviewNote[]>([]);
  const [mergeBaseSha, setMergeBaseSha] = useState<string | null>(null);

  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('unified');
  const [selectedFileFilter, setSelectedFileFilter] = useState<string>('');
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const [expandedCommits, setExpandedCommits] = useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Sync prop activeTab to internal state if changed externally
  useEffect(() => {
    if (activeTab !== currentTab) {
      setCurrentTab(activeTab);
    }
  }, [activeTab, currentTab]);

  const handleTabClick = (tab: 'conversation' | 'commits' | 'files') => {
    setCurrentTab(tab);
    onTabChange?.(tab);
  };

  // Load merge base, commits, diff, and review notes
  const loadPRData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Resolve target branch SHA
      let targetSha: string | null = null;
      try {
        targetSha = await client.resolveRef(pr.targetBranch);
      } catch {
        try {
          targetSha = await client.resolveRef(`refs/heads/${pr.targetBranch}`);
        } catch {
          targetSha = null;
        }
      }

      // 2. Compute merge base
      let baseSha: string | null = null;
      if (targetSha && pr.headCommit) {
        try {
          baseSha = await findMergeBase(client, pr.headCommit, targetSha);
        } catch {
          baseSha = null;
        }
      }
      setMergeBaseSha(baseSha);

      // 3. Compute commit history range
      let prCommits: CommitSummary[] = [];
      if (pr.headCommit) {
        try {
          prCommits = await getCommitHistoryRange(client, baseSha, pr.headCommit);
        } catch {
          prCommits = [];
        }
      }
      setCommits(prCommits);

      // 4. Compute 3-way tree diff
      let diffs: readonly FileDiff[] = [];
      if (pr.headCommit) {
        try {
          diffs = await computeTreeFullDiff(client, baseSha, pr.headCommit);
        } catch {
          diffs = [];
        }
      }

      // 5. Load review notes & attach to diffs
      let notes: ReviewNote[] = [];
      try {
        notes = await loadReviewNotes(client, pr.headCommit);
      } catch {
        notes = [];
      }
      setReviewNotes(notes);

      if (notes.length > 0 && diffs.length > 0) {
        diffs = attachReviewNotes(diffs, notes);
      }
      setFileDiffs(diffs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to load pull request diff: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [client, pr.headCommit, pr.targetBranch]);

  useEffect(() => {
    void loadPRData();
  }, [loadPRData]);

  const toggleFileCollapse = (pathKey: string) => {
    setCollapsedFiles((prev) => ({
      ...prev,
      [pathKey]: !prev[pathKey],
    }));
  };

  const toggleCommitExpand = (oid: string) => {
    setExpandedCommits((prev) => ({
      ...prev,
      [oid]: !prev[oid],
    }));
  };

  // Diff totals
  const totalAdditions = useMemo(
    () => fileDiffs.reduce((sum, f) => sum + f.additions, 0),
    [fileDiffs]
  );
  const totalDeletions = useMemo(
    () => fileDiffs.reduce((sum, f) => sum + f.deletions, 0),
    [fileDiffs]
  );

  // Filtered file diffs
  const displayedDiffs = useMemo(() => {
    if (!selectedFileFilter) return fileDiffs;
    return fileDiffs.filter((f) => (f.newPath ?? f.oldPath) === selectedFileFilter);
  }, [fileDiffs, selectedFileFilter]);

  // Unique participants
  const participants = useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();
    map.set(pr.author.name, pr.author);
    for (const c of pr.comments) {
      if (c.author.name) {
        map.set(c.author.name, c.author);
      }
    }
    for (const commit of commits) {
      if (commit.author.name) {
        map.set(commit.author.name, { name: commit.author.name, email: commit.author.email });
      }
    }
    for (const note of reviewNotes) {
      if (note.author.name) {
        map.set(note.author.name, note.author);
      }
    }
    return Array.from(map.values());
  }, [pr, commits, reviewNotes]);

  // Combined chronological timeline items for Conversation tab
  interface TimelineItem {
    readonly id: string;
    readonly type: 'comment' | 'commit' | 'review_note';
    readonly timestamp: number;
    readonly author: { readonly name: string; readonly email?: string | undefined };
    readonly body?: string | undefined;
    readonly commitSha?: string | undefined;
    readonly filePath?: string | undefined;
    readonly line?: number | undefined;
  }

  const timelineItems: readonly TimelineItem[] = useMemo(() => {
    const items: TimelineItem[] = [];

    // Comments
    for (const c of pr.comments) {
      items.push({
        id: `comment-${c.id}`,
        type: 'comment',
        timestamp: c.createdAt,
        author: c.author,
        body: c.body,
      });
    }

    // Commits in PR
    for (const commit of commits) {
      items.push({
        id: `commit-${commit.oid}`,
        type: 'commit',
        timestamp: commit.author.timestamp,
        author: { name: commit.author.name, email: commit.author.email },
        body: commit.subject,
        commitSha: commit.oid,
      });
    }

    // Standalone review notes
    for (let idx = 0; idx < reviewNotes.length; idx++) {
      const note = reviewNotes[idx];
      if (note) {
        items.push({
          id: `note-${idx}-${note.commitSha}`,
          type: 'review_note',
          timestamp: note.createdAt,
          author: note.author,
          body: note.body,
          commitSha: note.commitSha,
          ...(note.filePath !== undefined ? { filePath: note.filePath } : {}),
          ...(note.line !== undefined ? { line: note.line } : {}),
        });
      }
    }

    // Sort chronologically ascending
    items.sort((a, b) => a.timestamp - b.timestamp);
    return items;
  }, [pr.comments, commits, reviewNotes]);

  const authorBg = getAuthorColor(pr.author.name, pr.author.email);
  const authorInitials = getAuthorInitials(pr.author.name);

  const statusLabel =
    pr.status === 'open' ? 'Open' : pr.status === 'merged' ? 'Merged' : 'Closed';
  const statusIcon =
    pr.status === 'open' ? '⚯' : pr.status === 'merged' ? '✓' : '⊘';

  return (
    <div className="pr-detail-view" data-testid="pr-detail-view">
      {/* Back Button */}
      {onBack && (
        <div style={{ marginBottom: '12px' }}>
          <button
            type="button"
            className="btn btn-back collab-back-btn"
            onClick={onBack}
            data-testid="back-to-pulls-btn"
          >
            ← Back to Pull Requests
          </button>
        </div>
      )}

      {/* PR Header Section */}
      <div className="collab-detail-header pr-detail-header">
        <div className="pr-header-title-row">
          <h1 className="pr-detail-title" data-testid="pr-title">
            <span>{pr.title || 'Untitled Pull Request'}</span>
            <span className="pr-number-badge" data-testid="pr-number-badge">
              #{pr.number || pr.id}
            </span>
          </h1>
        </div>

        <div className="pr-header-meta-row">
          <span
            className={`status-pill ${
              pr.status === 'open'
                ? 'status-pill-open'
                : pr.status === 'merged'
                ? 'status-pill-merged'
                : 'status-pill-closed'
            }`}
            data-testid="pr-status-badge"
          >
            <span className="status-pill-icon">{statusIcon}</span>
            <span>{statusLabel}</span>
          </span>

          <div className="pr-header-summary">
            <span
              className="author-avatar-sm"
              style={{ backgroundColor: authorBg }}
              title={`${pr.author.name} <${pr.author.email}>`}
            >
              {authorInitials}
            </span>
            <strong className="author-name">{pr.author.name}</strong> wants to merge{' '}
            <span className="badge">{commits.length}</span> commit{commits.length === 1 ? '' : 's'} into{' '}
            <span className="branch-pill">{pr.targetBranch}</span> from{' '}
            <span className="branch-pill">
              {pr.sourceBranch || formatSha(pr.headCommit)}
            </span>
          </div>
        </div>

        {/* 3-Tab Bar: Conversation, Commits, Files Changed */}
        <div className="pr-nav-tabs" role="tablist" data-testid="pr-tabs">
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'conversation'}
            className={`pr-nav-tab ${currentTab === 'conversation' ? 'active' : ''}`}
            onClick={() => {
              handleTabClick('conversation');
            }}
            data-testid="pr-tab-conversation"
          >
            💬 Conversation{' '}
            <span className="badge" data-testid="pr-comments-badge">
              {pr.comments.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'commits'}
            className={`pr-nav-tab ${currentTab === 'commits' ? 'active' : ''}`}
            onClick={() => {
              handleTabClick('commits');
            }}
            data-testid="pr-tab-commits"
          >
            📜 Commits{' '}
            <span className="badge" data-testid="pr-commits-badge">
              {commits.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'files'}
            className={`pr-nav-tab ${currentTab === 'files' ? 'active' : ''}`}
            onClick={() => {
              handleTabClick('files');
            }}
            data-testid="pr-tab-files"
          >
            📁 Files Changed{' '}
            <span className="badge" data-testid="pr-files-badge">
              {fileDiffs.length}
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div
          className="box"
          style={{
            padding: '16px',
            backgroundColor: 'var(--diff-del-bg)',
            borderColor: 'var(--diff-del-text)',
            marginBottom: '16px',
          }}
          data-testid="pr-error-box"
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* TAB 1: CONVERSATION */}
      {currentTab === 'conversation' && (
        <div className="collab-detail-layout pr-conversation-layout" data-testid="pr-conversation-tab">
          <div className="collab-timeline-column">
            {/* PR Description Card */}
            <div className="timeline-card op-card" data-testid="pr-description-card">
              <div className="timeline-card-header">
                <div className="timeline-author-info">
                  <span
                    className="timeline-avatar"
                    style={{ backgroundColor: authorBg }}
                  >
                    {authorInitials}
                  </span>
                  <span className="timeline-author-name">{pr.author.name}</span>
                  <span className="author-role-badge">Author</span>
                  <span className="timeline-timestamp">
                    opened {formatRelativeTime(pr.createdAt)}
                  </span>
                </div>
              </div>

              <div
                className="timeline-card-body markdown-body"
                data-testid="pr-description-body"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(pr.description || '*No description provided.*'),
                }}
              />
            </div>

                {/* Chronological Timeline Events */}
                {timelineItems.length > 0 && (
                  <div className="timeline-comments-list" data-testid="pr-timeline-events">
                    {timelineItems.map((item) => {
                      if (item.type === 'commit') {
                        return (
                          <div
                            key={item.id}
                            className="timeline-event-row commit-event-row"
                            data-testid={`timeline-commit-${item.commitSha ?? ''}`}
                          >
                            <span className="timeline-event-icon">📜</span>
                            <span className="timeline-event-text">
                              <strong>{item.author.name}</strong> added commit{' '}
                              <code className="commit-sha-inline">
                                {formatSha(item.commitSha ?? '')}
                              </code>{' '}
                              — <span className="commit-subject-text">{item.body}</span>
                            </span>
                            <span className="timeline-event-time">
                              {formatRelativeTime(item.timestamp)}
                            </span>
                          </div>
                        );
                      }

                      if (item.type === 'review_note') {
                        return (
                          <div
                            key={item.id}
                            className="timeline-card review-note-card"
                            data-testid={`timeline-review-note-${item.id}`}
                          >
                            <div className="timeline-card-header review-header">
                              <div className="timeline-author-info">
                                <span
                                  className="timeline-avatar"
                                  style={{
                                    backgroundColor: getAuthorColor(
                                      item.author.name,
                                      item.author.email
                                    ),
                                  }}
                                >
                                  {getAuthorInitials(item.author.name)}
                                </span>
                                <span className="timeline-author-name">{item.author.name}</span>
                                <span className="review-role-badge">Review Note</span>
                                {item.filePath && (
                                  <span className="review-file-badge">
                                    on <code>{item.filePath}</code>
                                    {item.line !== undefined ? `:${item.line}` : ''}
                                  </span>
                                )}
                                <span className="timeline-timestamp">
                                  {formatRelativeTime(item.timestamp)}
                                </span>
                              </div>
                            </div>
                            <div
                              className="timeline-card-body markdown-body"
                              dangerouslySetInnerHTML={{
                                __html: renderMarkdown(item.body ?? ''),
                              }}
                            />
                          </div>
                        );
                      }

                      // Comment card
                      const isAuthor = item.author.name === pr.author.name;
                      return (
                        <div
                          key={item.id}
                          className="timeline-card comment-card"
                          data-testid={`timeline-comment-${item.id}`}
                        >
                          <div className="timeline-card-header">
                            <div className="timeline-author-info">
                              <span
                                className="timeline-avatar"
                                style={{
                                  backgroundColor: getAuthorColor(
                                    item.author.name,
                                    item.author.email
                                  ),
                                }}
                              >
                                {getAuthorInitials(item.author.name)}
                              </span>
                              <span className="timeline-author-name">{item.author.name}</span>
                              {isAuthor && <span className="author-role-badge">Author</span>}
                              <span className="timeline-timestamp">
                                commented {formatRelativeTime(item.timestamp)}
                              </span>
                            </div>
                          </div>
                          <div
                            className="timeline-card-body markdown-body"
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdown(item.body ?? ''),
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Conversation Sidebar */}
              <aside className="collab-sidebar" aria-label="Pull Request sidebar">
                {/* Labels Section */}
                <div className="sidebar-section" data-testid="sidebar-labels-section">
                  <h4 className="sidebar-section-title">Labels</h4>
                  {pr.labels.length === 0 ? (
                    <span className="sidebar-empty-text">None yet</span>
                  ) : (
                    <div className="sidebar-labels-list">
                      {pr.labels.map((label) => (
                        <span key={label} className="label-badge sidebar-label-badge">
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Branches & Merge Base Metadata */}
                <div className="sidebar-section" data-testid="sidebar-branches-section">
                  <h4 className="sidebar-section-title">Branches &amp; LCA</h4>
                  <div className="sidebar-meta-row">
                    <span className="sidebar-meta-label">Target:</span>
                    <span className="branch-pill-sm">{pr.targetBranch}</span>
                  </div>
                  <div className="sidebar-meta-row">
                    <span className="sidebar-meta-label">Source:</span>
                    <span className="branch-pill-sm">{pr.sourceBranch || 'feature'}</span>
                  </div>
                  <div className="sidebar-meta-row">
                    <span className="sidebar-meta-label">Head:</span>
                    <code className="commit-sha-inline">{formatSha(pr.headCommit)}</code>
                  </div>
                  <div className="sidebar-meta-row">
                    <span className="sidebar-meta-label">Merge Base:</span>
                    <code className="commit-sha-inline">
                      {mergeBaseSha ? formatSha(mergeBaseSha) : 'Root/None'}
                    </code>
                  </div>
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
          )}

          {/* TAB 2: COMMITS */}
          {currentTab === 'commits' && (
            <div className="pr-commits-tab" data-testid="pr-commits-tab">
              <div className="box pr-commits-box">
                <div className="box-header pr-commits-header">
                  <span>Commits ({commits.length})</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    In {pr.sourceBranch || formatSha(pr.headCommit)} since{' '}
                    {mergeBaseSha ? formatSha(mergeBaseSha) : 'root'}
                  </span>
                </div>

                {loading && commits.length === 0 ? (
                  <div
                    className="box"
                    style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}
                    data-testid="commits-loading-indicator"
                  >
                    Loading pull request commits...
                  </div>
                ) : commits.length === 0 ? (
                  <div className="pr-empty-state" data-testid="no-commits-state">
                    <p className="pr-empty-desc">No commits found between merge base and head.</p>
                  </div>
                ) : (
                  <div className="commit-log pr-commits-list">
                    {commits.map((commit) => {
                      const isExpanded = !!expandedCommits[commit.oid];
                      return (
                        <div
                          key={commit.oid}
                          className="commit-item pr-commit-item"
                          data-testid={`commit-row-${commit.oid}`}
                        >
                          <div className="commit-item-main">
                            <div className="commit-item-title-row">
                              <span
                                className="commit-item-subject"
                                onClick={() => {
                                  if (commit.body) toggleCommitExpand(commit.oid);
                                }}
                              >
                                {commit.subject}
                              </span>
                              {commit.body && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-expand-commit"
                                  onClick={() => {
                                    toggleCommitExpand(commit.oid);
                                  }}
                                  title="Expand commit body"
                                >
                                  {isExpanded ? '▴' : '▾'}
                                </button>
                              )}
                              {commit.gpgSig && (
                                <span className="gpg-badge" title="GPG Signature Verified">
                                  Verified
                                </span>
                              )}
                            </div>

                            {isExpanded && commit.body && (
                              <pre className="commit-body-text">{commit.body}</pre>
                            )}

                            <div className="commit-item-meta">
                              <span
                                className="author-avatar-sm"
                                style={{
                                  backgroundColor: getAuthorColor(
                                    commit.author.name,
                                    commit.author.email
                                  ),
                                }}
                              >
                                {getAuthorInitials(commit.author.name)}
                              </span>
                              <span>
                                <strong>{commit.author.name}</strong> committed{' '}
                                <span title={formatIsoDate(commit.author.timestamp)}>
                                  {formatRelativeTime(commit.author.timestamp)}
                                </span>
                              </span>
                            </div>
                          </div>

                          <div className="commit-item-actions">
                            <button
                              type="button"
                              className="btn btn-sm commit-sha-btn"
                              onClick={() => {
                                if (onSelectCommit) {
                                  onSelectCommit(commit.oid);
                                } else {
                                  window.location.hash = `#/commit/${commit.oid}`;
                                }
                              }}
                              data-testid={`commit-sha-${commit.oid}`}
                            >
                              <code>{formatSha(commit.oid)}</code>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: FILES CHANGED */}
          {currentTab === 'files' && (
            <div className="pr-files-tab" data-testid="pr-files-tab">
              {/* Files Control Bar */}
              <div className="box pr-diff-controls-box" style={{ marginBottom: '16px', padding: '12px' }}>
                <div className="diff-header-summary">
                  <div className="diff-stats-group">
                    <span className="diff-stat-files">
                      <strong>{fileDiffs.length}</strong> file{fileDiffs.length === 1 ? '' : 's'} changed
                    </span>
                    <span className="diff-stat-additions" data-testid="total-additions">
                      +{totalAdditions}
                    </span>
                    <span className="diff-stat-deletions" data-testid="total-deletions">
                      -{totalDeletions}
                    </span>
                  </div>

                  <div className="diff-view-mode-group">
                    {/* File filter jump dropdown */}
                    {fileDiffs.length > 1 && (
                      <select
                        className="select-input diff-file-select"
                        value={selectedFileFilter}
                        onChange={(e) => {
                          const target = e.target as HTMLSelectElement | null;
                          setSelectedFileFilter(target?.value ?? '');
                        }}
                        data-testid="file-jump-select"
                        aria-label="Jump to file"
                      >
                        <option value="">All Files ({fileDiffs.length})</option>
                        {fileDiffs.map((f) => {
                          const p = f.newPath ?? f.oldPath ?? 'unknown';
                          return (
                            <option key={p} value={p}>
                              {p} (+{f.additions} -{f.deletions})
                            </option>
                          );
                        })}
                      </select>
                    )}

                    {/* Mode switcher: Unified vs Split */}
                    <div className="btn-group" role="group" aria-label="Diff view mode">
                      <button
                        type="button"
                        className={`btn ${diffMode === 'unified' ? 'active' : ''}`}
                        onClick={() => {
                          setDiffMode('unified');
                        }}
                        data-testid="diff-mode-unified-btn"
                      >
                        Unified
                      </button>
                      <button
                        type="button"
                        className={`btn ${diffMode === 'split' ? 'active' : ''}`}
                        onClick={() => {
                          setDiffMode('split');
                        }}
                        data-testid="diff-mode-split-btn"
                      >
                        Split
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* File Diff Cards List */}
              {loading && fileDiffs.length === 0 ? (
                <div
                  className="box"
                  style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}
                  data-testid="pr-loading-indicator"
                >
                  Computing merge base and loading pull request diff...
                </div>
              ) : displayedDiffs.length === 0 ? (
                <div className="box collab-empty-state" data-testid="no-diff-state">
                  <div className="empty-state-icon">📁</div>
                  <h3 className="empty-state-title">No changes detected</h3>
                  <p className="empty-state-desc">
                    The source branch has no file changes compared to the merge base.
                  </p>
                </div>
              ) : (
                <div className="diff-files-list">
                  {displayedDiffs.map((fileDiff) => {
                    const filePath = fileDiff.newPath ?? fileDiff.oldPath ?? 'unknown';
                    const isCollapsed = !!collapsedFiles[filePath];

                    return (
                      <div
                        key={filePath}
                        className="box diff-file-card"
                        data-testid={`file-diff-card-${filePath}`}
                        style={{ marginBottom: '16px' }}
                      >
                        <div
                          className="box-header diff-file-header"
                          onClick={() => {
                            toggleFileCollapse(filePath);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="diff-file-title">
                            <span className="diff-collapse-toggle">
                              {isCollapsed ? '▶' : '▼'}
                            </span>
                            <span className="diff-file-icon">📄</span>
                            <span className="diff-file-path">
                              {fileDiff.oldPath &&
                              fileDiff.newPath &&
                              fileDiff.oldPath !== fileDiff.newPath ? (
                                <span>
                                  {fileDiff.oldPath} → <strong>{fileDiff.newPath}</strong>
                                </span>
                              ) : (
                                <strong>{filePath}</strong>
                              )}
                            </span>
                            {fileDiff.modeChanged && (
                              <span className="badge" title="File mode changed">
                                Mode: {fileDiff.oldMode} → {fileDiff.newMode}
                              </span>
                            )}
                          </div>

                          <div className="diff-file-stats">
                            <span className="diff-add">+{fileDiff.additions}</span>
                            <span className="diff-del">-{fileDiff.deletions}</span>
                          </div>
                        </div>

                        {!isCollapsed && (
                          <div className="diff-file-body">
                            {fileDiff.isBinary ? (
                              <div
                                style={{
                                  padding: '24px',
                                  textAlign: 'center',
                                  color: 'var(--text-muted)',
                                }}
                              >
                                Binary file changed ({fileDiff.oldOid ? formatSha(fileDiff.oldOid) : 'null'} →{' '}
                                {fileDiff.newOid ? formatSha(fileDiff.newOid) : 'null'})
                              </div>
                            ) : diffMode === 'unified' ? (
                              /* UNIFIED DIFF VIEW */
                              <div className="diff-table-container">
                                <table className="diff-table">
                                  <tbody>
                                    {fileDiff.hunks.map((hunk, hIdx) => (
                                      <>
                                        <tr
                                          key={`hunk-${hIdx}`}
                                          className="diff-line diff-line-header"
                                        >
                                          <td className="diff-line-num">...</td>
                                          <td className="diff-line-num">...</td>
                                          <td className="diff-line-content diff-hunk-header">
                                            {hunk.header}
                                          </td>
                                        </tr>
                                        {hunk.lines.map((line, lIdx) => {
                                          const lineClass =
                                            line.type === 'add'
                                              ? 'diff-line-add'
                                              : line.type === 'delete'
                                              ? 'diff-line-del'
                                              : 'diff-line-context';

                                          const prefix =
                                            line.type === 'add'
                                              ? '+'
                                              : line.type === 'delete'
                                              ? '-'
                                              : ' ';

                                          return (
                                            <>
                                              <tr
                                                key={`hunk-${hIdx}-line-${lIdx}`}
                                                className={`diff-line ${lineClass}`}
                                              >
                                                <td className="diff-line-num">
                                                  {line.oldLineNumber ?? ''}
                                                </td>
                                                <td className="diff-line-num">
                                                  {line.newLineNumber ?? ''}
                                                </td>
                                                <td className="diff-line-content">
                                                  <span className="diff-prefix">{prefix}</span>
                                                  {line.content}
                                                </td>
                                              </tr>
                                              {/* Inline Review Notes on Diff Line */}
                                              {line.reviewNotes?.map((note, nIdx) => (
                                                <tr
                                                  key={`note-${hIdx}-${lIdx}-${nIdx}`}
                                                  className="diff-line-review-note"
                                                >
                                                    <td colSpan={3} className="review-note-cell">
                                                      <div className="inline-review-card">
                                                        <div className="inline-review-header">
                                                          <span
                                                            className="author-avatar-sm"
                                                            style={{
                                                              backgroundColor: getAuthorColor(
                                                                note.author.name,
                                                                note.author.email
                                                              ),
                                                            }}
                                                          >
                                                            {getAuthorInitials(note.author.name)}
                                                          </span>
                                                          <strong>{note.author.name}</strong>
                                                          <span className="review-timestamp">
                                                            {formatRelativeTime(note.createdAt)}
                                                          </span>
                                                        </div>
                                                        <div
                                                          className="inline-review-body markdown-body"
                                                          dangerouslySetInnerHTML={{
                                                            __html: renderMarkdown(note.body),
                                                          }}
                                                        />
                                                      </div>
                                                    </td>
                                                  </tr>
                                                ))}
                                            </>
                                          );
                                        })}
                                      </>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              /* SPLIT DIFF VIEW */
                              <div className="diff-table-container split-diff-container">
                                <table className="diff-table split-diff-table">
                                  <tbody>
                                    {fileDiff.splitRows.map((row: SplitDiffRow, rIdx: number) => {
                                      const leftClass =
                                        row.left.type === 'delete'
                                          ? 'diff-line-del'
                                          : row.left.type === 'context'
                                          ? 'diff-line-context'
                                          : 'diff-line-empty';

                                      const rightClass =
                                        row.right.type === 'add'
                                          ? 'diff-line-add'
                                          : row.right.type === 'context'
                                          ? 'diff-line-context'
                                          : 'diff-line-empty';

                                      return (
                                        <>
                                          <tr key={`split-${rIdx}`} className="split-diff-row">
                                            {/* Left Side (Old) */}
                                            <td className="diff-line-num split-num">
                                              {row.left.lineNumber ?? ''}
                                            </td>
                                            <td className={`diff-line-content split-content ${leftClass}`}>
                                              {row.left.content !== null ? (
                                                <>
                                                  <span className="diff-prefix">
                                                    {row.left.type === 'delete'
                                                      ? '-'
                                                      : row.left.type === 'context'
                                                      ? ' '
                                                      : ''}
                                                  </span>
                                                  {row.left.content}
                                                </>
                                              ) : null}
                                            </td>

                                            {/* Right Side (New) */}
                                            <td className="diff-line-num split-num">
                                              {row.right.lineNumber ?? ''}
                                            </td>
                                            <td className={`diff-line-content split-content ${rightClass}`}>
                                              {row.right.content !== null ? (
                                                <>
                                                  <span className="diff-prefix">
                                                    {row.right.type === 'add'
                                                      ? '+'
                                                      : row.right.type === 'context'
                                                      ? ' '
                                                      : ''}
                                                  </span>
                                                  {row.right.content}
                                                </>
                                              ) : null}
                                            </td>
                                          </tr>

                                          {/* Split Review Notes */}
                                          {(((row.left.reviewNotes?.length ?? 0) > 0) ||
                                            ((row.right.reviewNotes?.length ?? 0) > 0)) && (
                                            <tr key={`split-notes-${rIdx}`} className="diff-line-review-note">
                                              <td colSpan={4} className="review-note-cell">
                                                {[
                                                  ...(row.left.reviewNotes ?? []),
                                                  ...(row.right.reviewNotes ?? []),
                                                ].map((note, nIdx) => (
                                                  <div
                                                    key={`split-note-${rIdx}-${nIdx}`}
                                                    className="inline-review-card"
                                                  >
                                                    <div className="inline-review-header">
                                                      <span
                                                        className="author-avatar-sm"
                                                        style={{
                                                          backgroundColor: getAuthorColor(
                                                            note.author.name,
                                                            note.author.email
                                                          ),
                                                        }}
                                                      >
                                                        {getAuthorInitials(note.author.name)}
                                                      </span>
                                                      <strong>{note.author.name}</strong>
                                                      <span className="review-timestamp">
                                                        {formatRelativeTime(note.createdAt)}
                                                      </span>
                                                    </div>
                                                    <div
                                                      className="inline-review-body markdown-body"
                                                      dangerouslySetInnerHTML={{
                                                        __html: renderMarkdown(note.body),
                                                      }}
                                                    />
                                                  </div>
                                                ))}
                                              </td>
                                            </tr>
                                          )}
                                        </>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
        )}
    </div>
  );
};
