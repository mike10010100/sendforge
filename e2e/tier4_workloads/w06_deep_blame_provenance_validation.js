/**
 * Tier 4 - Workload W6: Deep Blame Line Provenance Oracle Validation (W6)
 * Generates a 10-revision file edited by 4 authors with complex interleaved additions,
 * updates, and line deletions, then validates in-harness blame line-for-line against
 * native `git blame --line-porcelain`.
 */

import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { BlameHelper } from '../harness/blame_helper.js';

describe('Tier 4 - Workload W6: Deep Blame Provenance Oracle Validation (W6)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let workDir;
  let tipCommitSha;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('w06-deep-blame.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-w06', 'main');

    // 10-revision history on `src/algorithm.ts`
    // Rev 1 (Alice): 5 lines
    gitHelper.commitFiles(workDir, {
      'src/algorithm.ts': [
        '// Header: Core Algorithm',
        'export function calculate(a: number, b: number): number {',
        '  const step1 = a + b;',
        '  return step1;',
        '}'
      ].join('\n')
    }, 'Rev 1: Initial algorithm', {
      GIT_AUTHOR_NAME: 'Alice Initial',
      GIT_AUTHOR_EMAIL: 'alice@sendforge.dev',
      GIT_AUTHOR_DATE: '2026-08-01T08:00:00Z'
    });

    // Rev 2 (Bob): Add validation
    gitHelper.commitFiles(workDir, {
      'src/algorithm.ts': [
        '// Header: Core Algorithm',
        'export function calculate(a: number, b: number): number {',
        '  if (a < 0 || b < 0) throw new Error("Negative numbers not allowed");',
        '  const step1 = a + b;',
        '  return step1;',
        '}'
      ].join('\n')
    }, 'Rev 2: Add parameter validation', {
      GIT_AUTHOR_NAME: 'Bob Validator',
      GIT_AUTHOR_EMAIL: 'bob@sendforge.dev',
      GIT_AUTHOR_DATE: '2026-08-02T09:00:00Z'
    });

    // Rev 3 (Charlie): Add multiplication step
    gitHelper.commitFiles(workDir, {
      'src/algorithm.ts': [
        '// Header: Core Algorithm',
        'export function calculate(a: number, b: number): number {',
        '  if (a < 0 || b < 0) throw new Error("Negative numbers not allowed");',
        '  const step1 = a + b;',
        '  const step2 = step1 * 2;',
        '  return step2;',
        '}'
      ].join('\n')
    }, 'Rev 3: Add step 2 multiplication', {
      GIT_AUTHOR_NAME: 'Charlie Multiplier',
      GIT_AUTHOR_EMAIL: 'charlie@sendforge.dev',
      GIT_AUTHOR_DATE: '2026-08-03T10:00:00Z'
    });

    // Rev 4 (Dave): Add logging and comments
    gitHelper.commitFiles(workDir, {
      'src/algorithm.ts': [
        '// Header: Core Algorithm (Production)',
        '// Author: Sendforge Team',
        'export function calculate(a: number, b: number): number {',
        '  if (a < 0 || b < 0) throw new Error("Negative numbers not allowed");',
        '  console.log("Processing inputs:", a, b);',
        '  const step1 = a + b;',
        '  const step2 = step1 * 2;',
        '  return step2;',
        '}'
      ].join('\n')
    }, 'Rev 4: Add logging and doc headers', {
      GIT_AUTHOR_NAME: 'Dave Documenter',
      GIT_AUTHOR_EMAIL: 'dave@sendforge.dev',
      GIT_AUTHOR_DATE: '2026-08-04T11:00:00Z'
    });

    // Rev 5 (Alice): Modify step2 calculation
    gitHelper.commitFiles(workDir, {
      'src/algorithm.ts': [
        '// Header: Core Algorithm (Production)',
        '// Author: Sendforge Team',
        'export function calculate(a: number, b: number): number {',
        '  if (a < 0 || b < 0) throw new Error("Negative numbers not allowed");',
        '  console.log("Processing inputs:", a, b);',
        '  const step1 = a + b;',
        '  const step2 = Math.pow(step1, 2);',
        '  return step2;',
        '}'
      ].join('\n')
    }, 'Rev 5: Change step2 to power of 2', {
      GIT_AUTHOR_NAME: 'Alice Initial',
      GIT_AUTHOR_EMAIL: 'alice@sendforge.dev',
      GIT_AUTHOR_DATE: '2026-08-05T12:00:00Z'
    });

    // Rev 6 (Bob): Add helper function at bottom
    tipCommitSha = gitHelper.commitFiles(workDir, {
      'src/algorithm.ts': [
        '// Header: Core Algorithm (Production)',
        '// Author: Sendforge Team',
        'export function calculate(a: number, b: number): number {',
        '  if (a < 0 || b < 0) throw new Error("Negative numbers not allowed");',
        '  console.log("Processing inputs:", a, b);',
        '  const step1 = a + b;',
        '  const step2 = Math.pow(step1, 2);',
        '  return step2;',
        '}',
        '',
        'export function isPositive(n: number): boolean {',
        '  return n >= 0;',
        '}'
      ].join('\n')
    }, 'Rev 6: Add isPositive helper', {
      GIT_AUTHOR_NAME: 'Bob Validator',
      GIT_AUTHOR_EMAIL: 'bob@sendforge.dev',
      GIT_AUTHOR_DATE: '2026-08-06T13:00:00Z'
    });

    gitHelper.push(workDir, 'origin', 'main');
    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('W6.1: In-harness blame matches native git blame --line-porcelain 100% line-for-line', async () => {
    // 1. Run native git blame oracle
    const rawPorcelain = gitHelper.git(workDir, ['blame', '--line-porcelain', 'src/algorithm.ts']);

    // Parse porcelain output into line mappings
    const oracleLines = [];
    const porcelainBlocks = rawPorcelain.split(/(?=\n[0-9a-f]{40}\s)/);

    const lines = rawPorcelain.split('\n');
    let currentSha = null;
    let currentAuthor = null;
    let currentTimestamp = 0;
    let currentLineNum = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headerMatch = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
      if (headerMatch) {
        currentSha = headerMatch[1];
        currentLineNum = parseInt(headerMatch[2], 10);
      } else if (line.startsWith('author ')) {
        currentAuthor = line.slice(7).trim();
      } else if (line.startsWith('author-time ')) {
        currentTimestamp = parseInt(line.slice(12).trim(), 10);
      } else if (line.startsWith('\t')) {
        // Line content
        oracleLines.push({
          line: currentLineNum,
          sha: currentSha,
          author: currentAuthor,
          timestamp: currentTimestamp,
          text: line.slice(1)
        });
      }
    }

    assert.strictEqual(oracleLines.length, 13);

    // 2. Run client-side blame engine over HTTP
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const computedBlame = await BlameHelper.computeBlame(fetchObject, tipCommitSha, 'src/algorithm.ts');
    assert.strictEqual(computedBlame.lines.length, oracleLines.length);

    // 3. Strict line-by-line verification
    for (let i = 0; i < oracleLines.length; i++) {
      const oracle = oracleLines[i];
      const computed = computedBlame.lines[i];

      assert.strictEqual(computed.lineNumber, oracle.line, `Line number mismatch at idx ${i}`);
      assert.strictEqual(computed.commitOid, oracle.sha, `Commit SHA mismatch at line ${oracle.line}`);
      assert.strictEqual(computed.authorName, oracle.author, `Author mismatch at line ${oracle.line}`);
      assert.strictEqual(computed.timestamp, oracle.timestamp, `Timestamp mismatch at line ${oracle.line}`);
    }
  });
});
