import { useCallback, useEffect, useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import { GitRepositoryClient, type TreeFileItem } from '../engine/fetcher.js';
import type {
  GitBlobObject,
  GitCommitObject,
  GitTreeObject,
  RepoMeta,
} from '../engine/types.js';
import { diffClient } from '../worker/diff-client.js';
import type { FileDiff } from '../worker/diff-types.js';
import { BlobView } from './BlobView.js';
import { CommitLog } from './CommitLog.js';
import { DiffView } from './DiffView.js';
import { FileFinder } from './FileFinder.js';
import { TreeView } from './TreeView.js';

export interface AppProps {
  readonly baseUrl?: string;
}

export const App: FunctionalComponent<AppProps> = ({ baseUrl = '' }) => {
  const [client] = useState(() => new GitRepositoryClient(baseUrl));
  const [meta, setMeta] = useState<RepoMeta | null>(null);
  const [currentRef, setCurrentRef] = useState<string>('main');
  const [activeTab, setActiveTab] = useState<'code' | 'commits' | 'diff'>('code');

  const [currentCommit, setCurrentCommit] = useState<GitCommitObject | null>(null);
  const [currentTree, setCurrentTree] = useState<GitTreeObject | null>(null);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [currentBlob, setCurrentBlob] = useState<GitBlobObject | null>(null);
  const [readmeBlob, setReadmeBlob] = useState<GitBlobObject | null>(null);

  const [commitHistory, setCommitHistory] = useState<readonly GitCommitObject[]>([]);
  const [fileDiffs, setFileDiffs] = useState<readonly FileDiff[]>([]);
  const [allFiles, setAllFiles] = useState<readonly TreeFileItem[]>([]);

  const [isFinderOpen, setIsFinderOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial repository metadata
  useEffect(() => {
    let isMounted = true;
    const initMeta = async () => {
      try {
        setLoading(true);
        const repoMeta = await client.getMeta();
        if (!isMounted) return;
        setMeta(repoMeta);
        setCurrentRef(repoMeta.default_branch || 'main');
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
  }, [client]);

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

  useEffect(() => {
    if (meta && currentRef) {
      void loadRefState(currentRef, currentPath);
    }
  }, [meta, currentRef, loadRefState, currentPath]);

  // Handle commit diff computation
  const loadCommitDiff = useCallback(
    async (commitOid: string) => {
      try {
        setLoading(true);
        setActiveTab('diff');
        const commit = await client.getCommit(commitOid);
        setCurrentCommit(commit);

        const currentTreeObj = await client.getTree(commit.tree);
        const currentFiles = await client.listAllTreeFiles(currentTreeObj.oid);

        let parentFiles: readonly TreeFileItem[] = [];
        if (commit.parents[0]) {
          try {
            const parentCommit = await client.getCommit(commit.parents[0]);
            const parentTreeObj = await client.getTree(parentCommit.tree);
            parentFiles = await client.listAllTreeFiles(parentTreeObj.oid);
          } catch {
            parentFiles = [];
          }
        }

        const parentMap = new Map(parentFiles.map((f) => [f.path, f.entry]));
        const currentMap = new Map(currentFiles.map((f) => [f.path, f.entry]));
        const allPaths = Array.from(new Set([...parentMap.keys(), ...currentMap.keys()])).sort();

        const diffs: FileDiff[] = [];
        for (const filePath of allPaths) {
          const oldEntry = parentMap.get(filePath);
          const newEntry = currentMap.get(filePath);

          if (oldEntry?.oid === newEntry?.oid && oldEntry !== undefined) {
            continue; // Unmodified
          }

          let oldText: string | null = null;
          let newText: string | null = null;
          let isBinary = false;

          if (oldEntry) {
            try {
              const b = await client.getBlob(oldEntry.oid);
              if (b.isBinary) {
                isBinary = true;
              } else {
                oldText = b.text ?? '';
              }
            } catch {
              oldText = null;
            }
          }

          if (newEntry) {
            try {
              const b = await client.getBlob(newEntry.oid);
              if (b.isBinary) {
                isBinary = true;
              } else {
                newText = b.text ?? '';
              }
            } catch {
              newText = null;
            }
          }

          const diff = await diffClient.computeDiff(
            oldEntry ? filePath : null,
            newEntry ? filePath : null,
            oldText,
            newText,
            { isBinary }
          );
          diffs.push(diff);
        }

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

  // Global hotkey handler (Ctrl+K / Cmd+K / T)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFinderOpen]);

  const handleNavigatePath = (newPath: string, isTree: boolean) => {
    setActiveTab('code');
    if (isTree) {
      setCurrentPath(newPath);
      setCurrentBlob(null);
      void loadRefState(currentRef, newPath);
    } else {
      setCurrentPath(newPath);
      void loadRefState(currentRef, newPath);
    }
  };

  const handleSelectFileFromFinder = (path: string) => {
    handleNavigatePath(path, false);
  };

  const pathSegments = currentPath ? currentPath.split('/') : [];

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
                setCurrentPath('');
                setActiveTab('code');
                void loadRefState(currentRef, '');
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

        <nav className="nav-tabs">
          <button
            type="button"
            className={`nav-tab ${activeTab === 'code' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('code');
            }}
          >
            📁 Code
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'commits' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('commits');
            }}
          >
            📜 Commits {meta && <span className="badge">{meta.stats.commit_count}</span>}
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'diff' ? 'active' : ''}`}
            onClick={() => {
              if (currentCommit) {
                void loadCommitDiff(currentCommit.oid);
              } else {
                setActiveTab('diff');
              }
            }}
          >
            ⚡ Diffs
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

        <div className="controls-bar">
          <div className="ref-selector-container">
            <label htmlFor="ref-select" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Branch / Tag:
            </label>
            <select
              id="ref-select"
              className="select-input"
              value={currentRef}
              onChange={(e) => {
                const targetRef = e.currentTarget.value;
                setCurrentRef(targetRef);
                setCurrentPath('');
                void loadRefState(targetRef, '');
              }}
            >
              {meta?.branches.map((b) => (
                <option key={`branch-${b.name}`} value={b.name}>
                  🌿 {b.name} {b.is_default ? '(default)' : ''}
                </option>
              ))}
              {meta?.tags.map((t) => (
                <option key={`tag-${t.name}`} value={t.name}>
                  🏷️ {t.name}
                </option>
              ))}
            </select>
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

        {loading ? (
          <div className="box" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading repository data...
          </div>
        ) : activeTab === 'code' ? (
          currentBlob ? (
            <BlobView
              blob={currentBlob}
              path={currentPath}
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
          <CommitLog
            commits={commitHistory}
            onSelectCommit={(sha) => {
              void loadCommitDiff(sha);
            }}
          />
        ) : (
          <DiffView
            fileDiffs={fileDiffs}
            commit={currentCommit}
            onSelectCommit={(sha) => {
              void loadCommitDiff(sha);
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
