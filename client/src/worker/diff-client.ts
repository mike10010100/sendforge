import { computeFileDiff } from './diff-algo.js';
import type {
  DiffBatchItemInput,
  DiffWorkerRequest,
  DiffWorkerResponse,
  FileDiff,
} from './diff-types.js';

export interface DiffComputeOptions {
  readonly contextLines?: number | undefined;
  readonly isBinary?: boolean | undefined;
}

type PendingHandler =
  | {
      readonly type: 'SINGLE';
      readonly resolve: (diff: FileDiff) => void;
      readonly reject: (err: Error) => void;
    }
  | {
      readonly type: 'BATCH';
      readonly resolve: (diffs: readonly FileDiff[]) => void;
      readonly reject: (err: Error) => void;
    };

export class DiffClient {
  private worker: Worker | null = null;
  private readonly pendingRequests = new Map<string, PendingHandler>();
  private requestIdCounter = 0;

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(
          new URL('./diff.worker.ts', import.meta.url),
          { type: 'module' }
        );

        this.worker.onmessage = (event: MessageEvent<DiffWorkerResponse>) => {
          const res = event.data;
          const handler = this.pendingRequests.get(res.id);
          if (!handler) return;

          this.pendingRequests.delete(res.id);

          if (res.type === 'DIFF_ERROR') {
            handler.reject(new Error(res.error));
          } else if (res.type === 'BATCH_DIFF_RESULT' && handler.type === 'BATCH') {
            handler.resolve(res.results);
          } else if (
            (res.type === 'DIFF_RESULT' || res.type === 'DIFF_SUCCESS') &&
            handler.type === 'SINGLE'
          ) {
            handler.resolve({
              oldPath: res.oldPath,
              newPath: res.newPath,
              isBinary: res.isBinary,
              additions: res.stats.additions,
              deletions: res.stats.deletions,
              hunks: res.hunks,
              splitRows: res.splitRows,
            });
          }
        };

        this.worker.onerror = (err) => {
          for (const [id, handler] of this.pendingRequests.entries()) {
            handler.reject(new Error(`Worker error: ${err.message}`));
            this.pendingRequests.delete(id);
          }
        };
      } catch {
        this.worker = null;
      }
    }
  }

  /**
   * Computes a single file diff using the Web Worker, falling back to main-thread execution if unavailable.
   */
  public async computeDiff(
    oldPath: string | null,
    newPath: string | null,
    oldContent: string | null,
    newContent: string | null,
    options?: DiffComputeOptions
  ): Promise<FileDiff> {
    if (!this.worker) {
      return computeFileDiff(
        oldPath,
        newPath,
        oldContent,
        newContent,
        options?.contextLines ?? 3,
        options?.isBinary ?? false
      );
    }

    const id = `diff_req_${++this.requestIdCounter}_${Date.now()}`;
    const req: DiffWorkerRequest = {
      id,
      type: 'COMPUTE_DIFF',
      oldPath,
      newPath,
      oldContent,
      newContent,
      ...(options?.contextLines !== undefined ? { contextLines: options.contextLines } : {}),
      ...(options?.isBinary !== undefined ? { isBinary: options.isBinary } : {}),
    };

    return new Promise<FileDiff>((resolve, reject) => {
      this.pendingRequests.set(id, { type: 'SINGLE', resolve, reject });
      if (this.worker) {
        this.worker.postMessage(req);
      }
    });
  }

  /**
   * Computes batch file diffs in the Web Worker, falling back to main-thread execution if unavailable.
   */
  public async computeBatchDiff(
    items: readonly DiffBatchItemInput[],
    options?: DiffComputeOptions
  ): Promise<readonly FileDiff[]> {
    if (items.length === 0) {
      return [];
    }

    if (!this.worker) {
      return items.map((item) => {
        const fd = computeFileDiff(
          item.oldPath,
          item.newPath,
          item.oldContent,
          item.newContent,
          item.contextLines ?? options?.contextLines ?? 3,
          item.isBinary ?? false
        );
        return {
          ...fd,
          ...(item.status !== undefined ? { status: item.status } : {}),
          ...(item.oldOid !== undefined ? { oldOid: item.oldOid } : {}),
          ...(item.newOid !== undefined ? { newOid: item.newOid } : {}),
          ...(item.oldMode !== undefined ? { oldMode: item.oldMode } : {}),
          ...(item.newMode !== undefined ? { newMode: item.newMode } : {}),
          ...(item.modeChanged !== undefined ? { modeChanged: item.modeChanged } : {}),
        };
      });
    }

    const id = `batch_diff_req_${++this.requestIdCounter}_${Date.now()}`;
    const req: DiffWorkerRequest = {
      id,
      type: 'COMPUTE_BATCH_DIFF',
      items,
      ...(options?.contextLines !== undefined ? { contextLines: options.contextLines } : {}),
    };

    return new Promise<readonly FileDiff[]>((resolve, reject) => {
      this.pendingRequests.set(id, { type: 'BATCH', resolve, reject });
      if (this.worker) {
        this.worker.postMessage(req);
      }
    });
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }
}

// Export singleton instance
export const diffClient = new DiffClient();
