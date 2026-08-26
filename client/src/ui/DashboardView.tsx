import { useMemo, useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';

export interface ForgeCommitSummary {
  readonly oid: string;
  readonly summary: string;
  readonly author: string;
  readonly timestamp: number;
}

export interface ForgeRepoStats {
  readonly commits: number;
  readonly branches: number;
  readonly tags: number;
  readonly issues: number;
  readonly pulls: number;
}

export interface ForgeRepoCard {
  readonly id: string;
  readonly name: string;
  readonly owner?: string;
  readonly description?: string;
  readonly default_branch: string;
  readonly latest_commit?: ForgeCommitSummary;
  readonly stats: ForgeRepoStats;
  readonly path: string;
}

export interface ForgeIndex {
  readonly version: number;
  readonly title: string;
  readonly generated_at: string;
  readonly repos: readonly ForgeRepoCard[];
}

export interface DashboardViewProps {
  readonly index: ForgeIndex;
  readonly onSelectRepo?: (path: string) => void;
}

export function formatRelativeTime(timestampSeconds: number): string {
  if (!timestampSeconds || timestampSeconds <= 0) {
    return 'unknown date';
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, nowSeconds - timestampSeconds);

  if (diff < 60) {
    return 'just now';
  }
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export const DashboardView: FunctionalComponent<DashboardViewProps> = ({
  index,
  onSelectRepo,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedOwner, setSelectedOwner] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'commits' | 'collab'>('recent');

  // Extract distinct owners with counts
  const ownerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const repo of index.repos) {
      const owner = repo.owner ?? 'Independent';
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [index.repos]);

  // Aggregate global stats
  const globalStats = useMemo(() => {
    let totalCommits = 0;
    let totalIssues = 0;
    let totalPulls = 0;
    for (const repo of index.repos) {
      totalCommits += repo.stats.commits;
      totalIssues += repo.stats.issues;
      totalPulls += repo.stats.pulls;
    }
    return {
      repoCount: index.repos.length,
      ownerCount: ownerCounts.length,
      totalCommits,
      totalIssues,
      totalPulls,
    };
  }, [index.repos, ownerCounts.length]);

  // Filter and sort repositories
  const filteredRepos = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return index.repos
      .filter((repo) => {
        // Owner filter
        if (selectedOwner !== 'all') {
          const owner = repo.owner ?? 'Independent';
          if (owner !== selectedOwner) {
            return false;
          }
        }

        // Search query filter
        if (!query) {
          return true;
        }

        const nameMatch = repo.name.toLowerCase().includes(query);
        const ownerMatch = (repo.owner ?? '').toLowerCase().includes(query);
        const descMatch = (repo.description ?? '').toLowerCase().includes(query);
        const idMatch = repo.id.toLowerCase().includes(query);
        const branchMatch = repo.default_branch.toLowerCase().includes(query);

        return nameMatch || ownerMatch || descMatch || idMatch || branchMatch;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'name':
            return a.name.localeCompare(b.name);
          case 'commits':
            return b.stats.commits - a.stats.commits;
          case 'collab':
            return (b.stats.issues + b.stats.pulls) - (a.stats.issues + a.stats.pulls);
          case 'recent':
          default: {
            const timeA = a.latest_commit?.timestamp ?? 0;
            const timeB = b.latest_commit?.timestamp ?? 0;
            return timeB - timeA;
          }
        }
      });
  }, [index.repos, searchQuery, selectedOwner, sortBy]);

  const handleRepoClick = (repoPath: string, e: MouseEvent) => {
    if (onSelectRepo) {
      e.preventDefault();
      onSelectRepo(repoPath);
    }
  };

  return (
    <div className="dashboard-container" data-testid="forge-dashboard-view">
      {/* Dashboard Top Header */}
      <header className="dashboard-header-bar">
        <div className="dashboard-header-content">
          <div className="dashboard-brand">
            <span className="dashboard-icon">🏛️</span>
            <div>
              <h1 className="dashboard-title">{index.title !== '' ? index.title : 'Sendforge Hub'}</h1>
              <p className="dashboard-subtitle">
                High-Performance Multi-Repository Git Portfolio
              </p>
            </div>
          </div>

          <div className="dashboard-global-stats" data-testid="dashboard-global-stats">
            <div className="stat-card">
              <span className="stat-card-value">{globalStats.repoCount}</span>
              <span className="stat-card-label">Repositories</span>
            </div>
            <div className="stat-card">
              <span className="stat-card-value">{globalStats.ownerCount}</span>
              <span className="stat-card-label">Owners</span>
            </div>
            <div className="stat-card">
              <span className="stat-card-value">{globalStats.totalCommits}</span>
              <span className="stat-card-label">Total Commits</span>
            </div>
            <div className="stat-card">
              <span className="stat-card-value">
                {globalStats.totalIssues + globalStats.totalPulls}
              </span>
              <span className="stat-card-label">Issues & PRs</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Portfolio Content */}
      <div className="dashboard-content-wrapper">
        {/* Search, Filter & Sort Toolbar */}
        <section className="dashboard-toolbar">
          <div className="dashboard-search-row">
            <div className="dashboard-search-box">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="dashboard-search-input"
                placeholder="Find a repository by name, owner, description..."
                value={searchQuery}
                onInput={(e) => {
                  setSearchQuery((e.target as HTMLInputElement).value);
                }}
                aria-label="Search repositories"
                data-testid="dashboard-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => {
                    setSearchQuery('');
                  }}
                  aria-label="Clear search"
                  data-testid="dashboard-search-clear-btn"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="dashboard-sort-box">
              <label htmlFor="dashboard-sort-select" className="sort-label">
                Sort by:
              </label>
              <select
                id="dashboard-sort-select"
                className="select-input dashboard-sort-select"
                value={sortBy}
                onChange={(e) => {
                  setSortBy(
                    (e.target as HTMLSelectElement).value as
                      | 'recent'
                      | 'name'
                      | 'commits'
                      | 'collab'
                  );
                }}
                data-testid="dashboard-sort-select"
              >
                <option value="recent">Recently Updated</option>
                <option value="name">Repository Name (A-Z)</option>
                <option value="commits">Most Commits</option>
                <option value="collab">Most Issues & Pulls</option>
              </select>
            </div>
          </div>

          {/* Owner Filter Tabs */}
          {ownerCounts.length > 1 && (
            <div className="dashboard-owner-pills" role="tablist" aria-label="Filter by owner">
              <button
                type="button"
                className={`filter-pill-btn ${selectedOwner === 'all' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedOwner('all');
                }}
                data-testid="owner-pill-all"
              >
                All Repositories ({index.repos.length})
              </button>
              {ownerCounts.map(([ownerName, count]) => (
                <button
                  key={ownerName}
                  type="button"
                  className={`filter-pill-btn ${selectedOwner === ownerName ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedOwner(ownerName);
                  }}
                  data-testid={`owner-pill-${ownerName}`}
                >
                  👤 {ownerName} ({count})
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Repository Cards Grid or Empty State */}
        {filteredRepos.length === 0 ? (
          <div className="dashboard-empty-state" data-testid="dashboard-empty-state">
            <div className="empty-icon">📂</div>
            <h3>No repositories found</h3>
            <p>
              {searchQuery
                ? `No repositories matched your search query "${searchQuery}".`
                : 'No repositories found for the selected filter.'}
            </p>
            {(searchQuery || selectedOwner !== 'all') && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedOwner('all');
                }}
                data-testid="dashboard-reset-filter-btn"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="dashboard-repo-grid" data-testid="dashboard-repo-grid">
            {filteredRepos.map((repo) => {
              const shortSha = repo.latest_commit?.oid
                ? repo.latest_commit.oid.slice(0, 7)
                : null;
              const relativeTime = repo.latest_commit?.timestamp
                ? formatRelativeTime(repo.latest_commit.timestamp)
                : null;

              return (
                <article
                  key={repo.id !== '' ? repo.id : repo.path}
                  className="dashboard-repo-card"
                  data-testid={`repo-card-${repo.name}`}
                >
                  <div className="card-top-bar">
                    <div className="card-title-group">
                      <span className="card-repo-icon">📦</span>
                      <a
                        href={repo.path}
                        className="card-repo-title"
                        onClick={(e) => {
                          handleRepoClick(repo.path, e);
                        }}
                        data-testid={`repo-link-${repo.name}`}
                      >
                        {repo.name}
                      </a>
                    </div>
                    <span className="badge default-branch-badge">
                      {repo.default_branch !== '' ? repo.default_branch : 'main'}
                    </span>
                  </div>

                  {repo.owner && (
                    <div className="card-owner-tag">
                      <span>👤 {repo.owner}</span>
                    </div>
                  )}

                  <p className="card-desc">
                    {repo.description ?? (
                      <em className="text-muted">No description provided</em>
                    )}
                  </p>

                  {/* Latest commit summary */}
                  {repo.latest_commit && (
                    <div className="card-latest-commit">
                      <div className="commit-summary-line">
                        <span className="commit-dot">●</span>
                        <strong className="commit-msg-text">
                          {repo.latest_commit.summary}
                        </strong>
                      </div>
                      <div className="commit-meta-line">
                        <span>by {repo.latest_commit.author}</span>
                        {relativeTime && <span className="commit-time">{relativeTime}</span>}
                        {shortSha && <code className="commit-hash">{shortSha}</code>}
                      </div>
                    </div>
                  )}

                  {/* Repository Statistics Badges */}
                  <div className="card-stats-row">
                    <span className="stat-item" title={`${repo.stats.commits} commits`}>
                      📜 {repo.stats.commits}
                    </span>
                    <span className="stat-item" title={`${repo.stats.branches} branches`}>
                      🌿 {repo.stats.branches}
                    </span>
                    <span className="stat-item" title={`${repo.stats.tags} tags`}>
                      🏷️ {repo.stats.tags}
                    </span>
                    <span className="stat-item" title={`${repo.stats.issues} issues`}>
                      🎯 {repo.stats.issues}
                    </span>
                    <span className="stat-item" title={`${repo.stats.pulls} pull requests`}>
                      🔀 {repo.stats.pulls}
                    </span>
                  </div>

                  <div className="card-footer-action">
                    <a
                      href={repo.path}
                      className="card-action-link"
                      onClick={(e) => {
                        handleRepoClick(repo.path, e);
                      }}
                    >
                      Browse Repository →
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <footer className="dashboard-footer">
        <span>Powered by <strong>Sendforge</strong> (Static-First Git Forge)</span>
        <span>Index generated at {index.generated_at}</span>
      </footer>
    </div>
  );
};
