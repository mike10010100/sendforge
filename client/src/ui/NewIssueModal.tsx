import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { Issue } from '../engine/collab-client.js';
import { renderMarkdown } from './utils.js';

export interface NewIssueModalProps {
  /** Controls modal visibility */
  readonly isOpen: boolean;
  /** Callback to close the modal */
  readonly onClose: () => void;
  /** Repository name for local storage scoping */
  readonly repoName?: string | undefined;
  /** Existing issues list to auto-calculate the next incremental issue number */
  readonly existingIssues?: readonly Issue[] | undefined;
  /** Optional callback fired when an issue is created or exported */
  readonly onIssueCreated?: ((issue: Issue) => void) | undefined;
}

export interface IssueDraft {
  readonly title: string;
  readonly description: string;
  readonly selectedLabels: readonly string[];
  readonly authorName: string;
  readonly authorEmail: string;
  readonly customId: string;
  readonly updatedAt: number;
}

const PRESET_LABELS: readonly string[] = [
  'bug',
  'enhancement',
  'documentation',
  'duplicate',
  'good first issue',
  'help wanted',
  'invalid',
  'question',
  'wontfix',
  'security',
  'performance',
];

function getDraftStorageKey(repoName?: string): string {
  const scope = (repoName?.trim() ? repoName.trim() : 'default');
  return `sendforge:draft:issue:${scope}`;
}

function getLegacyStorageKey(repoName?: string): string {
  const scope = (repoName?.trim() ? repoName.trim() : 'default');
  return `sendforge_issue_draft_${scope}`;
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

function loadDraftFromStorage(repoName?: string): Partial<IssueDraft> | null {
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
    // Corrupted draft, ignore gracefully
  }
  return null;
}

