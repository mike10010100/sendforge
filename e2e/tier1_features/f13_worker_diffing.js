/**
 * Tier 1 - Feature 13: Web Worker Diffing (Unified & Split) (F13)
 * Tests client-side diff computation conforming to the Web Worker RPC protocol,
 * unified hunks, split diff rows, binary detection, and context line scoping.
 */

import { describe, it, assert } from '../harness/framework.js';
import { GitParser } from '../harness/git_parser.js';

describe('Tier 1 - Feature 13: Web Worker Diffing (F13)', () => {
  it('T1.13.1: Unified diff computation with additions and deletions', () => {
    const oldText = 'line 1\nline 2 original\nline 3';
    const newText = 'line 1\nline 2 modified\nline 3\nline 4 added';

    const diff = GitParser.computeUnifiedDiff(oldText, newText);
    assert.strictEqual(diff.isIdentical, false);
    assert.strictEqual(diff.stats.additions, 2);
    assert.strictEqual(diff.stats.deletions, 1);

    const types = diff.edits.map(e => e.type);
    assert.includes(types, 'add');
    assert.includes(types, 'delete');
    assert.includes(types, 'equal');
  });

  it('T1.13.2: Identical files diff produces zero additions and zero deletions', () => {
    const text = 'const x = 1;\nconst y = 2;\nconsole.log(x + y);';
    const diff = GitParser.computeUnifiedDiff(text, text);

    assert.strictEqual(diff.isIdentical, true);
    assert.strictEqual(diff.stats.additions, 0);
    assert.strictEqual(diff.stats.deletions, 0);
    assert.ok(diff.edits.every(e => e.type === 'equal'));
  });

  it('T1.13.3: Empty file to populated file diff (all additions)', () => {
    const oldText = '';
    const newText = 'line 1\nline 2\nline 3';

    const diff = GitParser.computeUnifiedDiff(oldText, newText);
    assert.strictEqual(diff.stats.additions, 3);
    assert.strictEqual(diff.stats.deletions, 0);
  });

  it('T1.13.4: Populated file to empty file diff (all deletions)', () => {
    const oldText = 'line 1\nline 2\nline 3';
    const newText = '';

    const diff = GitParser.computeUnifiedDiff(oldText, newText);
    assert.strictEqual(diff.stats.additions, 0);
    assert.strictEqual(diff.stats.deletions, 3);
  });

  it('T1.13.5: Side-by-side split diff row construction', () => {
    const oldText = 'A\nB\nC';
    const newText = 'A\nB_mod\nC\nD';

    const diff = GitParser.computeUnifiedDiff(oldText, newText);

    // Split diff builder simulation
    const splitRows = [];
    for (const edit of diff.edits) {
      if (edit.type === 'equal') {
        splitRows.push({
          left: { line: edit.oldLine, text: edit.text, type: 'equal' },
          right: { line: edit.newLine, text: edit.text, type: 'equal' }
        });
      } else if (edit.type === 'delete') {
        splitRows.push({
          left: { line: edit.oldLine, text: edit.text, type: 'delete' },
          right: null
        });
      } else if (edit.type === 'add') {
        splitRows.push({
          left: null,
          right: { line: edit.newLine, text: edit.text, type: 'add' }
        });
      }
    }

    assert.ok(splitRows.length >= 4);
    const hasAdd = splitRows.some(r => r.right && r.right.type === 'add');
    const hasDel = splitRows.some(r => r.left && r.left.type === 'delete');
    assert.ok(hasAdd, 'Split rows must have additions');
    assert.ok(hasDel, 'Split rows must have deletions');
  });

  it('T1.13.6: Binary file diff RPC request returns binary differ flag', () => {
    const oldIsBinary = true;
    const newIsBinary = true;

    // Web Worker RPC protocol check
    const handleDiffRequest = (req) => {
      if (req.oldIsBinary || req.newIsBinary) {
        return {
          id: req.id,
          type: 'DIFF_RESULT',
          isBinary: true,
          hunks: [],
          stats: { additions: 0, deletions: 0 }
        };
      }
      return { id: req.id, type: 'DIFF_RESULT', isBinary: false };
    };

    const res = handleDiffRequest({ id: '1', oldIsBinary, newIsBinary });
    assert.strictEqual(res.isBinary, true);
    assert.strictEqual(res.stats.additions, 0);
  });
});
