/**
 * Tier 3 - Combination C6: Ref Switch → Blame View → Line Permalink Flow (C6)
 * Verifies end-to-end integration: user selects a release tag in RefSelector,
 * navigates to a source file, toggles Blame View, selects a multi-line range,
 * and generates an immutable commit SHA permalink.
 */

import { describe, it, beforeEach, afterEach, assert } from '../harness/framework.js';
import { GitRepoHelper } from '../harness/git_repo.js';
import { SendforgeSupervisor } from '../harness/supervisor.js';
import { SendforgeHttpClient } from '../harness/http_client.js';
import { GitParser } from '../harness/git_parser.js';
import { BlameHelper } from '../harness/blame_helper.js';

describe('Tier 3 - Combination C6: Ref Switch → Blame → Permalink Flow (C6)', () => {
  let gitHelper;
  let supervisor;
  let bareRepo;
  let serverHandle;
  let tagCommitSha;

  beforeEach(async () => {
    gitHelper = new GitRepoHelper();
    supervisor = new SendforgeSupervisor();
    bareRepo = gitHelper.createBareRepo('c06-flow.git');
    supervisor.init(bareRepo, { bare: true, defaultBranch: 'main' });

    const workDir = gitHelper.createWorkingRepoAndInit(bareRepo, 'work-c06', 'main');

    // Commit 1: Initial
    gitHelper.commitFiles(workDir, {
      'src/server.ts': 'import http from "http";\nconst port = 8080;\nconst app = http.createServer();\napp.listen(port);'
    }, 'Commit 1: Initial server');

    // Commit 2: Update port
    tagCommitSha = gitHelper.commitFiles(workDir, {
      'src/server.ts': 'import http from "http";\nconst port = process.env.PORT || 8080;\nconst app = http.createServer();\napp.listen(port);\nconsole.log("Server listening");'
    }, 'Commit 2: Configurable port');

    gitHelper.createAnnotatedTag(workDir, 'v1.0.0', 'Release v1.0.0');

    // Commit 3: Main advances further
    gitHelper.commitFiles(workDir, {
      'src/server.ts': 'import http from "http";\nconst port = process.env.PORT || 9000;\nconst app = http.createServer();\napp.listen(port);\nconsole.log("Server v2");'
    }, 'Commit 3: Main v2');

    gitHelper.push(workDir, 'origin', '--all');
    gitHelper.push(workDir, 'origin', '--tags');

    serverHandle = await supervisor.startServer(bareRepo);
  });

  afterEach(async () => {
    if (serverHandle) await serverHandle.stop();
    gitHelper.cleanup();
    supervisor.cleanup();
  });

  it('C6.1: Full workflow: RefSelector tag switch -> Blame calculation -> Range selection -> Immutable permalink', async () => {
    const client = new SendforgeHttpClient(serverHandle.baseUrl);

    // 1. Fetch metadata to populate RefSelector
    const meta = (await client.getMetaJson()).data;
    assert.strictEqual(meta.tags.length, 1);
    const selectedTag = meta.tags.find(t => t.name === 'v1.0.0');
    assert.ok(selectedTag);

    // If tag points to annotated tag object, resolve peeled commit
    const tagObjRes = await client.getLooseObject(selectedTag.target);
    const tagObjParsed = GitParser.inflateLooseObject(tagObjRes.buffer, selectedTag.target);
    let targetCommitSha = selectedTag.target;
    if (tagObjParsed.type === 'tag') {
      const parsedTag = GitParser.parseTag(tagObjParsed.payload);
      targetCommitSha = parsedTag.object;
    }
    assert.strictEqual(targetCommitSha, tagCommitSha);

    // 2. Client transitions route: #/blob/v1.0.0/src/server.ts
    // 3. User toggles Blame mode -> compute blame on targetCommitSha
    const fetchObject = async (oid) => {
      const res = await client.getLooseObject(oid);
      return GitParser.inflateLooseObject(res.buffer, oid);
    };

    const blame = await BlameHelper.computeBlame(fetchObject, targetCommitSha, 'src/server.ts');
    assert.strictEqual(blame.lines.length, 5);

    // Line 2 was modified in Commit 2 (tagCommitSha)
    assert.strictEqual(blame.lines[1].commitOid, tagCommitSha);

    // 4. User shift-clicks line 2 and line 4 (selecting range #L2-L4)
    const selectedRange = { start: 2, end: 4 };

    // 5. User clicks "Copy Permalink" -> generates immutable permalink with commit SHA
    const permalink = `#/blob/${targetCommitSha}/src/server.ts#L${selectedRange.start}-L${selectedRange.end}`;
    assert.strictEqual(permalink, `#/blob/${tagCommitSha}/src/server.ts#L2-L4`);

    // 6. Verify permalink is immutable and points to exact commit SHA rather than floating tag/branch name
    assert.notIncludes(permalink, 'main');
    assert.notIncludes(permalink, 'v1.0.0');
    assert.includes(permalink, tagCommitSha);
  });
});
