/**
 * Collaboration Modals & Patch Submission Reference Harness
 * Validates push command syntax, format-patch generation,
 * native git am patch ingestion, and localStorage draft lifecycle.
 */

import fs from 'node:fs';
import path from 'node:path';

export class CollabModalHelper {
  /**
   * Generate push command for new issue
   */
  static generateIssuePushCommand(issueId, remote = 'origin', sourceRef = 'HEAD') {
    return `git push ${remote} ${sourceRef}:refs/issues/${issueId}`;
  }

  /**
   * Generate push command for new pull request
   */
  static generatePRPushCommand(prId, sourceBranch, remote = 'origin') {
    return `git push ${remote} ${sourceBranch}:refs/pull/${prId}/head`;
  }

  /**
   * Format commit as standard RFC 2822 git format-patch email
   */
  static formatPatch({
    commitSha,
    authorName,
    authorEmail,
    authorDate,
    subject,
    body = '',
    diffStat = '',
    diffHunks = '',
    patchIndex = 1,
    totalPatches = 1,
    version = 'Sendforge 0.4.0'
  }) {
    const prefix = totalPatches > 1 ? `[PATCH ${patchIndex}/${totalPatches}]` : '[PATCH]';
    const dateStr = authorDate || new Date().toUTCString();

    let patch = `From ${commitSha} Mon Sep 17 00:00:00 2001\n`;
    patch += `From: ${authorName} <${authorEmail}>\n`;
    patch += `Date: ${dateStr}\n`;
    patch += `Subject: ${prefix} ${subject}\n\n`;

    if (body.trim().length > 0) {
      patch += `${body.trim()}\n\n`;
    }

    patch += `---\n`;
    if (diffStat.trim().length > 0) {
      patch += `${diffStat.trim()}\n\n`;
    }

    if (diffHunks.trim().length > 0) {
      patch += `${diffHunks.trim()}\n`;
    }

    patch += `--\n${version}\n`;
    return patch;
  }

  /**
   * Ingest patch via native `git am` to verify standard Git compatibility
   */
  static testGitAmIngestion(gitRepoHelper, workPath, patchText) {
    const tempPatchFile = path.join(workPath, `test_patch_${Date.now()}.patch`);
    fs.writeFileSync(tempPatchFile, patchText, 'utf-8');

    try {
      gitRepoHelper.git(workPath, ['am', tempPatchFile]);
      return true;
    } finally {
      if (fs.existsSync(tempPatchFile)) {
        fs.rmSync(tempPatchFile, { force: true });
      }
    }
  }
}

export class MockLocalStorage {
  constructor(quotaBytes = 5 * 1024 * 1024) {
    this.store = new Map();
    this.quotaBytes = quotaBytes;
  }

  getItem(key) {
    return this.store.get(key) || null;
  }

  setItem(key, value) {
    const strVal = String(value);
    let totalSize = strVal.length;
    for (const [k, v] of this.store.entries()) {
      if (k !== key) totalSize += v.length;
    }
    if (totalSize > this.quotaBytes) {
      const err = new Error('QuotaExceededError: DOM Exception 22');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.store.set(key, strVal);
  }

  removeItem(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  get length() {
    return this.store.size;
  }

  key(index) {
    const keys = Array.from(this.store.keys());
    return keys[index] || null;
  }
}
