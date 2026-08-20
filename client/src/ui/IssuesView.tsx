import { useMemo, useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { Issue } from '../engine/collab-client.js';
import { formatRelativeTime, getAuthorColor, getAuthorInitials } from './utils.js';

export interface IssuesViewProps {
  readonly issues: readonly Issue[];
  readonly onSelectIssue?: ((id: string) => void) | undefined;
  readonly initialFilter?: 'open' | 'closed' | 'all' | undefined;
  readonly initialQuery?: string | undefined;
  readonly initialLabel?: string | undefined;
  readonly initialAuthor?: string | undefined;
}

export const IssuesView: FunctionalComponent<IssuesViewProps> = ({
  issues,
  onSelectIssue,
  initialFilter = 'open',
  initialQuery = '',
  initialLabel = '',
  initialAuthor = '',
}) => {
  const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>(initialFilter);
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery);
  const [selectedLabel, setSelectedLabel] = useState<string>(initialLabel);
  const [selectedAuthor, setSelectedAuthor] = useState<string>(initialAuthor);

  // Compute status counts
  const { openCount, closedCount, totalCount } = useMemo(() => {
    let open = 0;
    let closed = 0;
    for (const issue of issues) {
      if (issue.status === 'open') {
        open++;
      } else {
        closed++;
      }
    }
    return {
      openCount: open,
      closedCount: closed,
      totalCount: issues.length,
    };
  }, [issues]);

  // Extract all unique labels
  const allLabels = useMemo(() => {
    const labelsSet = new Set<string>();
    for (const issue of issues) {
      for (const label of issue.labels) {
        if (label.trim().length > 0) {
          labelsSet.add(label.trim());
        }
      }
    }
    return Array.from(labelsSet).sort();
  }, [issues]);

  // Extract all unique authors
  const allAuthors = useMemo(() => {
    const authorsSet = new Set<string>();
    for (const issue of issues) {
      if (issue.author.name.trim().length > 0) {
        authorsSet.add(issue.author.name.trim());
      }
    }
    return Array.from(authorsSet).sort();
  }, [issues]);

  // Filter issues based on all criteria
  const filteredIssues = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const isIdQuery = /^#?(\d+)$/.exec(query);
    const targetNumber = isIdQuery?.[1] ? parseInt(isIdQuery[1], 10) : null;

    return issues.filter((issue) => {
      // 1. Status filter
      if (statusFilter !== 'all' && issue.status !== statusFilter) {
        return false;
      }

      // 2. Author filter
      if (selectedAuthor && issue.author.name !== selectedAuthor) {
        return false;
      }

      // 3. Label filter
      if (selectedLabel && !issue.labels.includes(selectedLabel)) {
        return false;
      }

      // 4. Search query
      if (query) {
        if (targetNumber !== null && issue.number === targetNumber) {
          return true;
        }
        const matchesId = issue.id.toLowerCase().includes(query) || `#${issue.number}`.includes(query);
        const matchesTitle = issue.title.toLowerCase().includes(query);
        const matchesDescription = issue.description.toLowerCase().includes(query);
        const matchesAuthor =
          issue.author.name.toLowerCase().includes(query) ||
          issue.author.email.toLowerCase().includes(query);
        const matchesLabels = issue.labels.some((l) => l.toLowerCase().includes(query));

        if (!matchesId && !matchesTitle && !matchesDescription && !matchesAuthor && !matchesLabels) {
          return false;
        }
      }

      return true;
    });
  }, [issues, statusFilter, selectedAuthor, selectedLabel, searchQuery]);

  const handleClearFilters = () => {
    setStatusFilter('all');
    setSearchQuery('');
    setSelectedLabel('');
    setSelectedAuthor('');
  };

  const hasActiveFilters =
    searchQuery !== '' || selectedLabel !== '' || selectedAuthor !== '' || statusFilter !== 'all';

  return (
    <div className="issues-view-container" data-testid="issues-view">
      {/* Top Filter & Search Controls Bar */}
      <div className="collab-header-controls">
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
            <span className="collab-tab-icon status-badge-icon open">🎯</span>
            <span>Open</span>
            <span className="badge collab-count-badge" data-testid="open-count-badge">
              {openCount}
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
            <span className="collab-tab-icon status-badge-icon closed">✓</span>
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
              {totalCount}
            </span>
          </button>
        </div>

        <div className="collab-search-and-filters">
          {/* Author filter dropdown */}
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

          {/* Instant search box */}
          <div className="collab-search-box">
            <span className="collab-search-icon">🔍</span>
            <input
              type="text"
              className="collab-search-input"
              placeholder="Search issues or #id..."
              value={searchQuery}
              onInput={(e) => {
                const target = e.target as HTMLInputElement | null;
                setSearchQuery(target?.value ?? '');
              }}
              data-testid="issues-search-input"
              aria-label="Search issues"
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

      {/* Issues List */}
      <div className="box collab-list-box">
        {filteredIssues.length === 0 ? (
          <div className="collab-empty-state" data-testid="issues-empty-state">
            <div className="empty-state-icon">🎯</div>
            <h3 className="empty-state-title">
              {issues.length === 0
                ? 'No issues found'
                : statusFilter === 'open' && !searchQuery && !selectedLabel && !selectedAuthor
                ? 'No open issues'
                : statusFilter === 'closed' && !searchQuery && !selectedLabel && !selectedAuthor
                ? 'No closed issues'
                : 'No issues match your filters'}
            </h3>
            <p className="empty-state-desc">
              {issues.length === 0
                ? 'There are no issues tracked in this repository.'
                : hasActiveFilters
                ? 'Try clearing your search query or status filter to view other issues.'
                : ''}
            </p>
            {hasActiveFilters && issues.length > 0 && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleClearFilters}
                data-testid="clear-filters-btn"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <ul className="collab-list" role="list">
            {filteredIssues.map((issue) => {
              const isOpen = issue.status === 'open';
              const commentCount = issue.comments.length;
              const avatarBg = getAuthorColor(issue.author.name, issue.author.email);
              const initials = getAuthorInitials(issue.author.name);

              return (
                <li
                  key={issue.id}
                  className="collab-list-item issue-list-item"
                  data-testid={`issue-item-${issue.id}`}
                >
                  <div className="collab-item-status-icon">
                    {isOpen ? (
                      <span className="status-badge-icon open" title="Open Issue">
                        🎯
                      </span>
                    ) : (
                      <span className="status-badge-icon closed" title="Closed Issue">
                        ✓
                      </span>
                    )}
                  </div>

                  <div className="collab-item-main">
                    <div className="collab-item-title-row">
                      <a
                        href={`#/issues/${issue.id}`}
                        className="collab-item-title issue-title-link"
                        onClick={(e) => {
                          if (onSelectIssue) {
                            e.preventDefault();
                            onSelectIssue(issue.id);
                          }
                        }}
                      >
                        {issue.title || 'Untitled Issue'}
                      </a>

                      <span className="issue-number-badge">#{issue.number || issue.id}</span>

                      {issue.labels.map((label) => (
                        <span key={label} className="label-badge">
                          {label}
                        </span>
                      ))}
                    </div>

                    <div className="collab-item-meta issue-meta-row">
                      <span
                        className="author-avatar-sm"
                        style={{ backgroundColor: avatarBg }}
                        title={`${issue.author.name} <${issue.author.email}>`}
                      >
                        {initials}
                      </span>
                      <span>
                        <strong className="collab-author-name">{issue.author.name}</strong> opened{' '}
                        {formatRelativeTime(issue.createdAt)}
                      </span>
                    </div>
                  </div>

                  <div className="collab-item-right">
                    {commentCount > 0 && (
                      <div className="collab-item-comments" title={`${commentCount} comments`}>
                        <span className="comments-icon">💬</span>
                        <span className="comments-count">{commentCount}</span>
                      </div>
                    )}
                    <span className="issue-updated-time">
                      Updated {formatRelativeTime(issue.updatedAt)}
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
