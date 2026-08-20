import type { FunctionalComponent } from 'preact';
import type { GitBlobObject, GitTreeEntry } from '../engine/types.js';
import { formatSha, renderMarkdown } from './utils.js';

export interface TreeViewProps {
  readonly entries: readonly GitTreeEntry[];
  readonly currentPath: string;
  readonly onNavigate: (path: string, isTree: boolean) => void;
  readonly readmeBlob?: GitBlobObject | null;
}

export const TreeView: FunctionalComponent<TreeViewProps> = ({
  entries,
  currentPath,
  onNavigate,
  readmeBlob,
}) => {
  const getItemIcon = (entry: GitTreeEntry): string => {
    if (entry.isTree) return '📁';
    if (entry.isSubmodule) return '📦';
    if (entry.isSymlink) return '🔗';
    if (entry.mode === '100755') return '⚡';
    return '📄';
  };

  const handleEntryClick = (entry: GitTreeEntry) => {
    const fullPath = currentPath
      ? `${currentPath.replace(/\/+$/, '')}/${entry.name}`
      : entry.name;
    onNavigate(fullPath, entry.isTree);
  };

  return (
    <div className="tree-view-wrapper">
      <div className="box">
        <div className="box-header">
          <span>Files ({entries.length})</span>
        </div>
        <table className="tree-table">
          <tbody>
            {entries.length === 0 ? (
              <tr className="tree-row">
                <td colSpan={3} className="tree-cell" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Empty directory
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr
                  key={entry.name}
                  className="tree-row"
                  onClick={() => {
                    handleEntryClick(entry);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="tree-cell tree-cell-name">
                    <span className="tree-icon">{getItemIcon(entry)}</span>
                    <a
                      href={`#/tree/${entry.name}`}
                      onClick={(e) => {
                        e.preventDefault();
                        handleEntryClick(entry);
                      }}
                    >
                      {entry.name}
                    </a>
                  </td>
                  <td className="tree-cell tree-cell-mode">{entry.mode}</td>
                  <td className="tree-cell tree-cell-sha">{formatSha(entry.oid)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {readmeBlob?.text && (
        <div className="box">
          <div className="box-header">
            <span>📖 README.md</span>
          </div>
          <div
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(readmeBlob.text) }}
          />
        </div>
      )}
    </div>
  );
};
