import { useMemo, useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { PullRequest } from '../engine/collab-client.js';
import { formatRelativeTime, formatSha, getAuthorColor, getAuthorInitials } from './utils.js';

export interface PullRequestsViewProps {
  readonly pulls: readonly PullRequest[];
  readonly onSelectPull?: ((id: string) => void) | undefined;
  readonly initialFilter?: 'open' | 'merged' | 'closed' | 'all' | undefined;
  readonly initialQuery?: string | undefined;
  readonly initialLabel?: string | undefined;
  readonly initialAuthor?: string | undefined;
}

export const PullRequestsView: FunctionalComponent<PullRequestsViewProps> = ({
  pulls,
  onSelectPull,
  initialFilter = 'open',
  initialQuery = '',
  initialLabel = '',
  initialAuthor = '',
}) => {
  const [statusFilter, setStatusFilter] = useState<'open' | 'merged' | 'closed' | 'all'>(initialFilter);
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery);
  const [selectedLabel, setSelectedLabel] = useState<string>(initialLabel);
  const [selectedAuthor, setSelectedAuthor] = useState<string>(initialAuthor);

  // Compute status counts across all PRs
  const { openCount, mergedCount, closedCount, allCount } = useMemo(() => {
    let open = 0;
    let merged = 0;
    let closed = 0;
    for (const p of pulls) {
      if (p.status === 'open') {
        open++;
      } else if (p.status === 'merged') {
        merged++;
      } else {
        closed++;
      }
    }
    return {
      openCount: open,
      mergedCount: merged,
      closedCount: closed,
      allCount: pulls.length,
    };
  }, [pulls]);

  // Extract all unique labels and authors
  const { allLabels, allAuthors } = useMemo(() => {
    const labelSet = new Set<string>();
    const authorSet = new Set<string>();

    for (const p of pulls) {
      for (const l of p.labels) {
        if (l.trim()) labelSet.add(l.trim());
      }
      if (p.author.name.trim()) {
        authorSet.add(p.author.name.trim());
      }
    }

    return {
      allLabels: Array.from(labelSet).sort(),
      allAuthors: Array.from(authorSet).sort(),
    };
  }, [pulls]);

  // Filter PRs based on current filter state
  const filteredPulls = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const isIdQuery = /^#?(\d+)$/.exec(q);
    const targetNumber = isIdQuery?.[1] ? parseInt(isIdQuery[1], 10) : null;

    return pulls.filter((p) => {
      // Status filter
      if (statusFilter !== 'all' && p.status !== statusFilter) {
        return false;
      }

      // Label filter
      if (selectedLabel && !p.labels.includes(selectedLabel)) {
        return false;
      }

      // Author filter
      if (selectedAuthor && p.author.name !== selectedAuthor) {
        return false;
      }

      // Text search query
      if (q) {
        if (targetNumber !== null && p.number === targetNumber) {
          return true;
        }
        const idMatch = p.id.toLowerCase().includes(q) || `#${p.number}`.includes(q);
        const titleMatch = p.title.toLowerCase().includes(q);
        const descMatch = p.description.toLowerCase().includes(q);
        const authorMatch =
          p.author.name.toLowerCase().includes(q) || p.author.email.toLowerCase().includes(q);
        const branchMatch =
          p.targetBranch.toLowerCase().includes(q) || p.sourceBranch.toLowerCase().includes(q);
        const labelMatch = p.labels.some((l) => l.toLowerCase().includes(q));

        if (!idMatch && !titleMatch && !descMatch && !authorMatch && !branchMatch && !labelMatch) {
          return false;
        }
      }

      return true;
    });
  }, [pulls, statusFilter, searchQuery, selectedLabel, selectedAuthor]);

  const handlePullClick = (id: string, e: MouseEvent) => {
    if (onSelectPull) {
      e.preventDefault();
      onSelectPull(id);
    }
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setSearchQuery('');
    setSelectedLabel('');
    setSelectedAuthor('');
  };

  const hasActiveFilters =
    searchQuery !== '' || selectedLabel !== '' || selectedAuthor !== '' || statusFilter !== 'all';

  return (
    <div className="pull-requests-view" data-testid="pull-requests-view">
      {/* Header Controls & Filters */}
      <div className="collab-header-controls">
        {/* Status Tabs */}
        <div className="collab-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'open'}
            className={`collab-tab ${statusFilter === 'open' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('open');
            }}
            data-testid="filter-open-btn"
          >
            <span className="collab-tab-icon pr-status-icon open">⚯</span>
            <span>Open</span>
            <span className="badge collab-count-badge" data-testid="open-count-badge">
              {openCount}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'merged'}
            className={`collab-tab ${statusFilter === 'merged' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('merged');
            }}
            data-testid="filter-merged-btn"
          >
            <span className="collab-tab-icon pr-status-icon merged">✓</span>
            <span>Merged</span>
            <span className="badge collab-count-badge" data-testid="merged-count-badge">
              {mergedCount}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'closed'}
            className={`collab-tab ${statusFilter === 'closed' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('closed');
            }}
            data-testid="filter-closed-btn"
          >
            <span className="collab-tab-icon pr-status-icon closed">⊘</span>
            <span>Closed</span>
            <span className="badge collab-count-badge" data-testid="closed-count-badge">
              {closedCount}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'all'}
            className={`collab-tab ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('all');
            }}
            data-testid="filter-all-btn"
          >
            <span>All</span>
            <span className="badge collab-count-badge" data-testid="all-count-badge">
              {allCount}
            </span>
          </button>
        </div>

        {/* Search Box & Dropdown Filters */}
        <div className="collab-search-and-filters">
          {/* Author Dropdown Filter */}
          {allAuthors.length > 0 && (
            <select
              className="select-input collab-filter-select"
              value={selectedAuthor}
              onChange={(e) => {
                const target = e.target as HTMLSelectElement | null;
                setSelectedAuthor(target?.value ?? '');
              }}
              data-testid="author-filter-select"
              aria-label="Filter by author"
            >
              <option value="">All Authors</option>
              {allAuthors.map((author) => (
                <option key={author} value={author}>
                  {author}
                </option>
              ))}
            </select>
          )}

          {/* Search Box */}
          <div className="collab-search-box">
            <span className="collab-search-icon">🔍</span>
            <input
              type="text"
              className="collab-search-input"
              placeholder="Search pull requests or #id..."
              value={searchQuery}
              onInput={(e) => {
                const target = e.target as HTMLInputElement | null;
                setSearchQuery(target?.value ?? '');
              }}
              data-testid="pr-search-input"
              aria-label="Search pull requests"
            />
            {searchQuery && (
              <button
                type="button"
                className="collab-search-clear"
                onClick={() => {
                  setSearchQuery('');
                }}
                title="Clear search"
                data-testid="clear-search-btn"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Label Filter Chips */}
      {allLabels.length > 0 && (
        <div className="collab-label-bar" data-testid="label-filter-bar">
          <span className="label-bar-title">Labels:</span>
          {allLabels.map((label) => {
            const isSelected = selectedLabel === label;
            return (
              <button
                key={label}
                type="button"
                className={`label-chip ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedLabel(isSelected ? '' : label);
                }}
                data-testid={`label-chip-${label}`}
              >
                {label}
                {isSelected && <span className="label-chip-remove">✕</span>}
              </button>
            );
          })}
          {selectedLabel && (
            <button
              type="button"
              className="btn btn-sm btn-clear-label"
              onClick={() => {
                setSelectedLabel('');
              }}
            >
              Clear label
            </button>
          )}
        </div>
      )}

      {/* PR List Container */}
      <div className="box collab-list-box">
        {filteredPulls.length === 0 ? (
          <div className="collab-empty-state" data-testid="pulls-empty-state">
            <div className="empty-state-icon">🔀</div>
            <h3 className="empty-state-title">
              {pulls.length === 0
                ? 'No pull requests found'
                : statusFilter === 'open' && !searchQuery && !selectedLabel && !selectedAuthor
                ? 'No open pull requests'
                : statusFilter === 'merged' && !searchQuery && !selectedLabel && !selectedAuthor
                ? 'No merged pull requests'
                : statusFilter === 'closed' && !searchQuery && !selectedLabel && !selectedAuthor
                ? 'No closed pull requests'
                : 'No pull requests match your filters'}
            </h3>
            <p className="empty-state-desc">
              {pulls.length === 0
                ? 'Pull requests discovered in refs/pull/* will appear here.'
                : hasActiveFilters
                ? 'Try adjusting your search query or clearing active filters.'
                : ''}
            </p>
            {hasActiveFilters && pulls.length > 0 && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={clearFilters}
                data-testid="clear-filters-btn"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <ul className="collab-list" role="list">
            {filteredPulls.map((pr) => {
              const statusClass =
                pr.status === 'open'
                  ? 'status-open'
                  : pr.status === 'merged'
                  ? 'status-merged'
                  : 'status-closed';

              const statusLabel =
                pr.status === 'open' ? 'Open' : pr.status === 'merged' ? 'Merged' : 'Closed';

              const statusIcon =
                pr.status === 'open' ? '⚯' : pr.status === 'merged' ? '✓' : '⊘';

              const avatarBg = getAuthorColor(pr.author.name, pr.author.email);
              const initials = getAuthorInitials(pr.author.name);
              const commentCount = pr.comments.length;

              return (
                <li
                  key={pr.id}
                  className="collab-list-item pr-list-item"
                  data-testid={`pr-item-${pr.id}`}
                >
                  <div className="collab-item-status-icon">
                    <span
                      className={`status-badge-icon ${statusClass}`}
                      title={`Status: ${statusLabel}`}
                    >
                      {statusIcon}
                    </span>
                  </div>

                  <div className="collab-item-main">
                    <div className="collab-item-title-row">
                      <a
                        href={`#/pulls/${pr.id}`}
                        className="collab-item-title pr-title-link"
                        onClick={(e) => {
                          handlePullClick(pr.id, e);
                        }}
                      >
                        {pr.title || 'Untitled Pull Request'}
                      </a>

                      <span className="pr-number-badge">#{pr.number || pr.id}</span>

                      {pr.labels.map((l) => (
                        <span key={l} className="label-badge">
                          {l}
                        </span>
                      ))}
                    </div>

                    <div className="collab-item-meta pr-meta-row">
                      <span
                        className="author-avatar-sm"
                        style={{ backgroundColor: avatarBg }}
                        title={`${pr.author.name} <${pr.author.email}>`}
                      >
                        {initials}
                      </span>
                      <span>
                        <strong className="collab-author-name">{pr.author.name}</strong> opened{' '}
                        {formatRelativeTime(pr.createdAt)} •{' '}
                        <span className="branch-pill-sm">{pr.targetBranch}</span> ←{' '}
                        <span className="branch-pill-sm">
                          {pr.sourceBranch || formatSha(pr.headCommit)}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="collab-item-right pr-item-right">
                    {commentCount > 0 && (
                      <div className="collab-item-comments" title={`${commentCount} comments`}>
                        <span className="comments-icon">💬</span>
                        <span className="comments-count">{commentCount}</span>
                      </div>
                    )}
                    <span className="pr-updated-time">
                      Updated {formatRelativeTime(pr.updatedAt)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
