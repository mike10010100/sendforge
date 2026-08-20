export type DiffLineType = 'context' | 'add' | 'delete';

export interface DiffLine {
  readonly type: DiffLineType;
  readonly content: string;
  readonly oldLineNumber: number | null;
  readonly newLineNumber: number | null;
}

export interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly header: string;
  readonly lines: readonly DiffLine[];
}

export interface SplitDiffSide {
  readonly lineNumber: number | null;
  readonly content: string | null;
  readonly type: 'delete' | 'add' | 'context' | 'empty';
}

export interface SplitDiffRow {
  readonly left: SplitDiffSide;
  readonly right: SplitDiffSide;
}

export interface FileDiffStats {
  readonly additions: number;
  readonly deletions: number;
}

export interface FileDiff {
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly isBinary: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: readonly DiffHunk[];
  readonly splitRows: readonly SplitDiffRow[];
}

export interface DiffWorkerRequest {
  readonly id: string;
  readonly type: 'COMPUTE_DIFF' | 'COMPUTE_FILE_DIFF';
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly oldContent: string | null;
  readonly newContent: string | null;
  readonly contextLines?: number;
  readonly isBinary?: boolean;
}

export type DiffWorkerResponse =
  | {
      readonly id: string;
      readonly type: 'DIFF_RESULT' | 'DIFF_SUCCESS';
      readonly oldPath: string | null;
      readonly newPath: string | null;
      readonly isBinary: boolean;
      readonly hunks: readonly DiffHunk[];
      readonly splitRows: readonly SplitDiffRow[];
      readonly stats: FileDiffStats;
    }
  | {
      readonly id: string;
      readonly type: 'DIFF_ERROR';
      readonly error: string;
    };
