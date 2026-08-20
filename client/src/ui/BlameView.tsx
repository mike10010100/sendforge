import { useEffect, useMemo, useState } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';
import type { GitBlobObject } from '../engine/types.js';
import type { GitRepositoryClient } from '../engine/fetcher.js';
import type { BlameHunk, BlameLineInfo, BlameResult } from '../engine/blame.js';

import {
  calculateAgeFraction,
  formatIsoDate,
  formatRelativeTime,
  formatSha,
  getAuthorColor,
  getAuthorInitials,
  getHeatmapColor,
  type LineRange,
} from './utils.js';

export interface BlameViewProps {
  /** The target blob object containing text content and size. */
  readonly blob?: GitBlobObject | undefined;
  /** Relative repository path of the file (e.g. "src/main.rs"). */
  readonly path?: string | undefined;
  /** Commit OID (SHA-1) from which to compute blame. */
  readonly commitOid?: string | undefined;
  /** Git repository client instance used to fetch commit DAG and loose objects. */
  readonly client?: GitRepositoryClient | undefined;
  /** Optional pre-computed blame result (for SSR, testing, or caching). */
  readonly initialBlame?: BlameResult | undefined;
  /** Alternate prop name for pre-computed blame result. */
  readonly blameResult?: BlameResult | undefined;
  /** Optional explicit lines array */
  readonly fileLines?: readonly string[] | undefined;
  /** Alternate prop name for path */
  readonly filePath?: string | undefined;
  /** Callback fired when a commit SHA or message link is clicked. */
  readonly onSelectCommit?: ((sha: string) => void) | undefined;
  /** Callback fired when a line number is clicked. */
  readonly onLineClick?: ((lineNum: number, event?: MouseEvent | { shiftKey?: boolean }) => void) | undefined;
  /** Currently selected line number. */
  readonly selectedLine?: number | null | undefined;
  /** Currently selected line range. */
  readonly selectedRange?: LineRange | null | undefined;
}

