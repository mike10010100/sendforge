import { computeFileDiff } from './diff-algo.js';
import type { DiffWorkerRequest, DiffWorkerResponse, FileDiff } from './diff-types.js';

// Define typed worker scope
const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<DiffWorkerRequest>) => {
  const req = event.data;

  try {
    if (req.type === 'COMPUTE_BATCH_DIFF') {
      const results: FileDiff[] = req.items.map((item) => {
        const fileDiff = computeFileDiff(
          item.oldPath,
          item.newPath,
          item.oldContent,
          item.newContent,
          item.contextLines ?? req.contextLines ?? 3,
          item.isBinary ?? false
        );

        return {
          ...fileDiff,
          ...(item.status !== undefined ? { status: item.status } : {}),
          ...(item.oldOid !== undefined ? { oldOid: item.oldOid } : {}),
          ...(item.newOid !== undefined ? { newOid: item.newOid } : {}),
          ...(item.oldMode !== undefined ? { oldMode: item.oldMode } : {}),
          ...(item.newMode !== undefined ? { newMode: item.newMode } : {}),
          ...(item.modeChanged !== undefined ? { modeChanged: item.modeChanged } : {}),
        };
      });

      const response: DiffWorkerResponse = {
        id: req.id,
        type: 'BATCH_DIFF_RESULT',
        results,
      };

      workerScope.postMessage(response);
    } else {
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
    }
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
