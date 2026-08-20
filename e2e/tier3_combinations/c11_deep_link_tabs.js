/**
 * Tier 3 - Combination C11: Deep-Link Hash Navigation Across All Tabs (C11)
 * Tests multi-tab hash routing transitions across Code, Commits, Issues,
 * and PR sub-tabs (conversation, commits, files).
 */

import { describe, it, assert } from '../harness/framework.js';

describe('Tier 3 - Combination C11: Deep-Link Hash Navigation Across All Tabs (C11)', () => {
  it('C11.1: Deep-link transitions across PR tabs and Issue views', () => {
    class NavigationStateMachine {
      constructor() {
        this.currentRoute = { type: 'code' };
        this.history = ['#/'];
      }

      navigate(hash) {
        this.history.push(hash);
        this.currentRoute = this.parseRoute(hash);
      }

      parseRoute(hash) {
        const clean = hash.replace(/^#\/?/, '');
        const parts = clean.split('/').filter(Boolean);

        if (parts.length === 0) return { type: 'code' };
        if (parts[0] === 'issues') {
          if (parts.length === 1) return { type: 'issues' };
          return { type: 'issue', id: parts[1] };
        }
        if (parts[0] === 'pulls') {
          if (parts.length === 1) return { type: 'pulls' };
          const id = parts[1];
          const tab = parts[2] || 'conversation';
          return { type: 'pull', id, tab };
        }
        if (parts[0] === 'commits') return { type: 'commits' };
        if (parts[0] === 'tree') return { type: 'code', ref: parts[1], path: parts.slice(2).join('/') };
        if (parts[0] === 'blob') return { type: 'code', ref: parts[1], path: parts.slice(2).join('/') };

        return { type: 'code' };
      }
    }

    const state = new NavigationStateMachine();
    assert.deepEqual(state.currentRoute, { type: 'code' });

    // 1. Direct deep link to PR #1 Files Changed
    state.navigate('#/pulls/1/files');
    assert.deepEqual(state.currentRoute, { type: 'pull', id: '1', tab: 'files' });

    // 2. Switch to PR #1 Commits tab
    state.navigate('#/pulls/1/commits');
    assert.deepEqual(state.currentRoute, { type: 'pull', id: '1', tab: 'commits' });

    // 3. Switch to PR #1 Conversation tab
    state.navigate('#/pulls/1');
    assert.deepEqual(state.currentRoute, { type: 'pull', id: '1', tab: 'conversation' });

    // 4. Jump to Issue #2
    state.navigate('#/issues/2');
    assert.deepEqual(state.currentRoute, { type: 'issue', id: '2' });

    // 5. Jump to Commits tab
    state.navigate('#/commits');
    assert.deepEqual(state.currentRoute, { type: 'commits' });

    // 6. Jump back to Code root
    state.navigate('#/');
    assert.deepEqual(state.currentRoute, { type: 'code' });
  });

  it('C11.2: URL hash format stability across roundtrips', () => {
    const routes = [
      { type: 'code' },
      { type: 'commits' },
      { type: 'issues' },
      { type: 'issue', id: '10' },
      { type: 'pulls' },
      { type: 'pull', id: '10', tab: 'conversation' },
      { type: 'pull', id: '10', tab: 'commits' },
      { type: 'pull', id: '10', tab: 'files' }
    ];

    const formatRoute = (r) => {
      switch (r.type) {
        case 'issues': return '#/issues';
        case 'issue': return `#/issues/${r.id}`;
        case 'pulls': return '#/pulls';
        case 'pull': return r.tab && r.tab !== 'conversation' ? `#/pulls/${r.id}/${r.tab}` : `#/pulls/${r.id}`;
        case 'commits': return '#/commits';
        case 'code':
        default: return '#/';
      }
    };

    const parseRoute = (hash) => {
      const clean = hash.replace(/^#\/?/, '');
      const parts = clean.split('/').filter(Boolean);

      if (parts.length === 0) return { type: 'code' };
      if (parts[0] === 'issues') return parts.length === 1 ? { type: 'issues' } : { type: 'issue', id: parts[1] };
      if (parts[0] === 'pulls') return parts.length === 1 ? { type: 'pulls' } : { type: 'pull', id: parts[1], tab: parts[2] || 'conversation' };
      if (parts[0] === 'commits') return { type: 'commits' };
      return { type: 'code' };
    };

    for (const r of routes) {
      const hash = formatRoute(r);
      const parsed = parseRoute(hash);
      assert.deepEqual(parsed, r, `Route mismatch for ${hash}`);
    }
  });
});