function saveDraftToStorage(draft: IssueDraft, repoName?: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  const key = getDraftStorageKey(repoName);
  try {
    storage.setItem(key, JSON.stringify(draft));
  } catch {
    // LocalStorage full or blocked, ignore gracefully
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

export const NewIssueModal: FunctionalComponent<NewIssueModalProps> = ({
  isOpen,
  onClose,
  repoName,
  existingIssues = [],
  onIssueCreated,
}) => {
  const nextNumber = useMemo(() => {
    let maxNum = 0;
    for (const item of existingIssues) {
      const n = typeof item.number === 'number' && !Number.isNaN(item.number) ? item.number : parseInt(item.id, 10);
      if (!Number.isNaN(n) && n > maxNum) {
        maxNum = n;
      }
    }
    return maxNum + 1;
  }, [existingIssues]);

  const initialDraft = useMemo(() => (isOpen ? loadDraftFromStorage(repoName) : null), [isOpen, repoName]);

  const [title, setTitle] = useState(() => initialDraft?.title ?? '');
  const [description, setDescription] = useState(() => initialDraft?.description ?? '');
  const [editorTab, setEditorTab] = useState<'write' | 'preview'>('write');
  const [selectedLabels, setSelectedLabels] = useState<string[]>(() =>
    Array.isArray(initialDraft?.selectedLabels)
      ? initialDraft.selectedLabels.filter((l): l is string => typeof l === 'string')
      : []
  );
  const [customLabelInput, setCustomLabelInput] = useState('');
  const [authorName, setAuthorName] = useState(() => initialDraft?.authorName ?? 'Anonymous');
  const [authorEmail, setAuthorEmail] = useState(() => initialDraft?.authorEmail ?? 'anonymous@sendforge.local');
  const [customId, setCustomId] = useState(() => initialDraft?.customId ?? String(nextNumber));

  const [copiedCommand, setCopiedCommand] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  // Restore draft or initialize on open
  useEffect(() => {
    if (!isOpen) return;

    const draft = loadDraftFromStorage(repoName);
    if (draft) {
      setTitle(draft.title ?? '');
      setDescription(draft.description ?? '');
      if (Array.isArray(draft.selectedLabels)) {
        setSelectedLabels(draft.selectedLabels.filter((l): l is string => typeof l === 'string'));
      }
      if (draft.authorName) setAuthorName(draft.authorName);
      if (draft.authorEmail) setAuthorEmail(draft.authorEmail);
      if (draft.customId) setCustomId(draft.customId);
      else setCustomId(String(nextNumber));
    } else {
      setCustomId(String(nextNumber));
    }

    setValidationError(null);
    setCopiedCommand(false);
    setTimeout(() => {
      titleInputRef.current?.focus();
    }, 50);
  }, [isOpen, repoName, nextNumber]);

  // Auto-save draft on changes
  useEffect(() => {
    if (!isOpen) return;
    const draft: IssueDraft = {
      title,
      description,
      selectedLabels,
      authorName,
      authorEmail,
      customId,
      updatedAt: Date.now(),
    };
    saveDraftToStorage(draft, repoName);
  }, [isOpen, title, description, selectedLabels, authorName, authorEmail, customId, repoName]);

  // Clean issue ID
  const cleanId = (customId.trim() || String(nextNumber)).replace(/[^a-zA-Z0-9._-]/g, '_');
  const parsedIssueNumber = parseInt(cleanId, 10) || nextNumber;

  // Generated Git commands
  const gitPushCommand = `git push origin HEAD:refs/issues/${cleanId}`;
  const commitTitle = title.replace(/"/g, '\\"') || 'Issue title';
  const commitDesc = description.replace(/"/g, '\\"');
  const gitCommitHelperCommand = `git commit --allow-empty -m "${commitTitle}" -m "${commitDesc}" && ${gitPushCommand}`;

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

  const handleToggleLabel = (label: string) => {
    setSelectedLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  const handleAddCustomLabel = () => {
    const trimmed = customLabelInput.trim();
    if (trimmed && !selectedLabels.includes(trimmed)) {
      setSelectedLabels((prev) => [...prev, trimmed]);
      setCustomLabelInput('');
    }
  };

  const handleClearDraft = () => {
    setTitle('');
    setDescription('');
    setSelectedLabels([]);
    setAuthorName('Anonymous');
    setAuthorEmail('anonymous@sendforge.local');
    setCustomId(String(nextNumber));
    setValidationError(null);
    removeDraftFromStorage(repoName);
  };

  const handleDownloadJson = async () => {
    if (!title.trim()) {
      setValidationError('Title is required to export issue JSON.');
      return;
    }
    setValidationError(null);

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      id: cleanId,
      number: parsedIssueNumber,
      title: title.trim(),
      description: description.trim(),
      author: {
        name: authorName.trim() || 'Anonymous',
        email: authorEmail.trim() || 'anonymous@sendforge.local',
      },
      status: 'open',
      created_at: now,
      updated_at: now,
      labels: selectedLabels,
      comments: [],
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    const dataBytes = new TextEncoder().encode(jsonStr);
    const { triggerDownload } = await import('../engine/archive.js');
    triggerDownload(`issue-${cleanId}.json`, dataBytes, 'application/json');
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      setValidationError('Title is required.');
      return;
    }
    setValidationError(null);

    const now = Math.floor(Date.now() / 1000);
    const newIssue: Issue = {
      id: cleanId,
      number: parsedIssueNumber,
      title: title.trim(),
      description: description.trim(),
      author: {
        name: authorName.trim() || 'Anonymous',
        email: authorEmail.trim() || 'anonymous@sendforge.local',
      },
      status: 'open',
      createdAt: now,
      updatedAt: now,
      labels: selectedLabels,
      comments: [],
    };

    removeDraftFromStorage(repoName);
    onIssueCreated?.(newIssue);
    onClose();
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

  return (
    <div
      className="modal-overlay"
      data-testid="new-issue-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div
        className="modal-content new-issue-modal-content"
        data-testid="new-issue-modal"
        style={{ maxWidth: '780px', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>🎯</span>
            <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
              New Issue <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>#{cleanId}</span>
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onClose}
            data-testid="close-issue-modal-btn"
            style={{ background: 'transparent', border: 'none', fontSize: '16px', cursor: 'pointer', color: 'var(--text-muted)' }}
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Validation Error Banner */}
        {validationError && (
          <div
            data-testid="issue-validation-error"
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

        {/* Title Input */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
            Title <span style={{ color: '#f85149' }}>*</span>
          </label>
          <input
            ref={titleInputRef}
            type="text"
            className="finder-input"
            placeholder="Issue title (e.g. Blame view throws on zero author timestamp)"
            value={title}
            onInput={(e) => {
              setTitle(e.currentTarget.value);
              if (validationError) setValidationError(null);
            }}
            data-testid="new-issue-title-input"
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
                data-testid="issue-write-tab"
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
                data-testid="issue-preview-tab"
              >
                Preview
              </button>
            </div>
          </div>

          {editorTab === 'write' ? (
            <textarea
              className="finder-input"
              style={{ minHeight: '140px', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.5' }}
              placeholder="Describe the issue... Markdown formatting supported."
              value={description}
              onInput={(e) => {
                setDescription(e.currentTarget.value);
              }}
              data-testid="new-issue-description-input"
            />
          ) : (
            <div
              className="box"
              style={{ minHeight: '140px', padding: '12px 16px', backgroundColor: 'var(--bg-primary)', overflowY: 'auto' }}
              data-testid="new-issue-markdown-preview"
              dangerouslySetInnerHTML={{
                __html: description.trim()
                  ? renderMarkdown(description)
                  : '<p style="color: var(--text-muted); font-style: italic;">Nothing to preview</p>',
              }}
            />
          )}
        </div>

        {/* Labels Selection Bar */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
            Labels
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }} data-testid="issue-label-presets">
            {PRESET_LABELS.map((label) => {
              const isSelected = selectedLabels.includes(label);
              return (
                <button
                  key={label}
                  type="button"
                  className={`label-chip ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    handleToggleLabel(label);
                  }}
                  data-testid={`issue-preset-label-${label}`}
                >
                  {label}
                  {isSelected && <span className="label-chip-remove">✕</span>}
                </button>
              );
            })}
          </div>

          {/* Custom Label Input */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              className="finder-input"
              style={{ maxWidth: '200px', fontSize: '12px', padding: '4px 8px' }}
              placeholder="Custom label..."
              value={customLabelInput}
              onInput={(e) => {
                setCustomLabelInput(e.currentTarget.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCustomLabel();
                }
              }}
              data-testid="issue-custom-label-input"
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleAddCustomLabel}
              data-testid="add-custom-label-btn"
            >
              Add Label
            </button>
          </div>
        </div>

        {/* Author Metadata & Custom ID */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: '12px', marginBottom: '20px' }}>
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
              data-testid="issue-author-name-input"
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
              data-testid="issue-author-email-input"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Issue ID / #
            </label>
            <input
              type="text"
              className="finder-input"
              value={customId}
              onInput={(e) => {
                setCustomId(e.currentTarget.value);
              }}
              data-testid="issue-custom-id-input"
            />
          </div>
        </div>

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
          data-testid="issue-push-generator-box"
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
              data-testid="copy-issue-command-btn"
            >
              {copiedCommand ? '✓ Copied!' : '📋 Copy Command'}
            </button>
          </div>
          <code
            data-testid="issue-git-push-command"
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
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
            Or create empty commit: <code style={{ color: 'var(--text-secondary)' }}>{gitCommitHelperCommand}</code>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
          <div>
            <button
              type="button"
              className="btn btn-sm"
              style={{ color: 'var(--text-muted)' }}
              onClick={handleClearDraft}
              data-testid="clear-issue-draft-btn"
            >
              🗑 Clear Draft
            </button>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                void handleDownloadJson();
              }}
              data-testid="download-issue-json-btn"
            >
              📥 Download JSON
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={onClose}
              data-testid="cancel-issue-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleSubmit}
              data-testid="submit-issue-btn"
            >
              Create Issue (Cmd+↵)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
