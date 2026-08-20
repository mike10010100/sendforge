import { useEffect, useRef, useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { RepoBranch, RepoTag } from '../engine/types.js';
import { formatSha } from './utils.js';
import { useEventListener } from './hooks/useLifecycle.js';

export { formatSha };

export interface RefSelectorProps {
  /** The currently active reference name (e.g. "main", "v1.0.0"). */
  readonly currentRef: string;
  /** List of branches available in the repository metadata. */
  readonly branches: readonly RepoBranch[];
  /** List of tags available in the repository metadata. */
  readonly tags: readonly RepoTag[];
  /** Callback fired when the user selects a branch or tag. */
  readonly onSelectRef: (refName: string) => void;
  /** The name of the default branch (e.g. "main"). */
  readonly defaultBranch?: string | undefined;
  /** Optional initial open state (for SSR rendering / test convenience). */
  readonly initialOpen?: boolean | undefined;
  /** Optional initial active tab (for SSR rendering / test convenience). */
  readonly initialTab?: 'branches' | 'tags' | undefined;
  /** Optional initial search query (for SSR rendering / test convenience). */
  readonly initialQuery?: string | undefined;
}

export type TabType = 'branches' | 'tags';

/**
 * Pure helper function to filter branches or tags by name substring or target/peeled commit SHA.
 */
export function filterRefs<T extends { name: string; target: string; peeled?: string | null | undefined }>(
  items: readonly T[],
  query: string
): readonly T[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return items;
  }

  return items.filter((item) => {
    const lowerName = item.name.toLowerCase();
    if (lowerName.includes(trimmed)) {
      return true;
    }

    const lowerTarget = item.target.toLowerCase();
    if (lowerTarget.startsWith(trimmed) || lowerTarget.includes(trimmed)) {
      return true;
    }

    if (item.peeled) {
      const lowerPeeled = item.peeled.toLowerCase();
      if (lowerPeeled.startsWith(trimmed) || lowerPeeled.includes(trimmed)) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Pure helper to determine if a branch is the default branch based on is_default flag or defaultBranch string.
 */
export function isDefaultBranch(branch: RepoBranch, defaultBranch?: string): boolean {
  if (branch.is_default) {
    return true;
  }
  if (defaultBranch !== undefined && defaultBranch !== '' && branch.name === defaultBranch) {
    return true;
  }
  return false;
}

export const RefSelector: FunctionalComponent<RefSelectorProps> = ({
  currentRef,
  branches,
  tags,
  onSelectRef,
  defaultBranch = 'main',
  initialOpen = false,
  initialTab,
  initialQuery = '',
}) => {
  const isCurrentRefTag = tags.some((t) => t.name === currentRef);
  const isCurrentRefBranch = branches.some((b) => b.name === currentRef);

  const [isOpen, setIsOpen] = useState(initialOpen);
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    if (initialTab) return initialTab;
    return isCurrentRefTag ? 'tags' : 'branches';
  });
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const filteredBranches = filterRefs(branches, searchQuery);
  const filteredTags = filterRefs(tags, searchQuery);
  const currentList = activeTab === 'branches' ? filteredBranches : filteredTags;

  // Sync tab and reset search when opening
  useEffect(() => {
    if (!isOpen) return;

    if (!initialQuery) {
      setSearchQuery('');
    }
    setHighlightedIndex(-1);
    if (!initialTab) {
      setActiveTab(isCurrentRefTag ? 'tags' : 'branches');
    }
    // Focus input with minimal delay for DOM attachment
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 30);
    return () => {
      clearTimeout(timer);
    };
  }, [isOpen, isCurrentRefTag, initialTab, initialQuery]);

  // Click-outside listener
  useEventListener(isOpen && typeof document !== 'undefined' ? document : null, 'mousedown', (e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setIsOpen(false);
    }
  });

  const handleSelect = (refName: string) => {
    onSelectRef(refName);
    setIsOpen(false);
    setSearchQuery('');
    setHighlightedIndex(-1);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentList.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % currentList.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentList.length > 0) {
        setHighlightedIndex((prev) => (prev - 1 + currentList.length) % currentList.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const targetItem =
        highlightedIndex >= 0 && highlightedIndex < currentList.length
          ? currentList[highlightedIndex]
          : currentList[0];

      if (targetItem) {
        handleSelect(targetItem.name);
      }
    }
  };

  // Determine current icon
  const currentIcon = isCurrentRefTag ? '🏷️' : isCurrentRefBranch ? '🌿' : '⚡';

  // Check if currentRef is the default branch
  const currentBranchObj = branches.find((b) => b.name === currentRef);
  const isCurrentDefault = currentBranchObj ? isDefaultBranch(currentBranchObj, defaultBranch) : false;

  return (
    <div className="ref-selector ref-selector-wrapper" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`btn ref-selector-trigger ref-trigger-btn ${isOpen ? 'active' : ''}`}
        onClick={() => {
          setIsOpen((prev) => !prev);
        }}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title="Switch branch or tag"
      >
        <span className="ref-icon ref-trigger-icon">{currentIcon}</span>
        <span className="ref-current-name">{currentRef}</span>
        {isCurrentDefault && <span className="badge badge-default ref-badge-default">default</span>}
        <span className="ref-arrow ref-trigger-chevron">▾</span>
      </button>

      {isOpen && (
        <div
          className="ref-popover ref-selector-popover"
          role="dialog"
          aria-label="Ref selector"
          onKeyDown={handleKeyDown}
        >
          <div className="ref-popover-header">
            <div className="ref-tabs ref-popover-tabs" role="tablist" aria-label="Ref types">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'branches'}
                className={`ref-tab tab-branches ref-tab-btn ${activeTab === 'branches' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('branches');
                  setHighlightedIndex(-1);
                  inputRef.current?.focus();
                }}
              >
                Branches <span className="ref-tab-badge">{branches.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'tags'}
                className={`ref-tab tab-tags ref-tab-btn ${activeTab === 'tags' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('tags');
                  setHighlightedIndex(-1);
                  inputRef.current?.focus();
                }}
              >
                Tags <span className="ref-tab-badge">{tags.length}</span>
              </button>
            </div>

            <div className="ref-search-container">
              <input
                ref={inputRef}
                type="text"
                className="ref-search-input"
                placeholder={activeTab === 'branches' ? 'Filter branches...' : 'Filter tags...'}
                value={searchQuery}
                onInput={(e) => {
                  setSearchQuery(e.currentTarget.value);
                  setHighlightedIndex(0);
                }}
              />
              {searchQuery !== '' && (
                <button
                  type="button"
                  className="ref-search-clear"
                  onClick={() => {
                    setSearchQuery('');
                    setHighlightedIndex(-1);
                    inputRef.current?.focus();
                  }}
                  title="Clear filter"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="ref-list-container">
            {activeTab === 'branches' ? (
              filteredBranches.length === 0 ? (
                <div className="ref-empty ref-empty-state">
                  {branches.length === 0
                    ? 'No branches found'
                    : `No branches found matching "${searchQuery}"`}
                </div>
              ) : (
                <ul className="ref-list" role="listbox" aria-label="Branches">
                  {filteredBranches.map((branch, idx) => {
                    const isSelected = branch.name === currentRef;
                    const isDefault = isDefaultBranch(branch, defaultBranch);
                    const isHighlighted = idx === highlightedIndex;

                    return (
                      <li key={`branch-${branch.name}`} className="ref-list-item-wrapper">
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`ref-item branch-item ${isSelected ? 'selected' : ''} ${
                            isHighlighted ? 'highlighted' : ''
                          }`}
                          onClick={() => {
                            handleSelect(branch.name);
                          }}
                          onMouseEnter={() => {
                            setHighlightedIndex(idx);
                          }}
                        >
                          <span className="ref-check">{isSelected ? '✓' : ''}</span>
                          <span className="ref-item-name" title={branch.name}>
                            {branch.name}
                          </span>
                          <div className="ref-item-meta">
                            {isDefault && (
                              <span className="badge badge-default ref-badge-default">default</span>
                            )}
                            <span className="badge badge-sha commit-sha-badge ref-badge-sha">
                              {formatSha(branch.target)}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : filteredTags.length === 0 ? (
              <div className="ref-empty ref-empty-state">
                {tags.length === 0
                  ? 'No tags found in this repository'
                  : `No tags found matching "${searchQuery}"`}
              </div>
            ) : (
              <ul className="ref-list" role="listbox" aria-label="Tags">
                {filteredTags.map((tag, idx) => {
                  const isSelected = tag.name === currentRef;
                  const targetSha = tag.peeled ?? tag.target;
                  const isHighlighted = idx === highlightedIndex;

                  return (
                    <li key={`tag-${tag.name}`} className="ref-list-item-wrapper">
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`ref-item tag-item ${isSelected ? 'selected' : ''} ${
                          isHighlighted ? 'highlighted' : ''
                        }`}
                        onClick={() => {
                          handleSelect(tag.name);
                        }}
                        onMouseEnter={() => {
                          setHighlightedIndex(idx);
                        }}
                      >
                        <span className="ref-check">{isSelected ? '✓' : ''}</span>
                        <span className="ref-item-name" title={tag.name}>
                          {tag.name}
                        </span>
                        <div className="ref-item-meta">
                          {tag.is_annotated ? (
                            <span className="badge badge-annotated badge-tag annotated">
                              annotated
                            </span>
                          ) : (
                            <span className="badge badge-tag lightweight">lightweight</span>
                          )}
                          <span className="badge badge-sha commit-sha-badge ref-badge-sha">
                            {formatSha(targetSha)}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