export const BlameView: FunctionalComponent<BlameViewProps> = ({
  blob,
  path,
  commitOid,
  client,
  initialBlame,
  blameResult: directBlame,
  fileLines,
  filePath,
  onSelectCommit,
  onLineClick,
  selectedLine = null,
  selectedRange = null,
}) => {
  const preloadedBlame = directBlame ?? initialBlame;
  const targetPath = filePath ?? path ?? '';

  const [loading, setLoading] = useState<boolean>(!preloadedBlame && Boolean(client && commitOid && targetPath));
  const [error, setError] = useState<string | null>(null);
  const [computedBlame, setComputedBlame] = useState<BlameResult | null>(preloadedBlame ?? null);
  const [visitedCommits, setVisitedCommits] = useState<number>(0);
  const [hoveredCommitOid, setHoveredCommitOid] = useState<string | null>(null);

  const lines = useMemo(() => {
    if (fileLines !== undefined) {
      return fileLines;
    }
    if (blob?.text !== undefined) {
      return blob.text ? blob.text.split(/\r?\n/) : [];
    }
    if (preloadedBlame?.lines.length) {
      return new Array<string>(preloadedBlame.lines.length).fill('');
    }
    return [];
  }, [fileLines, blob?.text, preloadedBlame]);

  const loadBlame = async () => {
    if (preloadedBlame) {
      setComputedBlame(preloadedBlame);
      setLoading(false);
      return;
    }

    if (!client || !commitOid || !targetPath) {
      setError('Git repository client, commit revision, and file path are required for blame calculation.');
      setLoading(false);
      return;
    }


    try {
      setLoading(true);
      setError(null);
      setVisitedCommits(0);

      const { computeBlame } = await import('../engine/blame.js');
      const result = await computeBlame(
        client,
        commitOid,
        targetPath,
        (count) => {
          setVisitedCommits(count);
        }
      );

      setComputedBlame(result);
    } catch (err) {

      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to compute blame for ${targetPath}: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (preloadedBlame) {
      setComputedBlame(preloadedBlame);
      setLoading(false);
      return;
    }
    if (client && commitOid && targetPath) {
      void loadBlame();
    }
  }, [client, commitOid, targetPath, blob?.oid, preloadedBlame]);

  if (loading) {
    return (
      <div className="blame-loading-container">
        <div className="blame-spinner" />
        <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>
          Calculating git blame...
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Traversed {visitedCommits} commit{visitedCommits === 1 ? '' : 's'}
        </div>
        <div className="blame-progress-bar-container">
          <div
            className="blame-progress-bar-fill"
            style={{ width: `${Math.min(100, Math.max(15, visitedCommits * 8))}%` }}
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="box"
        style={{
          padding: '24px',
          textAlign: 'center',
          backgroundColor: 'var(--diff-del-bg)',
          borderColor: 'var(--diff-del-text)',
          margin: '16px',
        }}
      >
        <p style={{ color: 'var(--diff-del-text)', fontWeight: 600, marginBottom: '8px' }}>
          {error}
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void loadBlame();
          }}
        >
          🔄 Retry Blame
        </button>
      </div>
    );
  }

  const effectiveBlame = computedBlame ?? preloadedBlame;

  if (lines.length === 0 && (!effectiveBlame || effectiveBlame.lines.length === 0)) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Empty file {targetPath ? `(${targetPath}) ` : ''}(0 lines)
      </div>
    );
  }

  // Create quick lookups for hunks and line info
  const hunkStartMap = new Map<number, BlameHunk>();
  const lineInfoMap = new Map<number, BlameLineInfo>();

  if (effectiveBlame) {
    for (const hunk of effectiveBlame.hunks) {
      hunkStartMap.set(hunk.startLine, hunk);
    }
    for (const line of effectiveBlame.lines) {
      lineInfoMap.set(line.lineNumber, line);
    }
  }

  const oldestTs = effectiveBlame?.oldestTimestamp ?? 0;
  const newestTs = effectiveBlame?.newestTimestamp ?? 0;

  // Use either lines from text or line count from blame
  const lineCount = Math.max(lines.length, effectiveBlame?.lines.length ?? 0);
  const displayLines = lines.length >= lineCount
    ? lines
    : Array.from({ length: lineCount }, (_, i) => lines[i] ?? '');

  return (
    <div className="blame-container">
      {displayLines.map((lineText, idx) => {
        const lineNum = idx + 1;
        const lineInfo = lineInfoMap.get(lineNum);
        const hunkStart = hunkStartMap.get(lineNum);
        const isHunkStart = Boolean(hunkStart);
        const isSelected = selectedRange !== null
          ? lineNum >= selectedRange.start && lineNum <= selectedRange.end
          : selectedLine === lineNum;
        const commitSha = lineInfo?.commitOid ?? hunkStart?.commitOid ?? '';
        const isHoveredCommit = Boolean(hoveredCommitOid && hoveredCommitOid === commitSha);

        const ageFraction = lineInfo
          ? calculateAgeFraction(lineInfo.timestamp, oldestTs, newestTs)
          : hunkStart
            ? calculateAgeFraction(hunkStart.timestamp, oldestTs, newestTs)
            : 1.0;
        const heatmap = getHeatmapColor(ageFraction);

        const commitTooltip = lineInfo
          ? `${formatSha(lineInfo.commitOid)} - ${lineInfo.summary}\nAuthor: ${lineInfo.authorName} <${lineInfo.authorEmail}>\nDate: ${formatIsoDate(lineInfo.timestamp)} (${formatRelativeTime(lineInfo.timestamp)})`
          : hunkStart
            ? `${formatSha(hunkStart.commitOid)} - ${hunkStart.summary}\nAuthor: ${hunkStart.authorName} <${hunkStart.authorEmail}>\nDate: ${formatIsoDate(hunkStart.timestamp)} (${formatRelativeTime(hunkStart.timestamp)})`
            : 'Commit attribution';

        return (
          <div
            key={lineNum}
            id={`blame-row-${lineNum}`}
            className={`blame-row ${isHunkStart ? 'hunk-start' : ''} ${
              isSelected ? 'highlighted line-highlight line-selected' : ''
            } ${isHoveredCommit ? 'commit-hovered' : ''}`}
            onMouseEnter={() => {
              if (commitSha) setHoveredCommitOid(commitSha);
            }}
            onMouseLeave={() => {
              setHoveredCommitOid(null);
            }}
          >
            {/* Blame Gutter Column */}
            <div
              className={`blame-gutter blame-heatmap ${!isHunkStart ? 'continuation' : ''}`}
              style={{
                borderLeftColor: heatmap.borderColor,
                backgroundColor: heatmap.bgColor,
              }}
              title={commitTooltip}
            >
              {isHunkStart && hunkStart ? (
                <>
                  <div
                    className="blame-avatar"
                    style={{ backgroundColor: getAuthorColor(hunkStart.authorName, hunkStart.authorEmail) }}
                    title={`${hunkStart.authorName} <${hunkStart.authorEmail}>`}
                  >
                    {getAuthorInitials(hunkStart.authorName)}
                  </div>
                  <span className="blame-author" title={hunkStart.authorName}>
                    {hunkStart.authorName}
                  </span>
                  <a
                    href={`#/commit/${hunkStart.commitOid}`}
                    className="blame-sha-link"
                    title={`View commit ${hunkStart.commitOid}`}
                    onClick={(e) => {
                      if (onSelectCommit) {
                        e.preventDefault();
                        onSelectCommit(hunkStart.commitOid);
                      }
                    }}
                  >
                    {formatSha(hunkStart.commitOid)}
                  </a>
                  <span className="blame-date" title={formatIsoDate(hunkStart.timestamp)}>
                    {formatRelativeTime(hunkStart.timestamp)}
                  </span>
                  <span
                    className="blame-summary"
                    title={hunkStart.summary}
                    onClick={() => {
                      onSelectCommit?.(hunkStart.commitOid);
                    }}
                  >
                    {hunkStart.summary}
                  </span>
                </>
              ) : (
                <div className="blame-gutter-empty" />
              )}
            </div>

            {/* Line Number Column */}
            <div
              id={`L${lineNum}`}
              data-line-number={lineNum}
              className={`blame-line-num ${isSelected ? 'highlighted line-selected' : ''}`}
              onClick={(e) => {
                onLineClick?.(lineNum, e);
              }}
              title={`Line ${lineNum}`}
            >
              {lineNum}
            </div>

            {/* Code Line Column */}
            <div
              id={`LC${lineNum}`}
              data-line-number={lineNum}
              className={`blame-code-line ${isSelected ? 'highlighted line-highlight line-selected' : ''}`}
            >
              {lineText || ' '}
            </div>
          </div>
        );
      })}
    </div>
  );
};
