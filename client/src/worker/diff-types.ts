export type DiffLineType = 'context' | 'add' | 'delete';

export interface Author {
  readonly name: string;
  readonly email: string;
}

export interface ReviewNote {
  readonly commitSha: string;
  readonly filePath?: string | undefined;
  readonly line?: number | undefined;
  readonly author: Author;
  readonly body: string;
  readonly createdAt: number;
}

export interface DiffLine {
  readonly type: DiffLineType;
  readonly content: string;
  readonly oldLineNumber: number | null;
  readonly newLineNumber: number | null;
  readonly reviewNotes?: readonly ReviewNote[] | undefined;
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
  readonly reviewNotes?: readonly ReviewNote[] | undefined;
}

export interface SplitDiffRow {
  readonly left: SplitDiffSide;
  readonly right: SplitDiffSide;
}

export interface FileDiffStats {
  readonly additions: number;
  readonly deletions: number;
}

export type FileDiffStatus = 'added' | 'deleted' | 'modified';

export interface FileDiffSummary {
  readonly status: FileDiffStatus;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly oldOid: string | null;
  readonly newOid: string | null;
  readonly oldMode: string | null;
  readonly newMode: string | null;
  readonly isBinary: boolean;
  readonly modeChanged?: boolean | undefined;
}

export interface FileDiff {
  readonly status?: FileDiffStatus | undefined;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly oldOid?: string | null | undefined;
  readonly newOid?: string | null | undefined;
  readonly oldMode?: string | null | undefined;
  readonly newMode?: string | null | undefined;
  readonly isBinary: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: readonly DiffHunk[];
  readonly splitRows: readonly SplitDiffRow[];
  readonly modeChanged?: boolean | undefined;
  readonly reviewNotes?: readonly ReviewNote[] | undefined;
}

export interface DiffBatchItemInput {
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly oldContent: string | null;
  readonly newContent: string | null;
  readonly oldOid?: string | null | undefined;
  readonly newOid?: string | null | undefined;
  readonly oldMode?: string | null | undefined;
  readonly newMode?: string | null | undefined;
  readonly status?: FileDiffStatus | undefined;
  readonly isBinary?: boolean | undefined;
  readonly modeChanged?: boolean | undefined;
  readonly contextLines?: number | undefined;
}

export type DiffWorkerRequest =
  | {
      readonly id: string;
      readonly type: 'COMPUTE_DIFF' | 'COMPUTE_FILE_DIFF';
      readonly oldPath: string | null;
      readonly newPath: string | null;
      readonly oldContent: string | null;
      readonly newContent: string | null;
      readonly contextLines?: number | undefined;
      readonly isBinary?: boolean | undefined;
    }
  | {
      readonly id: string;
      readonly type: 'COMPUTE_BATCH_DIFF';
      readonly items: readonly DiffBatchItemInput[];
      readonly contextLines?: number | undefined;
    };

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
      readonly type: 'BATCH_DIFF_RESULT';
      readonly results: readonly FileDiff[];
    }
  | {
      readonly id: string;
      readonly type: 'DIFF_ERROR';
      readonly error: string;
    };
