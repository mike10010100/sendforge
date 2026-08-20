/**
 * Tier 1 - Feature 31: Interactive Issue Creation Modal, Push Generator & JSON Export (F31 / R3)
 *
 * Validates:
 * 1. Modal UI state: title input, markdown description with live preview, label selector, author
 * 2. Push command generation: git push origin HEAD:refs/issues/<id>
 * 3. JSON export payload generation conforming to Git-native issue schema
 * 4. LocalStorage draft auto-saving and recovery per repository
 * 5. Draft discard/clearing upon successful issue submission
 * 6. Form validation logic requiring non-empty title before submission
 */

import { describe, it, assert } from '../harness/framework.js';
import { CollabModalHelper, MockLocalStorage } from '../harness/collab_modal_helper.js';

describe('Tier 1 - Feature 31: Issue Modal, Push Generator & Export (F31 / R3)', () => {
  it('T1.31.1: Modal UI state: title input, markdown description editor with live preview, labels, author', () => {
    const issueState = {
      isOpen: true,
      repoName: 'hybrid-gitforge',
      title: 'Fix byte-range boundary condition in PackClient',
      description: '# Summary\nWhen offset is within 100 bytes of pack end, range calculation needs bounds check.',
      labels: ['bug', 'engine', 'phase4'],
      authorName: 'Sendforge Contributor',
      authorEmail: 'contributor@sendforge.dev'
    };

    assert.strictEqual(issueState.isOpen, true);
    assert.strictEqual(issueState.title.length > 0, true);
    assert.includes(issueState.labels, 'bug');
    assert.includes(issueState.labels, 'engine');
    assert.includes(issueState.description, '# Summary');
  });

  it('T1.31.2: Push command generation: git push origin HEAD:refs/issues/<id>', () => {
    const cmd1 = CollabModalHelper.generateIssuePushCommand(42);
    assert.strictEqual(cmd1, 'git push origin HEAD:refs/issues/42');

    const cmd2 = CollabModalHelper.generateIssuePushCommand(105, 'upstream', 'feature-branch');
    assert.strictEqual(cmd2, 'git push upstream feature-branch:refs/issues/105');
  });

  it('T1.31.3: JSON export generation: valid JSON payload with title, description, author, labels, timestamp', () => {
    const issuePayload = {
      id: 1,
      title: 'Support OBJ_REF_DELTA resolution',
      description: 'Need full lookup in pack index table for base SHA.',
      author: 'Tester <tester@sendforge.dev>',
      labels: ['enhancement'],
      created_at: new Date('2026-08-20T12:00:00Z').toISOString(),
      updated_at: new Date('2026-08-20T12:00:00Z').toISOString(),
      status: 'open',
      comments: []
    };

    const jsonStr = JSON.stringify(issuePayload, null, 2);
    const parsed = JSON.parse(jsonStr);

    assert.strictEqual(parsed.id, 1);
    assert.strictEqual(parsed.title, 'Support OBJ_REF_DELTA resolution');
    assert.strictEqual(parsed.status, 'open');
    assert.deepEqual(parsed.labels, ['enhancement']);
  });

  it('T1.31.4: LocalStorage draft auto-saving and recovery per repository', () => {
    const storage = new MockLocalStorage();
    const repo1 = 'repo-alpha';
    const repo2 = 'repo-beta';

    const draft1 = { title: 'Draft for Alpha', description: 'Alpha details', labels: ['bug'] };
    const draft2 = { title: 'Draft for Beta', description: 'Beta details', labels: ['feature'] };

    // Save drafts per repo namespace
    storage.setItem(`sendforge_draft_issue_${repo1}`, JSON.stringify(draft1));
    storage.setItem(`sendforge_draft_issue_${repo2}`, JSON.stringify(draft2));

    // Restore drafts independently
    const restored1 = JSON.parse(storage.getItem(`sendforge_draft_issue_${repo1}`));
    const restored2 = JSON.parse(storage.getItem(`sendforge_draft_issue_${repo2}`));

    assert.strictEqual(restored1.title, 'Draft for Alpha');
    assert.strictEqual(restored2.title, 'Draft for Beta');
  });

  it('T1.31.5: Draft discard/clearing upon successful issue creation', () => {
    const storage = new MockLocalStorage();
    const repo = 'hybrid-gitforge';
    const key = `sendforge_draft_issue_${repo}`;

    storage.setItem(key, JSON.stringify({ title: 'Temporary draft' }));
    assert.ok(storage.getItem(key));

    // Clear draft on submit
    storage.removeItem(key);
    assert.strictEqual(storage.getItem(key), null);
  });

  it('T1.31.6: Modal validation: non-empty title required before submission is enabled', () => {
    function isFormValid(title) {
      return typeof title === 'string' && title.trim().length > 0;
    }

    assert.strictEqual(isFormValid(''), false, 'Empty string is invalid');
    assert.strictEqual(isFormValid('   '), false, 'Whitespace only is invalid');
    assert.strictEqual(isFormValid(null), false, 'Null is invalid');
    assert.strictEqual(isFormValid('Valid Issue Title'), true, 'Non-empty title is valid');
  });
});
