import type { GitRepositoryClient } from './fetcher.js';
import type { GitCommitObject } from './types.js';
import type { CommitSummary } from './dag.js';
import { getCommitHistoryRange } from './dag.js';
import { computeTreeFullDiff } from '../worker/diff-algo.js';
import type { FileDiff } from '../worker/diff-types.js';
import { formatSha } from '../ui/utils.js';

export interface FormatPatchOptions {
  readonly commit: GitCommitObject | CommitSummary;
  readonly fileDiffs: readonly FileDiff[];
  readonly parentTreeSha?: string | undefined;
  readonly patchIndex?: number | undefined;
  readonly totalPatches?: number | undefined;
  readonly versionTrailer?: string | undefined;
}

export interface PatchFileItem {
  readonly filename: string;
  readonly content: string;
}

/**
 * Formats a Unix timestamp into standard RFC 2822 date string.
 * Example: "Wed, 20 Aug 2026 17:00:00 +0000"
 */
export function formatRfc2822Date(timestampInSeconds: number, tzOffset?: string): string {
  const date = new Date(timestampInSeconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return 'Mon, 17 Sep 2001 00:00:00 +0000';
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const dayName = days[date.getUTCDay()] ?? 'Mon';
  const day = String(date.getUTCDate()).padStart(2, '0');
  const monthName = months[date.getUTCMonth()] ?? 'Sep';
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  const tz = tzOffset && /^[+-]\d{4}$/.test(tzOffset) ? tzOffset : '+0000';

  return `${dayName}, ${day} ${monthName} ${year} ${hours}:${minutes}:${seconds} ${tz}`;
}

/**
 * Builds the diffstat summary block for a list of file diffs.
 */
export function buildDiffStat(fileDiffs: readonly FileDiff[]): string {
  if (fileDiffs.length === 0) {
    return ' 0 files changed';
  }

  const lines: string[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;
  let filesChangedCount = 0;

  // Max path length for alignment (bounded between 20 and 50)
  let maxPathLen = 0;
  for (const fd of fileDiffs) {
    const p = fd.newPath ?? fd.oldPath ?? 'unknown';
    if (p.length > maxPathLen) {
      maxPathLen = p.length;
    }
  }
  const alignWidth = Math.min(Math.max(maxPathLen, 10), 50);

  for (const fd of fileDiffs) {
    const path = fd.newPath ?? fd.oldPath ?? 'unknown';
    filesChangedCount++;
    totalAdditions += fd.additions;
    totalDeletions += fd.deletions;

    const changes = fd.additions + fd.deletions;
    const paddedPath = path.padEnd(alignWidth, ' ');

    if (fd.isBinary) {
      lines.push(` ${paddedPath} | Bin`);
    } else {
      // Build histogram visual (max 20 characters)
      const maxHistogram = 20;
      let plusCount = 0;
      let minusCount = 0;

      if (changes > 0) {
        if (changes <= maxHistogram) {
          plusCount = fd.additions;
          minusCount = fd.deletions;
        } else {
          plusCount = Math.round((fd.additions / changes) * maxHistogram);
          minusCount = Math.round((fd.deletions / changes) * maxHistogram);
          if (plusCount === 0 && fd.additions > 0) plusCount = 1;
          if (minusCount === 0 && fd.deletions > 0) minusCount = 1;
        }
      }

      const histogram = '+'.repeat(plusCount) + '-'.repeat(minusCount);
      lines.push(` ${paddedPath} | ${changes} ${histogram}`);
    }
  }

  // Summary line
  const fileWord = filesChangedCount === 1 ? 'file' : 'files';
  const parts: string[] = [` ${filesChangedCount} ${fileWord} changed`];

  if (totalAdditions > 0 || totalDeletions === 0) {
    const addWord = totalAdditions === 1 ? 'insertion(+)' : 'insertions(+)';
    parts.push(`${totalAdditions} ${addWord}`);
  }
  if (totalDeletions > 0) {
    const delWord = totalDeletions === 1 ? 'deletion(-)' : 'deletions(-)';
    parts.push(`${totalDeletions} ${delWord}`);
  }

  lines.push(parts.join(', '));
  return lines.join('\n');
}

/**
 * Formats hunks of a single file diff into unified diff format.
 */
export function formatFileDiffHunks(fd: FileDiff): string {
  const oldPath = fd.oldPath;
  const newPath = fd.newPath;
  const oldOid = fd.oldOid ? formatSha(fd.oldOid) : '0000000';
  const newOid = fd.newOid ? formatSha(fd.newOid) : '0000000';
  const oldMode = fd.oldMode ?? '100644';
  const newMode = fd.newMode ?? '100644';

  const lines: string[] = [];

  const effectiveOldPath = oldPath ?? newPath ?? 'dev/null';
  const effectiveNewPath = newPath ?? oldPath ?? 'dev/null';

  lines.push(`diff --git a/${effectiveOldPath} b/${effectiveNewPath}`);

  if (fd.status === 'added' || (!oldPath && newPath)) {
    lines.push(`new file mode ${newMode}`);
    lines.push(`index 0000000..${newOid}`);
    lines.push('--- /dev/null');
    lines.push(`+++ b/${effectiveNewPath}`);
  } else if (fd.status === 'deleted' || (oldPath && !newPath)) {
    lines.push(`deleted file mode ${oldMode}`);
    lines.push(`index ${oldOid}..0000000`);
    lines.push(`--- a/${effectiveOldPath}`);
    lines.push('+++ /dev/null');
  } else {
    if (fd.modeChanged && oldMode !== newMode) {
      lines.push(`old mode ${oldMode}`);
      lines.push(`new mode ${newMode}`);
    }
    lines.push(`index ${oldOid}..${newOid} ${newMode}`);
    lines.push(`--- a/${effectiveOldPath}`);
    lines.push(`+++ b/${effectiveNewPath}`);
  }

  if (fd.isBinary) {
    lines.push(`Binary files a/${effectiveOldPath} and b/${effectiveNewPath} differ`);
    return lines.join('\n');
  }

  for (const hunk of fd.hunks) {
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      if (line.type === 'context') {
        lines.push(` ${line.content}`);
      } else if (line.type === 'add') {
        lines.push(`+${line.content}`);
      } else {
        lines.push(`-${line.content}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Formats a single commit and its file diffs into an RFC 2822 standard git format-patch string.
 */
export function formatSinglePatch(options: FormatPatchOptions): string {
  const { commit, fileDiffs, patchIndex, totalPatches, versionTrailer } = options;

  const commitSha = (commit.oid || '0000000000000000000000000000000000000000').toLowerCase();
  const authorName = commit.author.name.trim() || 'Anonymous';
  const authorEmail = commit.author.email.trim() || 'anonymous@sendforge.local';
  const dateStr = formatRfc2822Date(commit.author.timestamp, commit.author.tzOffset);

  // Subject prefix: [PATCH] or [PATCH 1/3]
  let subjectPrefix = '[PATCH]';
  if (totalPatches !== undefined && totalPatches > 1 && patchIndex !== undefined) {
    subjectPrefix = `[PATCH ${patchIndex}/${totalPatches}]`;
  }

  const subject = commit.subject.trim() || 'Untitled commit';
  const body = commit.body.trim();

  const diffstat = buildDiffStat(fileDiffs);

  const diffBlocks: string[] = [];
  for (const fd of fileDiffs) {
    const block = formatFileDiffHunks(fd);
    if (block) {
      diffBlocks.push(block);
    }
  }

  const trailer = versionTrailer?.trim() ? versionTrailer.trim() : 'Sendforge';

  const parts: string[] = [
    `From ${commitSha} Mon Sep 17 00:00:00 2001`,
    `From: ${authorName} <${authorEmail}>`,
    `Date: ${dateStr}`,
    `Subject: ${subjectPrefix} ${subject}`,
    '',
  ];

  if (body) {
    parts.push(body);
    parts.push('');
  }

  parts.push('---');
  parts.push(diffstat);
  parts.push('');

  if (diffBlocks.length > 0) {
    parts.push(diffBlocks.join('\n\n'));
    parts.push('');
  }

  // Trailer footer with trailing space after --
  parts.push(`-- \n${trailer}\n`);

  return parts.join('\n');
}

/**
 * Generates an RFC 2822 format-patch string for a single commit SHA.
 */
export async function generateFormatPatch(
  client: GitRepositoryClient,
  commitSha: string,
  options?: { readonly versionTrailer?: string | undefined }
): Promise<string> {
  const commit = await client.getCommit(commitSha);
  const parentSha = commit.parents[0] ?? null;
  const fileDiffs = await computeTreeFullDiff(client, parentSha, commit.oid);

  return formatSinglePatch({
    commit,
    fileDiffs,
    patchIndex: 1,
    totalPatches: 1,
    ...(options?.versionTrailer !== undefined ? { versionTrailer: options.versionTrailer } : {}),
  });
}

/**
 * Generates a multi-commit RFC 2822 patch series or consolidated range patch.
 */
export async function generateFormatPatchRange(
  client: GitRepositoryClient,
  baseSha: string | null,
  headSha: string,
  options?: { readonly versionTrailer?: string | undefined }
): Promise<string> {
  const cleanHead = headSha.trim().toLowerCase();
  const cleanBase = baseSha ? baseSha.trim().toLowerCase() : null;

  if (cleanBase !== null && cleanBase === cleanHead) {
    return '';
  }

  const commits = await getCommitHistoryRange(client, cleanBase, cleanHead);

  if (commits.length === 0) {
    // If no intermediate commits found, compute direct tree diff between base and head
    try {
      const headCommit = await client.getCommit(cleanHead);
      const fileDiffs = await computeTreeFullDiff(client, cleanBase, cleanHead);
      return formatSinglePatch({
        commit: headCommit,
        fileDiffs,
        patchIndex: 1,
        totalPatches: 1,
        ...(options?.versionTrailer !== undefined ? { versionTrailer: options.versionTrailer } : {}),
      });
    } catch {
      return '';
    }
  }

  // Reverse commits to chronological order (oldest first)
  const chronoCommits = commits.slice().reverse();
  const patches: string[] = [];

  for (let i = 0; i < chronoCommits.length; i++) {
    const c = chronoCommits[i];
    if (!c) continue;
    const parentSha = c.parents[0] ?? null;
    const fileDiffs = await computeTreeFullDiff(client, parentSha, c.oid);

    const patchText = formatSinglePatch({
      commit: c,
      fileDiffs,
      patchIndex: i + 1,
      totalPatches: chronoCommits.length,
      ...(options?.versionTrailer !== undefined ? { versionTrailer: options.versionTrailer } : {}),
    });

    patches.push(patchText);
  }

  return patches.join('\n\n');
}

/**
 * Generates an array of named patch files for a commit range.
 */
export async function generatePatchSeries(
  client: GitRepositoryClient,
  baseSha: string | null,
  headSha: string,
  options?: { readonly versionTrailer?: string | undefined }
): Promise<readonly PatchFileItem[]> {
  const cleanHead = headSha.trim().toLowerCase();
  const cleanBase = baseSha ? baseSha.trim().toLowerCase() : null;

  if (cleanBase !== null && cleanBase === cleanHead) {
    return [];
  }

  const commits = await getCommitHistoryRange(client, cleanBase, cleanHead);
  if (commits.length === 0) {
    const patchContent = await generateFormatPatchRange(client, cleanBase, cleanHead, options);
    if (!patchContent) return [];
    return [{ filename: '0001-patch.patch', content: patchContent }];
  }

  const chronoCommits = commits.slice().reverse();
  const items: PatchFileItem[] = [];

  for (let i = 0; i < chronoCommits.length; i++) {
    const c = chronoCommits[i];
    if (!c) continue;
    const parentSha = c.parents[0] ?? null;
    const fileDiffs = await computeTreeFullDiff(client, parentSha, c.oid);

    const patchText = formatSinglePatch({
      commit: c,
      fileDiffs,
      patchIndex: i + 1,
      totalPatches: chronoCommits.length,
      ...(options?.versionTrailer !== undefined ? { versionTrailer: options.versionTrailer } : {}),
    });

    const indexStr = String(i + 1).padStart(4, '0');
    const slug = c.subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'patch';

    items.push({
      filename: `${indexStr}-${slug}.patch`,
      content: patchText,
    });
  }

  return items;
}
