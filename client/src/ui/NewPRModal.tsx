import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { GitRepositoryClient } from '../engine/fetcher.js';
import type { RepoBranch } from '../engine/types.js';
import type { PullRequest } from '../engine/collab-client.js';
import type { CommitSummary } from '../engine/dag.js';
import { findMergeBase, getCommitHistoryRange } from '../engine/dag.js';
import { computeTreeFullDiff } from '../worker/diff-algo.js';
import type { FileDiff } from '../worker/diff-types.js';
import { generateFormatPatchRange, formatSinglePatch } from '../engine/patch.js';
import { formatRelativeTime, formatSha, renderMarkdown } from './utils.js';

export interface NewPRModalProps {
  /** Controls modal visibility */
  readonly isOpen: boolean;
  /** Callback to close the modal */
  readonly onClose: () => void;
  /** Git repository client instance */
  readonly client: GitRepositoryClient;
  /** List of repository branches */
  readonly branches: readonly RepoBranch[];
  /** Repository default branch name */
  readonly defaultBranch?: string | undefined;
  /** Repository name for local storage scoping */
  readonly repoName?: string | undefined;
  /** Existing pull requests list to auto-calculate next PR number */
  readonly existingPulls?: readonly PullRequest[] | undefined;
  /** Optional callback fired when a PR is created or exported */
  readonly onPullCreated?: ((pull: PullRequest) => void) | undefined;
}

export interface PRDraft {
  readonly title: string;
  readonly description: string;
  readonly targetBranch: string;
  readonly sourceBranch: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly customId: string;
  readonly updatedAt: number;
}

function getDraftStorageKey(repoName?: string): string {
  const scope = (repoName?.trim() ? repoName.trim() : 'default');
  return `sendforge:draft:pr:${scope}`;
}

