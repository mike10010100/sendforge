import { computeFileDiff } from './diff-algo.js';
import type { DiffWorkerRequest, DiffWorkerResponse } from './diff-types.js';

// Define typed worker scope
const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<DiffWorkerRequest>) => {
  const req = event.data;

  try {
    const fileDiff = computeFileDiff(
      req.oldPath,
      req.newPath,
      req.oldContent,
      req.newContent,
      req.contextLines ?? 3,
      req.isBinary ?? false
    );

    const response: DiffWorkerResponse = {
      id: req.id,
      type: 'DIFF_RESULT',
      oldPath: fileDiff.oldPath,
      newPath: fileDiff.newPath,
      isBinary: fileDiff.isBinary,
      hunks: fileDiff.hunks,
      splitRows: fileDiff.splitRows,
      stats: {
        additions: fileDiff.additions,
        deletions: fileDiff.deletions,
      },
    };

    workerScope.postMessage(response);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorResponse: DiffWorkerResponse = {
      id: req.id,
      type: 'DIFF_ERROR',
      error: errorMsg,
    };
    workerScope.postMessage(errorResponse);
  }
};
