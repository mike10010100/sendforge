import { computeFileDiff } from './diff-algo.js';
import type {
  DiffWorkerRequest,
  DiffWorkerResponse,
  FileDiff,
} from './diff-types.js';

export interface DiffComputeOptions {
  readonly contextLines?: number;
  readonly isBinary?: boolean;
}

export class DiffClient {
  private worker: Worker | null = null;
  private readonly pendingRequests = new Map<
    string,
    {
      resolve: (diff: FileDiff) => void;
      reject: (err: Error) => void;
    }
  >();
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
          } else {
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
          // If worker errors out, reject all pending
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
   * Computes a file diff using the Web Worker, falling back to main-thread execution if unavailable.
   */
  public async computeDiff(
    oldPath: string | null,
    newPath: string | null,
    oldContent: string | null,
    newContent: string | null,
    options?: DiffComputeOptions
  ): Promise<FileDiff> {
    if (!this.worker) {
      // In-thread fallback
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
      this.pendingRequests.set(id, { resolve, reject });
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