function getLegacyStorageKey(repoName?: string): string {
  const scope = (repoName?.trim() ? repoName.trim() : 'default');
  return `sendforge_pr_draft_${scope}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined') {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return globalThis.localStorage;
    }
  } catch {
    // Storage access restricted (e.g. security sandbox)
  }
  return null;
}

function loadDraftFromStorage(repoName?: string): Partial<PRDraft> | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  const key = getDraftStorageKey(repoName);
  const legacyKey = getLegacyStorageKey(repoName);

  try {
    const raw = storage.getItem(key) ?? storage.getItem(legacyKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
  } catch {
    // Ignore corrupted draft
  }
  return null;
}

function saveDraftToStorage(draft: PRDraft, repoName?: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  const key = getDraftStorageKey(repoName);
  try {
    storage.setItem(key, JSON.stringify(draft));
  } catch {
    // LocalStorage full, ignore
  }
}

function removeDraftFromStorage(repoName?: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  const key = getDraftStorageKey(repoName);
  const legacyKey = getLegacyStorageKey(repoName);
  try {
    storage.removeItem(key);
    storage.removeItem(legacyKey);
  } catch {
    // Ignore
  }
}

export const NewPRModal: FunctionalComponent<NewPRModalProps> = ({
  isOpen,
  onClose,
  client,
  branches,
  defaultBranch = 'main',
  repoName,
  existingPulls = [],
  onPullCreated,
}) => {
  const nextNumber = useMemo(() => {
    let maxNum = 0;
    for (const item of existingPulls) {
      const n = typeof item.number === 'number' && !Number.isNaN(item.number) ? item.number : parseInt(item.id, 10);
      if (!Number.isNaN(n) && n > maxNum) {
        maxNum = n;
      }
    }
    return maxNum + 1;
  }, [existingPulls]);

  // Initial branch setup
  const initialTarget = defaultBranch || (branches[0]?.name ?? 'main');
  const initialSource = branches.find((b) => b.name !== initialTarget)?.name ?? initialTarget;

  const initialDraft = useMemo(() => (isOpen ? loadDraftFromStorage(repoName) : null), [isOpen, repoName]);

  const [targetBranch, setTargetBranch] = useState(() => initialDraft?.targetBranch ?? initialTarget);
  const [sourceBranch, setSourceBranch] = useState(() => initialDraft?.sourceBranch ?? initialSource);

  const [title, setTitle] = useState(() => initialDraft?.title ?? '');
  const [description, setDescription] = useState(() => initialDraft?.description ?? '');
  const [editorTab, setEditorTab] = useState<'write' | 'preview'>('write');
  const [authorName, setAuthorName] = useState(() => initialDraft?.authorName ?? 'Anonymous');
  const [authorEmail, setAuthorEmail] = useState(() => initialDraft?.authorEmail ?? 'anonymous@sendforge.local');
  const [customId, setCustomId] = useState(() => initialDraft?.customId ?? String(nextNumber));

  // Branch comparison calculation states
  const [isComparing, setIsComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [mergeBaseSha, setMergeBaseSha] = useState<string | null>(null);
  const [sourceSha, setSourceSha] = useState<string | null>(null);
  const [targetSha, setTargetSha] = useState<string | null>(null);
  const [commitsInRange, setCommitsInRange] = useState<readonly CommitSummary[]>([]);
  const [fileDiffs, setFileDiffs] = useState<readonly FileDiff[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  const [copiedCommand, setCopiedCommand] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  // Restore draft on open
  useEffect(() => {
    if (!isOpen) return;

    const draft = loadDraftFromStorage(repoName);
    if (draft) {
      if (draft.title !== undefined) setTitle(draft.title);
      if (draft.description !== undefined) setDescription(draft.description);
      if (draft.targetBranch) setTargetBranch(draft.targetBranch);
      if (draft.sourceBranch) setSourceBranch(draft.sourceBranch);
      if (draft.authorName) setAuthorName(draft.authorName);
      if (draft.authorEmail) setAuthorEmail(draft.authorEmail);
      if (draft.customId) setCustomId(draft.customId);
      else setCustomId(String(nextNumber));
    } else {
      setCustomId(String(nextNumber));
      if (branches.length > 0) {
        setTargetBranch(defaultBranch || (branches[0]?.name ?? 'main'));
        const alt = branches.find((b) => b.name !== (defaultBranch || 'main'));
        setSourceBranch(alt?.name ?? branches[0]?.name ?? 'main');
      }
    }

    setValidationError(null);
    setCopiedCommand(false);
    setTimeout(() => {
      titleInputRef.current?.focus();
    }, 50);
  }, [isOpen, repoName, nextNumber, defaultBranch, branches]);

  // Auto-save draft on changes
  useEffect(() => {
    if (!isOpen) return;
    const draft: PRDraft = {
      title,
      description,
      targetBranch,
      sourceBranch,
      authorName,
      authorEmail,
      customId,
      updatedAt: Date.now(),
    };
    saveDraftToStorage(draft, repoName);
  }, [isOpen, title, description, targetBranch, sourceBranch, authorName, authorEmail, customId, repoName]);

  // Compare branches whenever targetBranch or sourceBranch changes
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const isCancelled = (): boolean => cancelled;

    const runBranchComparison = async () => {
      setIsComparing(true);
      setCompareError(null);

      try {
        let tSha: string | null = null;
        let sSha: string | null = null;

        try {
          tSha = await client.resolveRef(targetBranch);
        } catch {
          tSha = targetBranch; // May be direct SHA
        }

        try {
          sSha = await client.resolveRef(sourceBranch);
        } catch {
          sSha = sourceBranch; // May be direct SHA
        }

        if (isCancelled()) return;
        setTargetSha(tSha);
        setSourceSha(sSha);

        if (!tSha || !sSha) {
          setCompareError('Unable to resolve branch references.');
          setCommitsInRange([]);
          setFileDiffs([]);
          setIsComparing(false);
          return;
        }

        if (tSha === sSha) {
          setMergeBaseSha(tSha);
          setCommitsInRange([]);
          setFileDiffs([]);
          setIsComparing(false);
          return;
        }

        const lca = await findMergeBase(client, sSha, tSha);
        if (isCancelled()) return;
        setMergeBaseSha(lca);

        const commits = await getCommitHistoryRange(client, lca, sSha);
        if (isCancelled()) return;
        setCommitsInRange(commits);

        const diffs = await computeTreeFullDiff(client, lca, sSha);
        if (isCancelled()) return;
        setFileDiffs(diffs);

        // Auto-fill title & author if empty and commits found
        if (commits.length > 0) {
          const topCommit = commits[0];
          if (topCommit) {
            setTitle((prev) => (prev.trim() ? prev : topCommit.subject));
            if (topCommit.body.trim()) {
              setDescription((prev) => (prev.trim() ? prev : topCommit.body));
            }
            if (topCommit.author.name) {
              setAuthorName((prev) => (prev === 'Anonymous' || !prev.trim() ? topCommit.author.name : prev));
            }
            if (topCommit.author.email) {
              setAuthorEmail((prev) =>
                prev === 'anonymous@sendforge.local' || !prev.trim() ? topCommit.author.email : prev
              );
            }
          }
        }
      } catch (err) {
        if (isCancelled()) return;
        const msg = err instanceof Error ? err.message : String(err);
        setCompareError(`Comparison failed: ${msg}`);
        setCommitsInRange([]);
        setFileDiffs([]);
      } finally {
        if (!isCancelled()) {
          setIsComparing(false);
        }
      }
    };

    void runBranchComparison();

    return () => {
      cancelled = true;
    };
  }, [isOpen, client, targetBranch, sourceBranch]);

  // Aggregate diff statistics
  const { totalAdditions, totalDeletions, filesChangedCount } = useMemo(() => {
    let adds = 0;
    let dels = 0;
    for (const fd of fileDiffs) {
      adds += fd.additions;
      dels += fd.deletions;
    }
    return {
      totalAdditions: adds,
      totalDeletions: dels,
      filesChangedCount: fileDiffs.length,
    };
  }, [fileDiffs]);

  const cleanId = (customId.trim() || String(nextNumber)).replace(/[^a-zA-Z0-9._-]/g, '_');
  const parsedPRNumber = parseInt(cleanId, 10) || nextNumber;

  // Git push commands
  const cleanSourceBranchName = sourceBranch.replace(/refs\/heads\//, '');
  const gitPushCommand = `git push origin ${cleanSourceBranchName}:refs/pull/${cleanId}/head`;

  const handleCopyCommand = async () => {
    try {
      if (typeof navigator !== 'undefined' && 'clipboard' in navigator) {
        await navigator.clipboard.writeText(gitPushCommand);
      }
      setCopiedCommand(true);
      setTimeout(() => {
        setCopiedCommand(false);
      }, 2000);
    } catch {
      // Fallback
    }
  };

  const handleClearDraft = () => {
    setTitle('');
    setDescription('');
    setAuthorName('Anonymous');
    setAuthorEmail('anonymous@sendforge.local');
    setCustomId(String(nextNumber));
    setValidationError(null);
    removeDraftFromStorage(repoName);
  };

  const handleDownloadPatch = async () => {
    if (!sourceSha) {
      setValidationError('Source branch SHA could not be resolved.');
      return;
    }
    setValidationError(null);

    try {
      let patchText = '';
      if (commitsInRange.length > 0) {
        patchText = await generateFormatPatchRange(client, mergeBaseSha, sourceSha);
      } else {
        // Direct diff patch fallback
        const dummyCommit: CommitSummary = {
          oid: sourceSha,
          subject: title.trim() || 'Pull Request Patch',
          body: description.trim(),
          message: `${title.trim()}\n\n${description.trim()}`,
          author: {
            name: authorName.trim() || 'Anonymous',
            email: authorEmail.trim() || 'anonymous@sendforge.local',
            timestamp: Math.floor(Date.now() / 1000),
            tzOffset: '+0000',
          },
          committer: {
            name: authorName.trim() || 'Anonymous',
            email: authorEmail.trim() || 'anonymous@sendforge.local',
            timestamp: Math.floor(Date.now() / 1000),
            tzOffset: '+0000',
          },
          parents: targetSha ? [targetSha] : [],
          tree: '0000000000000000000000000000000000000000',
        };

        patchText = formatSinglePatch({
          commit: dummyCommit,
          fileDiffs,
          patchIndex: 1,
          totalPatches: 1,
        });
      }

      const slug = (title.trim() || cleanSourceBranchName)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30) || 'patch';

      const filename = `0001-${slug}.patch`;
      const dataBytes = new TextEncoder().encode(patchText);
      const { triggerDownload } = await import('../engine/archive.js');
      triggerDownload(filename, dataBytes, 'text/x-diff');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setValidationError(`Failed to generate patch: ${msg}`);
    }
  };

  const handleDownloadJson = async () => {
    if (!title.trim()) {
      setValidationError('Title is required to export PR JSON.');
      return;
    }
    setValidationError(null);

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      id: cleanId,
      number: parsedPRNumber,
      title: title.trim(),
      description: description.trim(),
      author: {
        name: authorName.trim() || 'Anonymous',
        email: authorEmail.trim() || 'anonymous@sendforge.local',
      },
      target_branch: targetBranch,
      source_branch: sourceBranch,
      head_commit: sourceSha ?? '',
      status: 'open',
      created_at: now,
      updated_at: now,
      labels: [],
      comments: [],
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    const dataBytes = new TextEncoder().encode(jsonStr);
    const { triggerDownload } = await import('../engine/archive.js');
    triggerDownload(`pr-${cleanId}.json`, dataBytes, 'application/json');
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      setValidationError('Title is required.');
      return;
    }
    setValidationError(null);

    const now = Math.floor(Date.now() / 1000);
    const newPR: PullRequest = {
      id: cleanId,
      number: parsedPRNumber,
      title: title.trim(),
      description: description.trim(),
      author: {
        name: authorName.trim() || 'Anonymous',
        email: authorEmail.trim() || 'anonymous@sendforge.local',
      },
      targetBranch,
      sourceBranch,
      headCommit: sourceSha ?? '',
      status: 'open',
      createdAt: now,
      updatedAt: now,
      labels: [],
      comments: [],
    };

    removeDraftFromStorage(repoName);
    onPullCreated?.(newPR);
    onClose();
  };

  const toggleFileExpanded = (path: string) => {
    setExpandedFiles((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!isOpen) {
    return null;
  }

  const isIdentical = targetSha !== null && sourceSha !== null && targetSha === sourceSha;

  return (
    <div
      className="modal-overlay"
      data-testid="new-pr-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div
        className="modal-content new-pr-modal-content"
        data-testid="new-pr-modal"
        style={{ maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>🔀</span>
            <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
              New Pull Request <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>#{cleanId}</span>
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onClose}
            data-testid="close-pr-modal-btn"
            style={{ background: 'transparent', border: 'none', fontSize: '16px', cursor: 'pointer', color: 'var(--text-muted)' }}
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Validation Error Banner */}
        {validationError && (
          <div
            data-testid="pr-validation-error"
            style={{
              backgroundColor: 'rgba(248, 81, 73, 0.15)',
              border: '1px solid rgba(248, 81, 73, 0.4)',
              color: '#f85149',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              fontSize: '13px',
              marginBottom: '16px',
            }}
          >
            ⚠️ {validationError}
          </div>
        )}

        {/* Branch Comparison Selector Bar */}
        <div
          className="box"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            padding: '12px 16px',
            marginBottom: '16px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
          data-testid="pr-branch-compare-bar"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Base:</span>
            <select
              className="select-input"
              style={{ fontSize: '13px', padding: '4px 8px', height: '32px' }}
              value={targetBranch}
              onChange={(e) => {
                setTargetBranch(e.currentTarget.value);
              }}
              data-testid="pr-target-branch-select"
            >
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} {b.is_default ? '(default)' : ''}
                </option>
              ))}
            </select>
          </div>

          <span style={{ color: 'var(--text-muted)', fontSize: '16px' }}>←</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Compare:</span>
            <select
              className="select-input"
              style={{ fontSize: '13px', padding: '4px 8px', height: '32px' }}
              value={sourceBranch}
              onChange={(e) => {
                setSourceBranch(e.currentTarget.value);
              }}
              data-testid="pr-source-branch-select"
            >
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Compare status badge */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            {isComparing ? (
              <span style={{ color: 'var(--accent-hover)' }}>⏳ Calculating diff...</span>
            ) : compareError ? (
              <span style={{ color: '#f85149' }}>⚠️ {compareError}</span>
            ) : isIdentical ? (
              <span style={{ color: 'var(--text-muted)' }}>✓ Branches are identical (0 commits)</span>
            ) : (
              <span style={{ color: '#3fb950', fontWeight: 600 }}>
                ✓ Able to merge ({commitsInRange.length} {commitsInRange.length === 1 ? 'commit' : 'commits'})
              </span>
            )}
          </div>
        </div>

        {/* Diffstat Overview Pill */}
        {!isComparing && !isIdentical && (filesChangedCount > 0 || commitsInRange.length > 0) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              marginBottom: '16px',
            }}
            data-testid="pr-diffstat-pill"
          >
            <span>
              <strong>{commitsInRange.length}</strong> {commitsInRange.length === 1 ? 'commit' : 'commits'}
            </span>
            <span>•</span>
            <span>
              <strong>{filesChangedCount}</strong> {filesChangedCount === 1 ? 'file changed' : 'files changed'}
            </span>
            <span>•</span>
            <span style={{ color: 'var(--diff-add-text)', fontWeight: 600 }}>+{totalAdditions}</span>
            <span style={{ color: 'var(--diff-del-text)', fontWeight: 600 }}>-{totalDeletions}</span>
            {mergeBaseSha && (
              <>
                <span>•</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                  base: {formatSha(mergeBaseSha)}
                </span>
              </>
            )}
          </div>
        )}

        {/* Title Input */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
            Title <span style={{ color: '#f85149' }}>*</span>
          </label>
          <input
            ref={titleInputRef}
            type="text"
            className="finder-input"
            placeholder="Pull request title"
            value={title}
            onInput={(e) => {
              setTitle(e.currentTarget.value);
              if (validationError) setValidationError(null);
            }}
            data-testid="new-pr-title-input"
            maxLength={255}
          />
        </div>

        {/* Description Markdown Editor with Live Preview Tab */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Description
            </label>
            <div className="collab-tabs" style={{ marginBottom: 0 }}>
              <button
                type="button"
                className={`collab-tab ${editorTab === 'write' ? 'active' : ''}`}
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => {
                  setEditorTab('write');
                }}
                data-testid="pr-write-tab"
              >
                Write
              </button>
              <button
                type="button"
                className={`collab-tab ${editorTab === 'preview' ? 'active' : ''}`}
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => {
                  setEditorTab('preview');
                }}
                data-testid="pr-preview-tab"
              >
                Preview
              </button>
            </div>
          </div>

          {editorTab === 'write' ? (
            <textarea
              className="finder-input"
              style={{ minHeight: '120px', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.5' }}
              placeholder="Describe changes in this pull request... Markdown supported."
              value={description}
              onInput={(e) => {
                setDescription(e.currentTarget.value);
              }}
              data-testid="new-pr-description-input"
            />
          ) : (
            <div
              className="box"
              style={{ minHeight: '120px', padding: '12px 16px', backgroundColor: 'var(--bg-primary)', overflowY: 'auto' }}
              data-testid="new-pr-markdown-preview"
              dangerouslySetInnerHTML={{
                __html: description.trim()
                  ? renderMarkdown(description)
                  : '<p style="color: var(--text-muted); font-style: italic;">Nothing to preview</p>',
              }}
            />
          )}
        </div>

        {/* Author Metadata & Custom ID */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: '12px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Author Name
            </label>
            <input
              type="text"
              className="finder-input"
              value={authorName}
              onInput={(e) => {
                setAuthorName(e.currentTarget.value);
              }}
              data-testid="pr-author-name-input"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Author Email
            </label>
            <input
              type="email"
              className="finder-input"
              value={authorEmail}
              onInput={(e) => {
                setAuthorEmail(e.currentTarget.value);
              }}
              data-testid="pr-author-email-input"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              PR ID / #
            </label>
            <input
              type="text"
              className="finder-input"
              value={customId}
              onInput={(e) => {
                setCustomId(e.currentTarget.value);
              }}
              data-testid="pr-custom-id-input"
            />
          </div>
        </div>

        {/* Commits & Changes Preview Accordion */}
        {commitsInRange.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Commits in Range ({commitsInRange.length})
            </div>
            <div className="box" style={{ backgroundColor: 'var(--bg-secondary)', maxHeight: '160px', overflowY: 'auto' }} data-testid="pr-commits-list">
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {commitsInRange.map((c) => (
                  <li
                    key={c.oid}
                    style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid var(--border-color)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-hover)' }}>
                        {formatSha(c.oid)}
                      </span>
                      <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                        {c.subject}
                      </span>
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '11px', flexShrink: 0 }}>
                      {formatRelativeTime(c.author.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Files Changed Preview */}
        {fileDiffs.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Files Changed ({fileDiffs.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }} data-testid="pr-files-diff-list">
              {fileDiffs.map((fd) => {
                const path = fd.newPath ?? fd.oldPath ?? 'unknown';
                const isExpanded = !!expandedFiles[path];

                return (
                  <div key={path} className="diff-file-card" style={{ border: '1px solid var(--border-color)' }}>
                    <div
                      className="diff-file-header"
                      style={{ cursor: 'pointer', padding: '6px 12px' }}
                      onClick={() => {
                        toggleFileExpanded(path);
                      }}
                      data-testid={`toggle-diff-${path}`}
                    >
                      <div className="diff-file-title" style={{ fontSize: '12px' }}>
                        <span className="diff-collapse-toggle">{isExpanded ? '▼' : '▶'}</span>
                        <span>{path}</span>
                        {fd.status === 'added' && <span className="label-badge" style={{ backgroundColor: 'rgba(46, 160, 67, 0.15)', color: '#3fb950', borderColor: '#3fb950' }}>added</span>}
                        {fd.status === 'deleted' && <span className="label-badge" style={{ backgroundColor: 'rgba(248, 81, 73, 0.15)', color: '#f85149', borderColor: '#f85149' }}>deleted</span>}
                      </div>
                      <div className="diff-file-stats" style={{ fontSize: '11px' }}>
                        <span className="diff-add">+{fd.additions}</span>
                        <span className="diff-del">-{fd.deletions}</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-primary)', fontFamily: 'var(--font-mono)', fontSize: '11px', overflowX: 'auto' }}>
                        {fd.isBinary ? (
                          <div style={{ color: 'var(--text-muted)' }}>Binary files differ</div>
                        ) : fd.hunks.length === 0 ? (
                          <div style={{ color: 'var(--text-muted)' }}>No visible text changes</div>
                        ) : (
                          fd.hunks.map((hunk, hIdx) => (
                            <div key={hIdx} style={{ marginBottom: '8px' }}>
                              <div style={{ color: 'var(--accent-hover)', marginBottom: '2px' }}>{hunk.header}</div>
                              {hunk.lines.map((l, lIdx) => (
                                <div
                                  key={lIdx}
                                  style={{
                                    backgroundColor:
                                      l.type === 'add'
                                        ? 'rgba(46, 160, 67, 0.15)'
                                        : l.type === 'delete'
                                        ? 'rgba(248, 81, 73, 0.15)'
                                        : 'transparent',
                                    color:
                                      l.type === 'add'
                                        ? 'var(--diff-add-text)'
                                        : l.type === 'delete'
                                        ? 'var(--diff-del-text)'
                                        : 'var(--text-secondary)',
                                  }}
                                >
                                  {l.type === 'add' ? '+' : l.type === 'delete' ? '-' : ' '}
                                  {l.content}
                                </div>
                              ))}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Git Push Command Generator Card */}
        <div
          className="box"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            padding: '12px 16px',
            marginBottom: '20px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
          }}
          data-testid="pr-push-generator-box"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Git Push Command Generator
            </span>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                void handleCopyCommand();
              }}
              data-testid="copy-pr-command-btn"
            >
              {copiedCommand ? '✓ Copied!' : '📋 Copy Command'}
            </button>
          </div>
          <code
            data-testid="pr-git-push-command"
            style={{
              display: 'block',
              padding: '8px 10px',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--accent-hover)',
              wordBreak: 'break-all',
              userSelect: 'all',
            }}
          >
            {gitPushCommand}
          </code>
        </div>

        {/* Modal Actions Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
          <div>
            <button
              type="button"
              className="btn btn-sm"
              style={{ color: 'var(--text-muted)' }}
              onClick={handleClearDraft}
              data-testid="clear-pr-draft-btn"
            >
              🗑 Clear Draft
            </button>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                void handleDownloadPatch();
              }}
              data-testid="download-patch-btn"
            >
              📥 Download .patch
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                void handleDownloadJson();
              }}
              data-testid="download-pr-json-btn"
            >
              📥 Download JSON
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={onClose}
              data-testid="cancel-pr-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleSubmit}
              data-testid="submit-pr-btn"
            >
              Create Pull Request (Cmd+↵)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
