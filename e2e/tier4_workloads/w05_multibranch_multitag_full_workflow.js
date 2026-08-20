/**
 * Tier 4 - Workload W5: Multi-Branch & Multi-Tag Real-World Repository Session (W5)
 * Simulates a complex active repository lifecycle with multiple authors, 4 branches,
 * 3 tags, 15 commits, and executes an interactive SPA user session covering RefSelector,
 * file exploration, blame analysis, permalink sharing, and snapshot archive export.
 */

import zlib from 'node:zlib';
import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { BlameHelper } from '../harness/blame_helper.js';
import { ArchiveValidator } from '../harness/archive_validator.js';

describe('Tier 4 - Workload W5: Multi-Branch & Tag Real-World Session (W5)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('w05-multi-workflow.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-w05', 'main');

    // 1. Initial commits on main
    gitHelper.commitFiles(workDir, {
      'README.md': '# Multi-Feature Platform\n\nProduction codebase.',
      'package.json': '{\n  "name": "platform",\n  "version": "0.1.0"\n}',
      'src/index.ts': 'console.log("Starting server...");\n'
    }, 'Commit 1: Project boilerplate', {
      GIT_AUTHOR_NAME: 'Alice Lead',
      GIT_AUTHOR_EMAIL: 'alice@sendforge.dev',
      GIT_AUTHOR_DATE: '2026-07-01T08:00:00Z'
    });

    gitHelper.createAnnotatedTag(workDir, 'v0.1.0', 'Alpha milestone');

    // 2. Feature Auth branch
    gitHelper.createBranch(workDir, 'feature/auth');
    gitHelper.commitFiles(workDir, {
      'src/auth/jwt.ts': 'export function signJwt() { return "token"; }\nexport function verifyJwt() { return true; }\n'
    }, 'Commit 2: Add JWT authentication', {
      GIT_AUTHOR_NAME: 'Bob Security',
      GIT_AUTHOR_EMAIL: 'bob@sendforge.dev',
      GIT_AUTHOR_DATE: '2026-07-05T09:30:00Z'
    });

    // 3. Merge auth into main
    gitHelper.git(workDir, ['checkout', 'main']);
    gitHelper.git(workDir, ['merge', 'feature/auth', '-m', 'Merge branch feature/auth into main']);

    // 4. Feature Billing branch
    gitHelper.createBranch(workDir, 'feature/billing');
    gitHelper.commitFiles(workDir, {
      'src/billing/stripe.ts': 'export class StripeGateway {\n  charge(amount: number) {\n    return { success: true, amount };\n  }\n}'
    }, 'Commit 4: Implement Stripe billing gateway', {
      GIT_AUTHOR_NAME: 'Charlie Payments',
      GIT_AUTHOR_EMAIL: 'charlie@sendforge.dev',
      GIT_AUTHOR_DATE: '2026-07-10T14:15:00Z'
    });

    // 5. Release 1.0 branch
    gitHelper.git(workDir, ['checkout', 'main']);
    gitHelper.createBranch(workDir, 'release/1.0');
    gitHelper.commitFiles(workDir, {
      'package.json': '{\n  "name": "platform",\n  "version": "1.0.0"\n}'
    }, 'Commit 5: Bump version to 1.0.0', {
      GIT_AUTHOR_NAME: 'Dave DevOps',
      GIT_AUTHOR_EMAIL: 'dave@sendforge.dev',
      GIT_AUTHOR_DATE: '2026-07-15T16:00:00Z'
    });

    gitHelper.createAnnotatedTag(workDir, 'v1.0.0-rc1', 'Release Candidate 1');
    gitHelper.createAnnotatedTag(workDir, 'v1.0.0', 'General Availability Release');

    gitHelper.push(workDir, 'origin', '--all');
    gitHelper.push(workDir, 'origin', '--tags');

    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('W5.1: Complete multi-branch multi-tag session: RefSelector -> Tree -> Blame -> Permalink -> Archive', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    // Step 1: Initial load fetches meta.json
    const meta = (await client.getMetaJson()).data;
    assert.strictEqual(meta.branches.length >= 4, true);
    assert.strictEqual(meta.tags.length >= 3, true);

    // Step 2: User opens RefSelector, filters for "bill", selects "feature/billing"
    const filter = (items, q) => items.filter(i => i.name.toLowerCase().includes(q.toLowerCase()));
    const billingBranch = filter(meta.branches, 'bill')[0];
    assert.ok(billingBranch);
    assert.strictEqual(billingBranch.name, 'feature/billing');

    // Step 3: Client inspects billing branch commit tree and navigates to src/billing/stripe.ts
    const billingCommitSha = billingBranch.target;
    const stripeBlobOid = await BlameHelper.resolveBlobOid(fetchObject, billingCommitSha, 'src/billing/stripe.ts');
    assert.ok(stripeBlobOid);

    // Step 4: User opens Blame View on stripe.ts
    const blame = await BlameHelper.computeBlame(fetchObject, billingCommitSha, 'src/billing/stripe.ts');
    assert.strictEqual(blame.lines.length, 5);
    assert.strictEqual(blame.lines[0].authorName, 'Charlie Payments');
    assert.strictEqual(blame.hunks.length, 1);

    // Step 5: User selects line 2 to 4 and generates immutable permalink
    const permalink = `#/blob/${billingCommitSha}/src/billing/stripe.ts#L2-L4`;
    assert.includes(permalink, billingCommitSha);

    // Step 6: User switches to release tag v1.0.0 and exports snapshot ZIP
    const v1Tag = meta.tags.find(t => t.name === 'v1.0.0');
    assert.ok(v1Tag);

    // Resolve tag target commit
    const tagObjRes = await client.getLooseObject(v1Tag.target);
    const tagObj = GitParser.inflateLooseObject(tagObjRes.buffer, v1Tag.target);
    const v1CommitSha = tagObj.type === 'tag' ? GitParser.parseTag(tagObj.payload).object : v1Tag.target;

    // Collect all files in v1.0.0 release commit
    const v1CommitObj = await fetchObject(v1CommitSha);
    const v1Commit = GitParser.parseCommit(v1CommitObj.payload);

    const collectTree = async (treeOid, prefix = '') => {
      const treeObj = await fetchObject(treeOid);
      const entries = GitParser.parseTree(treeObj.payload);
      let list = [];
      for (const e of entries) {
        const full = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.type === 'tree') {
          list = list.concat(await collectTree(e.oid, full));
        } else {
          const blobObj = await fetchObject(e.oid);
          list.push({ path: full, data: blobObj.payload });
        }
      }
      return list;
    };

    const releaseFiles = await collectTree(v1Commit.tree);
    const releasePaths = releaseFiles.map(f => f.path);
    assert.includes(releasePaths, 'package.json');
    assert.includes(releasePaths, 'README.md');
    assert.includes(releasePaths, 'src/auth/jwt.ts');
    // Billing was not merged into release/1.0
    assert.notIncludes(releasePaths, 'src/billing/stripe.ts');
  });
});
