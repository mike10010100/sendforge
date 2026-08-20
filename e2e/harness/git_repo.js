/**
 * Git Repository Generator & Manipulator Helper
 * Generates synthetic bare repos, working copies, commits, branches, tags,
 * merges, corrupt objects, and special file structures.
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class GitRepoHelper {
  constructor(tempRootDir) {
    this.tempRootDir = tempRootDir || fs.mkdtempSync(path.join('/tmp', 'sendforge-test-'));
  }

  getRootDir() {
    return this.tempRootDir;
  }

  cleanup() {
    try {
      if (fs.existsSync(this.tempRootDir)) {
        fs.rmSync(this.tempRootDir, { recursive: true, force: true });
      }
    } catch (e) {
      // Ignore cleanup error
    }
  }

  /**
   * Run git command inside a directory with deterministic config
   */
  git(cwd, args, env = {}) {
    const targetDebug = path.resolve(__dirname, '../../target/debug');
    const targetRelease = path.resolve(__dirname, '../../target/release');
    const augmentedPath = `${targetDebug}:${targetRelease}:${process.env.PATH || ''}`;

    const defaultEnv = {
      ...process.env,
      PATH: augmentedPath,
      SENDFORGE_BIN: path.join(targetDebug, 'sendforge'),
      GIT_AUTHOR_NAME: 'Sendforge Tester',
      GIT_AUTHOR_EMAIL: 'tester@sendforge.dev',
      GIT_AUTHOR_DATE: '2026-08-19T20:00:00Z',
      GIT_COMMITTER_NAME: 'Sendforge Committer',
      GIT_COMMITTER_EMAIL: 'committer@sendforge.dev',
      GIT_COMMITTER_DATE: '2026-08-19T20:00:00Z',
      ...env
    };

    const res = spawnSync('git', args, {
      cwd,
      env: defaultEnv,
      encoding: 'utf-8'
    });

    if (res.status !== 0) {
      const err = new Error(`git ${args.join(' ')} failed with code ${res.status}:\n${res.stderr}\n${res.stdout}`);
      err.stdout = res.stdout;
      err.stderr = res.stderr;
      err.status = res.status;
      throw err;
    }
    return res.stdout.trim();
  }

  /**
   * Initialize a native bare Git repository
   */
  createBareRepo(repoName = 'test-repo.git', defaultBranch = 'main') {
    const repoPath = path.isAbsolute(repoName) ? repoName : path.join(this.tempRootDir, repoName);
    fs.mkdirSync(repoPath, { recursive: true });
    this.git(repoPath, ['init', '--bare', `--initial-branch=${defaultBranch}`]);
    this.git(repoPath, ['config', 'receive.unpackLimit', '10000']);
    this.git(repoPath, ['config', 'transfer.unpackLimit', '10000']);
    this.git(repoPath, ['config', 'http.receivepack', 'true']);
    this.git(repoPath, ['config', 'http.uploadpack', 'true']);
    return repoPath;
  }

  /**
   * Create a working clone from a bare repo
   */
  createWorkingRepo(bareRepoPath, cloneName = 'workdir') {
    const workPath = path.isAbsolute(cloneName) ? cloneName : path.join(this.tempRootDir, cloneName);
    this.git(this.tempRootDir, ['clone', bareRepoPath, workPath]);
    this.git(workPath, ['config', 'user.name', 'Sendforge Tester']);
    this.git(workPath, ['config', 'user.email', 'tester@sendforge.dev']);
    return workPath;
  }

  /**
   * Initialize an empty working directory, commit files, and push to bare repo
   */
  createWorkingRepoAndInit(bareRepoPath, workDirName = 'workdir', defaultBranch = 'main') {
    const workPath = path.isAbsolute(workDirName) ? workDirName : path.join(this.tempRootDir, workDirName);
    fs.mkdirSync(workPath, { recursive: true });
    this.git(workPath, ['init', `--initial-branch=${defaultBranch}`]);
    this.git(workPath, ['config', 'user.name', 'Sendforge Tester']);
    this.git(workPath, ['config', 'user.email', 'tester@sendforge.dev']);
    this.git(workPath, ['remote', 'add', 'origin', bareRepoPath]);
    return workPath;
  }

  /**
   * Commit a map of files to a working directory
   * files: { "README.md": "# Hello", "src/main.rs": "fn main() {}" }
   */
  commitFiles(workPath, files, commitMsg = 'Add files', envOverrides = {}) {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = path.join(workPath, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      if (Buffer.isBuffer(content)) {
        fs.writeFileSync(fullPath, content);
      } else {
        fs.writeFileSync(fullPath, String(content), 'utf-8');
      }
    }

    this.git(workPath, ['add', '-A']);
    this.git(workPath, ['commit', '-m', commitMsg], envOverrides);
    return this.git(workPath, ['rev-parse', 'HEAD']);
  }

  /**
   * Push branch or all refs to remote
   */
  push(workPath, remote = 'origin', refspec = 'main', options = []) {
    return this.git(workPath, ['push', remote, refspec, ...options]);
  }

  /**
   * Create a new branch in working copy
   */
  createBranch(workPath, branchName, checkout = true) {
    if (checkout) {
      this.git(workPath, ['checkout', '-b', branchName]);
    } else {
      this.git(workPath, ['branch', branchName]);
    }
  }

  /**
   * Create an annotated tag
   */
  createAnnotatedTag(workPath, tagName, message = `Release ${tagName}`, target = 'HEAD') {
    this.git(workPath, ['tag', '-a', tagName, '-m', message, target]);
    return this.git(workPath, ['rev-parse', tagName]);
  }

  /**
   * Create a lightweight tag
   */
  createLightweightTag(workPath, tagName, target = 'HEAD') {
    this.git(workPath, ['tag', tagName, target]);
    return this.git(workPath, ['rev-parse', tagName]);
  }

  /**
   * Create an Octopus Merge with 3+ parent branches
   */
  createOctopusMerge(workPath, baseBranch, featureBranches, mergeMsg = 'Octopus merge') {
    this.git(workPath, ['checkout', baseBranch]);
    this.git(workPath, ['merge', ...featureBranches, '-m', mergeMsg]);
    return this.git(workPath, ['rev-parse', 'HEAD']);
  }

  /**
   * Generate a deeply nested directory tree (e.g. 55 levels deep)
   */
  createDeepNestedTree(workPath, depth = 55, filename = 'deep_file.txt', content = 'deep content') {
    let currentRel = '';
    for (let i = 1; i <= depth; i++) {
      currentRel = path.join(currentRel, `level_${i}`);
    }
    const relFilePath = path.join(currentRel, filename);
    return this.commitFiles(workPath, { [relFilePath]: content }, `Deep tree commit depth=${depth}`);
  }

  /**
   * Generate a large file blob (e.g., 10 MB)
   */
  createLargeFile(workPath, filename = 'large_payload.bin', sizeBytes = 10 * 1024 * 1024) {
    const filePath = path.join(workPath, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const buffer = Buffer.alloc(sizeBytes, 'A');
    fs.writeFileSync(filePath, buffer);
    this.git(workPath, ['add', filename]);
    this.git(workPath, ['commit', '-m', `Add large file (${sizeBytes} bytes)`]);
    return this.git(workPath, ['rev-parse', 'HEAD']);
  }

  /**
   * Read loose object directly from bare repo, decompressing zlib
   */
  readLooseObject(bareRepoPath, oid) {
    const objPath = path.join(bareRepoPath, 'objects', oid.slice(0, 2), oid.slice(2));
    if (!fs.existsSync(objPath)) {
      throw new Error(`Git loose object not found: ${objPath}`);
    }
    const compressed = fs.readFileSync(objPath);
    const decompressed = zlib.inflateSync(compressed);
    const nullIdx = decompressed.indexOf(0);
    const header = decompressed.subarray(0, nullIdx).toString('utf-8');
    const [type, sizeStr] = header.split(' ');
    const size = parseInt(sizeStr, 10);
    const payload = decompressed.subarray(nullIdx + 1);
    return { type, size, payload, raw: decompressed };
  }

  /**
   * Write a raw loose object into bare repository
   */
  writeLooseObject(bareRepoPath, type, contentBuffer) {
    const header = Buffer.from(`${type} ${contentBuffer.length}\0`);
    const fullObject = Buffer.concat([header, contentBuffer]);
    const oid = crypto.createHash('sha1').update(fullObject).digest('hex');
    const compressed = zlib.deflateSync(fullObject);

    const dirPath = path.join(bareRepoPath, 'objects', oid.slice(0, 2));
    fs.mkdirSync(dirPath, { recursive: true });
    const filePath = path.join(dirPath, oid.slice(2));
    fs.writeFileSync(filePath, compressed);
    return oid;
  }

  /**
   * Artificially corrupt a loose object in bare repository
   */
  corruptLooseObject(bareRepoPath, oid, corruptionType = 'zlib_corrupt') {
    const objPath = path.join(bareRepoPath, 'objects', oid.slice(0, 2), oid.slice(2));
    if (!fs.existsSync(objPath)) {
      throw new Error(`Cannot corrupt missing object: ${objPath}`);
    }

    // Git objects are read-only (0444) by default, ensure writable
    try {
      fs.chmodSync(objPath, 0o666);
    } catch (e) {}

    if (corruptionType === 'zlib_corrupt') {
      // Overwrite first few bytes with invalid zlib magic
      const buf = fs.readFileSync(objPath);
      buf[0] = 0xFF;
      buf[1] = 0xFF;
      fs.writeFileSync(objPath, buf);
    } else if (corruptionType === 'sha1_mismatch') {
      // Decompress, modify payload, recompress without renaming the file (causing hash mismatch)
      const compressed = fs.readFileSync(objPath);
      const decompressed = zlib.inflateSync(compressed);
      decompressed[decompressed.length - 1] = (decompressed[decompressed.length - 1] + 1) % 255;
      const recompressed = zlib.deflateSync(decompressed);
      fs.writeFileSync(objPath, recompressed);
    } else if (corruptionType === 'truncate') {
      const buf = fs.readFileSync(objPath);
      fs.writeFileSync(objPath, buf.subarray(0, Math.max(1, Math.floor(buf.length / 2))));
    }
  }

  /**
   * Create a native Git Pull Request reference set:
   * - refs/pull/<id>/head -> commit SHA of head
   * - refs/pull/<id>/meta -> blob object containing JSON metadata
   */
  createPullRequest(repoPath, prData) {
    const id = String(prData.id || prData.number || '1');
    const number = Number(prData.number || id);
    const headCommit = prData.head_commit || prData.headCommit;

    if (!headCommit) {
      throw new Error('createPullRequest requires head_commit / headCommit SHA');
    }

    const normalizedData = {
      id,
      number,
      title: prData.title || `PR #${id}`,
      description: prData.description || '',
      author: prData.author || { name: 'Sendforge Tester', email: 'tester@sendforge.dev' },
      target_branch: prData.target_branch || prData.targetBranch || 'main',
      source_branch: prData.source_branch || prData.sourceBranch || `feature/pr-${id}`,
      head_commit: headCommit,
      status: prData.status || 'open',
      created_at: prData.created_at || prData.createdAt || Math.floor(Date.now() / 1000),
      updated_at: prData.updated_at || prData.updatedAt || Math.floor(Date.now() / 1000),
      labels: prData.labels || [],
      comments: prData.comments || []
    };

    // Write metadata blob object into loose objects
    const jsonBuf = Buffer.from(JSON.stringify(normalizedData, null, 2), 'utf-8');
    const metaOid = this.writeLooseObject(repoPath, 'blob', jsonBuf);

    // Update refs in repository
    this.git(repoPath, ['update-ref', `refs/pull/${id}/head`, headCommit]);
    this.git(repoPath, ['update-ref', `refs/pull/${id}/meta`, metaOid]);

    return {
      id,
      number,
      headSha: headCommit,
      metaOid,
      refHead: `refs/pull/${id}/head`,
      refMeta: `refs/pull/${id}/meta`,
      data: normalizedData
    };
  }

  /**
   * Create a native Git Issue reference:
   * - refs/issues/<id> -> blob object containing JSON metadata
   */
  createIssue(repoPath, issueData) {
    const id = String(issueData.id || issueData.number || '1');
    const number = Number(issueData.number || id);

    const normalizedData = {
      id,
      number,
      title: issueData.title || `Issue #${id}`,
      description: issueData.description || '',
      author: issueData.author || { name: 'Sendforge Tester', email: 'tester@sendforge.dev' },
      status: issueData.status || 'open',
      created_at: issueData.created_at || issueData.createdAt || Math.floor(Date.now() / 1000),
      updated_at: issueData.updated_at || issueData.updatedAt || Math.floor(Date.now() / 1000),
      labels: issueData.labels || [],
      comments: issueData.comments || []
    };

    const jsonBuf = Buffer.from(JSON.stringify(normalizedData, null, 2), 'utf-8');
    const metaOid = this.writeLooseObject(repoPath, 'blob', jsonBuf);

    this.git(repoPath, ['update-ref', `refs/issues/${id}`, metaOid]);

    return {
      id,
      number,
      metaOid,
      refName: `refs/issues/${id}`,
      data: normalizedData
    };
  }

  /**
   * Attach a review note to a commit under refs/notes/reviews
   */
  attachReviewNote(repoPath, commitSha, noteData) {
    const jsonStr = typeof noteData === 'string' ? noteData : JSON.stringify(noteData);
    try {
      this.git(repoPath, ['notes', '--ref=reviews', 'add', '-f', '-m', jsonStr, commitSha]);
    } catch (e) {
      // In case git notes requires an existing tree, create loose blob and ref
      const noteBlob = this.writeLooseObject(repoPath, 'blob', Buffer.from(jsonStr, 'utf-8'));
      this.git(repoPath, ['update-ref', 'refs/notes/reviews', noteBlob]);
    }
  }

  /**
   * Create synthetic DAG topologies for merge-base testing
   */
  createMergeBaseTopology(workPath, topologyType, options = {}) {
    const defaultBranch = options.defaultBranch || 'main';

    if (topologyType === 'simple_fork') {
      const baseSha = this.commitFiles(workPath, { 'base.txt': 'base content' }, 'Base commit');
      this.createBranch(workPath, 'feature', true);
      this.commitFiles(workPath, { 'feature.txt': 'feature 1' }, 'Feature commit 1');
      const f2Sha = this.commitFiles(workPath, { 'feature.txt': 'feature 1\nfeature 2' }, 'Feature commit 2');
      this.git(workPath, ['checkout', defaultBranch]);
      const mainTip = this.commitFiles(workPath, { 'main.txt': 'main advance' }, 'Main advance commit');
      return { baseSha, mainTip, featureTip: f2Sha, lca: baseSha };
    }

    if (topologyType === 'divergent') {
      const baseSha = this.commitFiles(workPath, { 'common.txt': 'common line 1\ncommon line 2' }, 'Base commit');
      this.createBranch(workPath, 'feature', true);
      this.commitFiles(workPath, { 'feature.txt': 'feat A' }, 'Feat A');
      this.commitFiles(workPath, { 'feature.txt': 'feat A\nfeat B' }, 'Feat B');
      const featureTip = this.commitFiles(workPath, { 'feature.txt': 'feat A\nfeat B\nfeat C' }, 'Feat C');

      this.git(workPath, ['checkout', defaultBranch]);
      this.commitFiles(workPath, { 'main.txt': 'main 1' }, 'Main 1');
      const mainTip = this.commitFiles(workPath, { 'main.txt': 'main 1\nmain 2' }, 'Main 2');
      return { baseSha, mainTip, featureTip, lca: baseSha };
    }

    if (topologyType === 'fast_forward') {
      const baseSha = this.commitFiles(workPath, { 'ff.txt': 'init' }, 'Initial commit');
      this.createBranch(workPath, 'feature', true);
      this.commitFiles(workPath, { 'ff.txt': 'init\nstep 1' }, 'Step 1');
      const featureTip = this.commitFiles(workPath, { 'ff.txt': 'init\nstep 1\nstep 2' }, 'Step 2');
      this.git(workPath, ['checkout', defaultBranch]);
      return { baseSha, mainTip: baseSha, featureTip, lca: baseSha };
    }

    if (topologyType === 'criss_cross') {
      const rootSha = this.commitFiles(workPath, { 'root.txt': 'root' }, 'Root commit');
      this.createBranch(workPath, 'branch-a', true);
      const a1Sha = this.commitFiles(workPath, { 'file_a.txt': 'a1' }, 'Commit A1');

      this.git(workPath, ['checkout', defaultBranch]);
      this.createBranch(workPath, 'branch-b', true);
      const b1Sha = this.commitFiles(workPath, { 'file_b.txt': 'b1' }, 'Commit B1');

      // Merge B into A
      this.git(workPath, ['checkout', 'branch-a']);
      this.git(workPath, ['merge', 'branch-b', '-m', 'Merge B into A (A2)']);
      const a2Sha = this.git(workPath, ['rev-parse', 'HEAD']);

      // Merge A into B
      this.git(workPath, ['checkout', 'branch-b']);
      this.git(workPath, ['merge', 'branch-a', '-m', 'Merge A into B (B2)']);
      const b2Sha = this.git(workPath, ['rev-parse', 'HEAD']);

      // Further commits on A and B
      this.git(workPath, ['checkout', 'branch-a']);
      const a3Sha = this.commitFiles(workPath, { 'file_a.txt': 'a1\na3' }, 'Commit A3');

      this.git(workPath, ['checkout', 'branch-b']);
      const b3Sha = this.commitFiles(workPath, { 'file_b.txt': 'b1\nb3' }, 'Commit B3');

      return { rootSha, a1Sha, b1Sha, a2Sha, b2Sha, branchASha: a3Sha, branchBSha: b3Sha, candidates: [a2Sha, b2Sha] };
    }

    if (topologyType === 'orphan') {
      const rootSha = this.commitFiles(workPath, { 'main.txt': 'main only' }, 'Main root commit');
      this.git(workPath, ['checkout', '--orphan', 'orphan-branch']);
      this.git(workPath, ['rm', '-rf', '.']);
      const orphanTip = this.commitFiles(workPath, { 'orphan.txt': 'orphan only' }, 'Orphan root commit');
      this.git(workPath, ['checkout', defaultBranch]);
      return { mainTip: rootSha, featureTip: orphanTip, lca: null };
    }

    if (topologyType === 'linear_chain') {
      const count = options.count || 20;
      let lastSha = null;
      let forkSha = null;
      const forkAt = options.forkAt || Math.floor(count / 2);

      for (let i = 1; i <= count; i++) {
        lastSha = this.commitFiles(workPath, { 'chain.txt': `Line ${i}` }, `Chain commit ${i}`);
        if (i === forkAt) {
          forkSha = lastSha;
        }
      }

      this.git(workPath, ['checkout', '-b', 'feature-chain', forkSha]);
      const featureTip = this.commitFiles(workPath, { 'feature_chain.txt': 'feature work' }, 'Feature on chain');
      this.git(workPath, ['checkout', defaultBranch]);

      return { baseSha: forkSha, mainTip: lastSha, featureTip, lca: forkSha, totalCommits: count };
    }

    throw new Error(`Unknown topology type: ${topologyType}`);
  }
}
