import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { TreeFileItem } from '../engine/fetcher.js';
import {
  TreeIndexer,
  type TreeEntry,
  type FuzzyMatchResult,
  highlightMatchedSpans,
} from '../engine/tree-indexer.js';
import { useFocusTrap } from './hooks/useFocusTrap.js';

export interface FileFinderProps {
  readonly files: readonly TreeFileItem[] | readonly TreeEntry[];
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSelectFile: (path: string, targetLine?: number) => void;
  readonly initialQuery?: string;
  readonly maxResults?: number;
}

/**
 * Returns a contextual icon representing the file type.
 */
function getFileIcon(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.rs')) return '🦀';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.jsx')) return '⚡';
  if (lower.endsWith('.json') || lower.endsWith('.toml') || lower.endsWith('.yaml') || lower.endsWith('.yml')) return '⚙️';
  if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.markdown') || lower.endsWith('.rst')) return '📝';
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.less')) return '🎨';
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.ico')
  ) {
    return '🖼️';
  }
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return '🐚';
  if (lower.endsWith('.lock') || lower.endsWith('.gitignore') || lower.endsWith('.env')) return '🔒';
  return '📄';
}

export const FileFinder: FunctionalComponent<FileFinderProps> = ({
  files,
  isOpen,
  onClose,
  onSelectFile,
  initialQuery = '',
  maxResults = 50,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const modalContentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useFocusTrap({
    isActive: isOpen,
    containerRef: modalContentRef,
    initialFocusRef: inputRef,
  });

  // Initialize and memoize tree indexer
  const indexer = useMemo(() => new TreeIndexer(files), [files]);

  // Execute fast fuzzy search
  const results = useMemo<FuzzyMatchResult[]>(() => {
    if (!isOpen) return [];
    return indexer.search(query, maxResults);
  }, [indexer, query, maxResults, isOpen]);

  // Reset state and autofocus on modal open
  useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery);
      setSelectedIndex(0);
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [isOpen, initialQuery]);

  // Clamp selected index when results change
  useEffect(() => {
    if (selectedIndex >= results.length && results.length > 0) {
      setSelectedIndex(0);
    }
  }, [results.length, selectedIndex]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current && results.length > 0) {
      const activeEl = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, results.length]);

  if (!isOpen) {
    return null;
  }

  const handleSelect = (item: FuzzyMatchResult) => {
    onSelectFile(item.entry.path, item.targetLine);
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) {
        setSelectedIndex((prev) => (prev + 1 < results.length ? prev + 1 : 0));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) {
        setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : results.length - 1));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = results[selectedIndex];
      if (selected) {
        handleSelect(selected);
      }
    } else if (e.key === 'Home' || (e.ctrlKey && e.key === 'a')) {
      if (e.target !== inputRef.current || e.ctrlKey) {
        setSelectedIndex(0);
      }
    } else if (e.key === 'End' || (e.ctrlKey && e.key === 'e')) {
      if (e.target !== inputRef.current || e.ctrlKey) {
        setSelectedIndex(Math.max(0, results.length - 1));
      }
    }
  };

  return (
    <div
      className="modal-overlay finder-modal-overlay"
      data-testid="file-finder-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={modalContentRef}
        className="modal-content finder-modal-content"
        role="dialog"
        aria-modal="true"
        aria-label="File Finder"
      >
        {/* Search Header */}
        <div className="finder-input-container">
          <span className="finder-search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            ref={inputRef}
            type="text"
            className="finder-input"
            data-testid="file-finder-input"
            placeholder="Go to file... (e.g. main.rs:42, ↑/↓ to navigate, ↵ to open)"
            value={query}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            aria-autocomplete="list"
            aria-controls="finder-results-list"
          />
          {query.length > 0 && (
            <button
              type="button"
              className="finder-clear-btn"
              data-testid="file-finder-clear"
              onClick={() => {
                setQuery('');
                setSelectedIndex(0);
                inputRef.current?.focus();
              }}
              title="Clear search query"
              aria-label="Clear query"
            >
              ✕
            </button>
          )}
          {query.trim().length > 0 && (
            <span className="finder-result-count-badge" data-testid="file-finder-count">
              {results.length} {results.length === 1 ? 'match' : 'matches'}
            </span>
          )}
        </div>

        {/* Results List */}
        <ul
          ref={listRef}
          id="finder-results-list"
          className="finder-results"
          role="listbox"
          data-testid="file-finder-results"
        >
          {results.length === 0 ? (
            <li className="finder-empty-state" data-testid="file-finder-empty">
              <span className="finder-empty-icon">📂</span>
              <span className="finder-empty-text">
                {query.trim() ? `No files matching "${query}"` : 'No files indexed in this revision'}
              </span>
              <span className="finder-empty-hint">
                Type a file path or name (e.g. <code>src/main.rs:42</code>)
              </span>
            </li>
          ) : (
            results.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const spans = highlightMatchedSpans(item.entry.path, item.matches);
              const icon = getFileIcon(item.entry.path);

              return (
                <li
                  key={item.entry.path}
                  id={`finder-option-${String(idx)}`}
                  className={`finder-item ${isSelected ? 'selected' : ''}`}
                  role="option"
                  aria-selected={isSelected}
                  data-testid={`file-finder-item-${String(idx)}`}
                  data-path={item.entry.path}
                  onClick={() => {
                    handleSelect(item);
                  }}
                  onMouseEnter={() => {
                    setSelectedIndex(idx);
                  }}
                >
                  <span className="finder-item-icon" aria-hidden="true">
                    {icon}
                  </span>
                  <div className="finder-item-path" title={item.entry.path}>
                    {spans.map((span, sIdx) =>
                      span.isMatch ? (
                        <mark key={sIdx} className="match-highlight finder-match-highlight">
                          {span.text}
                        </mark>
                      ) : (
                        <span key={sIdx}>{span.text}</span>
                      )
                    )}
                  </div>
                  {item.targetLine !== undefined && (
                    <span
                      className="finder-line-badge"
                      data-testid="file-finder-line-badge"
                      title={`Jump to line ${String(item.targetLine)}`}
                    >
                      :{item.targetLine}
                      {item.targetLineEnd !== undefined ? `-${String(item.targetLineEnd)}` : ''}
                    </span>
                  )}
                  {isSelected && (
                    <span className="finder-enter-hint" aria-hidden="true">
                      ↵
                    </span>
                  )}
                </li>
              );
            })
          )}
        </ul>

        {/* Modal Footer with Keyboard Shortcuts */}
        <div className="finder-footer">
          <div className="finder-shortcuts-group">
            <span className="finder-shortcut-pill">
              <kbd className="finder-kbd">↑</kbd>
              <kbd className="finder-kbd">↓</kbd>
              <span>Navigate</span>
            </span>
            <span className="finder-shortcut-pill">
              <kbd className="finder-kbd">↵</kbd>
              <span>Select</span>
            </span>
            <span className="finder-shortcut-pill">
              <kbd className="finder-kbd">Esc</kbd>
              <span>Close</span>
            </span>
            <span className="finder-shortcut-pill">
              <kbd className="finder-kbd">:42</kbd>
              <span>Jump to line</span>
            </span>
          </div>
          <span className="finder-total-stats">
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </span>
        </div>
      </div>
    </div>
  );
};
