import { useCallback, useEffect, useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import { GitRepositoryClient, type TreeFileItem } from '../engine/fetcher.js';
import { CollabClient, type Issue, type PullRequest } from '../engine/collab-client.js';
import type {
  GitBlobObject,
  GitCommitObject,
  GitTreeObject,
  RepoMeta,
  RepoStats,
} from '../engine/types.js';
import { computeTreeFullDiff } from '../worker/diff-algo.js';
import type { FileDiff } from '../worker/diff-types.js';
import { BlobView } from './BlobView.js';
import { CommitLog } from './CommitLog.js';
import { DiffView } from './DiffView.js';
import { FileFinder } from './FileFinder.js';
import { RefSelector } from './RefSelector.js';
import { TreeView } from './TreeView.js';
import { IssuesView } from './IssuesView.js';
import { IssueDetailView } from './IssueDetailView.js';
import { PullRequestsView } from './PullRequestsView.js';
import { PRDetailView } from './PRDetailView.js';
import { parseRoute, type Route } from './router.js';
import { useEventListener, useStableCallback } from './hooks/useLifecycle.js';

export interface AppProps {
  readonly baseUrl?: string;
}

export const App: FunctionalComponent<AppProps> = ({ baseUrl = '' }) => {
  const [client] = useState(() => new GitRepositoryClient(baseUrl));
  const [collabClient] = useState(() => new CollabClient(baseUrl));
  const [meta, setMeta] = useState<RepoMeta | null>(null);

  const [currentRef, setCurrentRef] = useState<string>('main');
  const [activeTab, setActiveTab] = useState<'code' | 'commits' | 'issues' | 'pulls'>('code');
  const [selectedCommitDiff, setSelectedCommitDiff] = useState<string | null>(null);

  // Collaboration state
  const [pulls, setPulls] = useState<readonly PullRequest[]>([]);
  const [issues, setIssues] = useState<readonly Issue[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedPullId, setSelectedPullId] = useState<string | null>(null);
  const [pullDetailTab, setPullDetailTab] = useState<'conversation' | 'commits' | 'files'>('conversation');

  const [currentCommit, setCurrentCommit] = useState<GitCommitObject | null>(null);
  const [currentTree, setCurrentTree] = useState<GitTreeObject | null>(null);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [currentBlob, setCurrentBlob] = useState<GitBlobObject | null>(null);
  const [readmeBlob, setReadmeBlob] = useState<GitBlobObject | null>(null);

  const [commitHistory, setCommitHistory] = useState<readonly GitCommitObject[]>([]);
  const [fileDiffs, setFileDiffs] = useState<readonly FileDiff[]>([]);
  const [allFiles, setAllFiles] = useState<readonly TreeFileItem[]>([]);

  const [isFinderOpen, setIsFinderOpen] = useState(false);
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<'zip' | 'tar.gz' | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ completed: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load ref state when currentRef changes
  const loadRefState = useCallback(
    async (refName: string, path = '') => {
      try {
        setLoading(true);
        setError(null);

        const commitOid = await client.resolveRef(refName);
        const commit = await client.getCommit(commitOid);
        setCurrentCommit(commit);

        // Fetch tree or target file
        const rootTree = await client.getTree(commit.tree);

        // Index all files for FileFinder
        void client.listAllTreeFiles(commit.tree).then((files) => {
          setAllFiles(files);
        });

        if (path) {
          const entry = await client.resolvePathToEntry(commit.tree, path);
          if (!entry) {
            setError(`Path '${path}' not found at revision ${refName}`);
            setCurrentPath('');
            setCurrentTree(rootTree);
            setCurrentBlob(null);
          } else if (entry.isTree) {
            const subtree = await client.getTree(entry.oid);
            setCurrentTree(subtree);
            setCurrentPath(path);
            setCurrentBlob(null);
          } else {
            const blob = await client.getBlob(entry.oid);
            setCurrentBlob(blob);
            setCurrentPath(path);
          }
        } else {
          setCurrentTree(rootTree);
          setCurrentPath('');
          setCurrentBlob(null);

          // Find README in root tree if any
          const readmeEntry = rootTree.entries.find(
            (e) =>
              !e.isTree &&
              (e.name.toLowerCase() === 'readme.md' || e.name.toLowerCase() === 'readme')
          );
          if (readmeEntry) {
            try {
              const rBlob = await client.getBlob(readmeEntry.oid);
              setReadmeBlob(rBlob);
            } catch {
              setReadmeBlob(null);
            }
          } else {
            setReadmeBlob(null);
          }
        }

        // Fetch commit history
        void client.getCommitHistory(commitOid, 30).then((history) => {
          setCommitHistory(history);
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to load ref '${refName}': ${msg}`);
      } finally {
        setLoading(false);
      }
    },
    [client]
  );

  // Handle commit diff computation
  const loadCommitDiff = useCallback(
    async (commitOid: string) => {
      try {
        setLoading(true);
        setActiveTab('commits');
        setSelectedCommitDiff(commitOid);
        const commit = await client.getCommit(commitOid);
        setCurrentCommit(commit);

        const parentSha = commit.parents[0] ?? null;
        const diffs = await computeTreeFullDiff(client, parentSha, commitOid);
        setFileDiffs(diffs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to compute commit diff: ${msg}`);
      } finally {
        setLoading(false);
      }
    },
    [client]
  );

  // Hash Route Synchronizer
  const handleRouteChange = useCallback(
    (hash: string) => {
      const route: Route = parseRoute(hash);

      switch (route.type) {
        case 'code':
          setActiveTab('code');
          setSelectedIssueId(null);
          setSelectedPullId(null);
          setSelectedCommitDiff(null);
          if (route.ref && route.ref !== currentRef) {
            setCurrentRef(route.ref);
          }
          if (route.path !== undefined && route.path !== currentPath) {
            setCurrentPath(route.path);
            if (meta && (route.ref ?? currentRef)) {
              void loadRefState(route.ref ?? currentRef, route.path);
            }
          } else if (route.path === undefined && currentPath !== '') {
            setCurrentPath('');
            if (meta && (route.ref ?? currentRef)) {
              void loadRefState(route.ref ?? currentRef, '');
            }
          }
          break;

        case 'commits':
          setActiveTab('commits');
          setSelectedIssueId(null);
          setSelectedPullId(null);
          setSelectedCommitDiff(null);
          if (route.ref && route.ref !== currentRef) {
            setCurrentRef(route.ref);
          }
          break;

        case 'commit':
          setActiveTab('commits');
          setSelectedIssueId(null);
          setSelectedPullId(null);
          if (selectedCommitDiff !== route.sha) {
            void loadCommitDiff(route.sha);
          }
          break;

        case 'issues':
          setActiveTab('issues');
          setSelectedIssueId(null);
          setSelectedPullId(null);
          setSelectedCommitDiff(null);
          break;

        case 'issue':
          setActiveTab('issues');
          setSelectedIssueId(route.id);
          setSelectedPullId(null);
          setSelectedCommitDiff(null);
          break;

        case 'pulls':
          setActiveTab('pulls');
          setSelectedPullId(null);
          setSelectedIssueId(null);
          setSelectedCommitDiff(null);
          break;

        case 'pull':
          setActiveTab('pulls');
          setSelectedPullId(route.id);
          setPullDetailTab(route.tab ?? 'conversation');
          setSelectedIssueId(null);
          setSelectedCommitDiff(null);
          break;
      }
    },
    [currentPath, currentRef, meta, selectedCommitDiff, loadCommitDiff, loadRefState]
  );

  // Load initial repository metadata & collaboration catalogs
  useEffect(() => {
    let isMounted = true;
    const initMeta = async () => {
      try {
        setLoading(true);
        const [repoMeta, loadedPulls, loadedIssues] = await Promise.all([
          client.getMeta(),
          collabClient.getPullRequests().catch(() => []),
          collabClient.getIssues().catch(() => []),
        ]);

        if (!isMounted) return;
        setMeta(repoMeta);
        setPulls(loadedPulls);
        setIssues(loadedIssues);
        const defaultRef = repoMeta.default_branch || 'main';
        setCurrentRef(defaultRef);

        if (repoMeta.name) {
          const title = repoMeta.description
            ? `${repoMeta.name} — ${repoMeta.description}`
            : `${repoMeta.name} — Sendforge`;
          document.title = title;
          const ogTitleEl = document.querySelector('meta[property="og:title"]');
          if (ogTitleEl) ogTitleEl.setAttribute('content', title);
          const twTitleEl = document.querySelector('meta[name="twitter:title"]');
          if (twTitleEl) twTitleEl.setAttribute('content', title);
          if (repoMeta.description) {
            const ogDescEl = document.querySelector('meta[property="og:description"]');
            if (ogDescEl) ogDescEl.setAttribute('content', repoMeta.description);
            const twDescEl = document.querySelector('meta[name="twitter:description"]');
            if (twDescEl) twDescEl.setAttribute('content', repoMeta.description);
          }
        }

        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        if (hash) {
          handleRouteChange(hash);
        } else {
          void loadRefState(defaultRef, '');
        }
      } catch (err) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to load repository metadata: ${msg}`);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void initMeta();
    return () => {
      isMounted = false;
    };
  }, [client, collabClient, handleRouteChange, loadRefState]);

  const handleHashChange = useStableCallback(() => {
    if (typeof window !== 'undefined') {
      handleRouteChange(window.location.hash);
    }
  });

  // Listen to window hashchange
  useEventListener(typeof window !== 'undefined' ? window : null, 'hashchange', handleHashChange);

  // Global hotkey handler (Ctrl+K / Cmd+K / T)
  useEventListener(typeof window !== 'undefined' ? window : null, 'keydown', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setIsFinderOpen((prev) => !prev);
    } else if (
      e.key.toLowerCase() === 't' &&
      !isFinderOpen &&
      !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault();
      setIsFinderOpen(true);
    }
  });

  // Snapshot download dropdown dismissal on click-outside
  useEventListener(isDownloadOpen && typeof document !== 'undefined' ? document : null, 'mousedown', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.download-dropdown-container')) {
      setIsDownloadOpen(false);
    }
  });

  // Snapshot download dropdown dismissal on Escape
  useEventListener(isDownloadOpen && typeof document !== 'undefined' ? document : null, 'keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsDownloadOpen(false);
    }
  });

  const handleDownloadSnapshot = async (format: 'zip' | 'tar.gz') => {
    if (!currentCommit || downloadingFormat !== null) return;
    setIsDownloadOpen(false);
    setDownloadingFormat(format);
    setDownloadProgress({ completed: 0, total: 0 });

    try {
      const { exportRepositorySnapshot, triggerDownload } = await import('../engine/archive.js');
      const repoName = meta?.name ?? 'repo';
      const sanitizedRef = currentRef.replace(/\//g, '-');
      const prefix = `${repoName}-${sanitizedRef}`;
      const filename = `${prefix}.${format === 'zip' ? 'zip' : 'tar.gz'}`;
      const mimeType = format === 'zip' ? 'application/zip' : 'application/gzip';

      const archiveData = await exportRepositorySnapshot(
        client,
        currentCommit.tree,
        prefix,
        format,
        (completed, total) => {
          setDownloadProgress({ completed, total });
        }
      );

      triggerDownload(filename, archiveData, mimeType);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to generate ${format.toUpperCase()} archive: ${msg}`);
    } finally {
      setDownloadingFormat(null);
      setDownloadProgress(null);
    }
  };

  const handleNavigatePath = (newPath: string, isTree: boolean) => {
    setActiveTab('code');
    setSelectedIssueId(null);
    setSelectedPullId(null);
    setSelectedCommitDiff(null);

    const hash = isTree
      ? newPath
        ? `#/tree/${newPath}`
        : '#/'
      : `#/blob/${newPath}`;
    window.location.hash = hash;
  };

  const handleSelectFileFromFinder = (path: string) => {
    handleNavigatePath(path, false);
  };

  const pathSegments = currentPath ? currentPath.split('/') : [];

  // Active Issue and PR objects
  const activeIssue = selectedIssueId
    ? issues.find((i) => i.id === selectedIssueId || String(i.number) === selectedIssueId) ?? null
    : null;

  const activePull = selectedPullId
    ? pulls.find((p) => p.id === selectedPullId || String(p.number) === selectedPullId) ?? null
    : null;

  // Counts for top navbar badges
  const extendedStats = meta?.stats as (RepoStats & {
    readonly open_issue_count?: number | undefined;
    readonly open_pull_count?: number | undefined;
  }) | undefined;

  const openIssuesCount =
    extendedStats?.open_issue_count ?? issues.filter((i) => i.status === 'open').length;
  const openPullsCount =
    extendedStats?.open_pull_count ?? pulls.filter((p) => p.status === 'open').length;
  const commitsCount = meta?.stats.commit_count ?? commitHistory.length;

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-top">
          <div className="repo-brand">
            <span className="repo-icon">📦</span>
            <a
              href="#/"
              onClick={(e) => {
                e.preventDefault();
                window.location.hash = '#/';
              }}
            >
              {meta?.name ?? 'Sendforge'}
            </a>
            {meta?.description && (
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 'normal' }}>
                — {meta.description}
              </span>
            )}
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setIsFinderOpen(true);
              }}
              title="Search files (Ctrl+K / T)"
            >
              🔍 Find file <span className="badge">Ctrl+K</span>
            </button>
          </div>
        </div>

        {/* 4-Tab Top Navigation Bar */}
        <nav className="nav-tabs" aria-label="Main repository navigation">
          <button
            type="button"
            className={`nav-tab ${activeTab === 'code' ? 'active' : ''}`}
            onClick={() => {
              window.location.hash = '#/';
            }}
            data-testid="nav-tab-code"
          >
            📁 Code
          </button>

          <button
            type="button"
            className={`nav-tab ${activeTab === 'commits' ? 'active' : ''}`}
            onClick={() => {
              window.location.hash = '#/commits';
            }}
            data-testid="nav-tab-commits"
          >
            📜 Commits{' '}
            <span className="badge" data-testid="commits-count-badge">
              {commitsCount}
            </span>
          </button>

          <button
            type="button"
            className={`nav-tab ${activeTab === 'issues' ? 'active' : ''}`}
            onClick={() => {
              window.location.hash = '#/issues';
            }}
            data-testid="nav-tab-issues"
          >
            🎯 Issues{' '}
            <span className="badge" data-testid="issues-count-badge">
              {openIssuesCount}
            </span>
          </button>

          <button
            type="button"
            className={`nav-tab ${activeTab === 'pulls' ? 'active' : ''}`}
            onClick={() => {
              window.location.hash = '#/pulls';
            }}
            data-testid="nav-tab-pulls"
          >
            🔀 Pull Requests{' '}
            <span className="badge" data-testid="pulls-count-badge">
              {openPullsCount}
            </span>
          </button>
        </nav>
      </header>

      <main className="main-content">
        {error && (
          <div
            className="box"
            style={{
              padding: '16px',
              backgroundColor: 'var(--diff-del-bg)',
              borderColor: 'var(--diff-del-text)',
              marginBottom: '16px',
            }}
          >
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Sub-controls Bar visible in Code View */}
        {activeTab === 'code' && (
          <div className="controls-bar">
            <div className="ref-selector-container">
              <RefSelector
                currentRef={currentRef}
                branches={meta?.branches ?? []}
                tags={meta?.tags ?? []}
                defaultBranch={meta?.default_branch ?? 'main'}
                onSelectRef={(targetRef) => {
                  if (targetRef === currentRef) return;
                  setCurrentRef(targetRef);
                  setCurrentPath('');
                  void loadRefState(targetRef, '');
                }}
              />

              <div className="download-dropdown-container">
                <button
                  type="button"
                  className={`btn download-btn ${isDownloadOpen ? 'active' : ''}`}
                  onClick={() => {
                    setIsDownloadOpen((prev) => !prev);
                  }}
                  disabled={downloadingFormat !== null || !currentCommit}
                  title="Download repository snapshot archive"
                  data-testid="download-snapshot-btn"
                >
                  {downloadingFormat ? (
                    <>
                      <span className="download-spinner" />
                      <span>
                        {downloadProgress && downloadProgress.total > 0
                          ? `Archiving (${downloadProgress.completed}/${downloadProgress.total})...`
                          : `Generating ${downloadingFormat.toUpperCase()}...`}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>⬇️ Code / Download</span>
                      <span className="dropdown-arrow">▾</span>
                    </>
                  )}
                </button>

                {isDownloadOpen && (
                  <div className="download-dropdown-menu" role="menu">
                    <div className="download-dropdown-header">Clone or download snapshot</div>
                    <button
                      type="button"
                      className="download-dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        void handleDownloadSnapshot('zip');
                      }}
                      data-testid="download-zip-btn"
                    >
                      <span className="download-format-icon">📦</span>
                      <div className="download-format-details">
                        <span className="download-format-title">Download ZIP (.zip)</span>
                        <span className="download-format-desc">Standard PKWARE zip compressed archive</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="download-dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        void handleDownloadSnapshot('tar.gz');
                      }}
                      data-testid="download-targz-btn"
                    >
                      <span className="download-format-icon">🗜️</span>
                      <div className="download-format-details">
                        <span className="download-format-title">Download TAR.GZ (.tar.gz)</span>
                        <span className="download-format-desc">POSIX ustar gzipped tarball archive</span>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="breadcrumbs">
              <a
                href="#/"
                onClick={(e) => {
                  e.preventDefault();
                  setCurrentPath('');
                  setCurrentBlob(null);
                  void loadRefState(currentRef, '');
                }}
              >
                {meta?.name ?? 'repo'}
              </a>
              {pathSegments.map((segment, idx) => {
                const subPath = pathSegments.slice(0, idx + 1).join('/');
                const isLast = idx === pathSegments.length - 1;
                return (
                  <span key={subPath} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <span className="breadcrumb-separator">/</span>
                    {isLast ? (
                      <span style={{ color: 'var(--text-primary)' }}>{segment}</span>
                    ) : (
                      <a
                        href={`#/tree/${subPath}`}
                        onClick={(e) => {
                          e.preventDefault();
                          handleNavigatePath(subPath, true);
                        }}
                      >
                        {segment}
                      </a>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* View Switching */}
        {loading ? (
          <div className="box" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading repository data...
          </div>
        ) : activeTab === 'code' ? (
          currentBlob ? (
            <BlobView
              blob={currentBlob}
              path={currentPath}
              client={client}
              commitOid={currentCommit?.oid ?? currentRef}
              onSelectCommit={(sha) => {
                void loadCommitDiff(sha);
              }}
              onBack={() => {
                const parentPath = pathSegments.slice(0, -1).join('/');
                handleNavigatePath(parentPath, true);
              }}
            />
          ) : currentTree ? (
            <TreeView
              entries={currentTree.entries}
              currentPath={currentPath}
              onNavigate={handleNavigatePath}
              readmeBlob={readmeBlob}
            />
          ) : null
        ) : activeTab === 'commits' ? (
          selectedCommitDiff ? (
            <DiffView
              fileDiffs={fileDiffs}
              commit={currentCommit}
              onSelectCommit={(sha) => {
                void loadCommitDiff(sha);
              }}
              onBack={() => {
                setSelectedCommitDiff(null);
                window.location.hash = '#/commits';
              }}
            />
          ) : (
            <CommitLog
              commits={commitHistory}
              onSelectCommit={(sha) => {
                window.location.hash = `#/commit/${sha}`;
              }}
            />
          )
        ) : activeTab === 'issues' ? (
          selectedIssueId && activeIssue ? (
            <IssueDetailView
              issue={activeIssue}
              onBack={() => {
                window.location.hash = '#/issues';
              }}
            />
          ) : (
            <IssuesView
              issues={issues}
              onSelectIssue={(id) => {
                window.location.hash = `#/issues/${id}`;
              }}
            />
          )
        ) : selectedPullId && activePull ? (
          <PRDetailView
            pr={activePull}
            client={client}
            activeTab={pullDetailTab}
            onTabChange={(tab) => {
              setPullDetailTab(tab);
              window.location.hash =
                tab === 'conversation'
                  ? `#/pulls/${activePull.id}`
                  : `#/pulls/${activePull.id}/${tab}`;
            }}
            onBack={() => {
              window.location.hash = '#/pulls';
            }}
            onSelectCommit={(sha) => {
              window.location.hash = `#/commit/${sha}`;
            }}
          />
        ) : (
          <PullRequestsView
            pulls={pulls}
            onSelectPull={(id) => {
              window.location.hash = `#/pulls/${id}`;
            }}
          />
        )}
      </main>

      <FileFinder
        files={allFiles}
        isOpen={isFinderOpen}
        onClose={() => {
          setIsFinderOpen(false);
        }}
        onSelectFile={handleSelectFileFromFinder}
      />
    </div>
  );
};
