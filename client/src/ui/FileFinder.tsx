import { useEffect, useRef, useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { TreeFileItem } from '../engine/fetcher.js';

export interface FileFinderProps {
  readonly files: readonly TreeFileItem[];
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSelectFile: (path: string) => void;
}

export const FileFinder: FunctionalComponent<FileFinderProps> = ({
  files,
  isOpen,
  onClose,
  onSelectFile,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const filtered = files.filter((f) =>
    f.path.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 50);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < filtered.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = filtered[selectedIndex];
      if (selected) {
        onSelectFile(selected.path);
        onClose();
      }
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-content">
        <div className="finder-input-container">
          <input
            ref={inputRef}
            type="text"
            className="finder-input"
            placeholder="Go to file... (type to filter, ↑/↓ to navigate, Enter to open)"
            value={query}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>

        <ul className="finder-results">
          {filtered.length === 0 ? (
            <li className="finder-item" style={{ color: 'var(--text-muted)', cursor: 'default' }}>
              No matching files found
            </li>
          ) : (
            filtered.map((item, idx) => (
              <li
                key={item.path}
                className={`finder-item ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => {
                  onSelectFile(item.path);
                  onClose();
                }}
              >
                <span>📄</span>
                <span>{item.path}</span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
};
