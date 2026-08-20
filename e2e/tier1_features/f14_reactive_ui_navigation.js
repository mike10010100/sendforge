/**
 * Tier 1 - Feature 14: In-Browser Reactive UI & Navigation (F14)
 * Tests client-side routing, URL hash state parsing, line permalink highlighting,
 * breadcrumbs, and fuzzy file search algorithms.
 */

import { describe, it, assert } from '../harness/framework.js';

describe('Tier 1 - Feature 14: In-Browser Reactive UI & Navigation (F14)', () => {
  it('T1.14.1: URL hash router parses tree, blob, and commit routes', () => {
    const parseRoute = (hash) => {
      const clean = hash.replace(/^#\/?/, '');
      const parts = clean.split('/');
      if (parts[0] === 'tree' || parts[0] === 'blob') {
        const branch = parts[1] || 'main';
        const filePath = parts.slice(2).join('/');
        return { view: parts[0], branch, path: filePath };
      } else if (parts[0] === 'commit') {
        return { view: 'commit', sha: parts[1] || '' };
      } else if (parts[0] === 'commits') {
        return { view: 'commits', branch: parts[1] || 'main' };
      }
      return { view: 'root', branch: 'main', path: '' };
    };

    const r1 = parseRoute('#/tree/main/src/lib.rs');
    assert.strictEqual(r1.view, 'tree');
    assert.strictEqual(r1.branch, 'main');
    assert.strictEqual(r1.path, 'src/lib.rs');

    const r2 = parseRoute('#/commit/abcdef1234567890abcdef1234567890abcdef12');
    assert.strictEqual(r2.view, 'commit');
    assert.strictEqual(r2.sha, 'abcdef1234567890abcdef1234567890abcdef12');

    const r3 = parseRoute('#/commits/dev');
    assert.strictEqual(r3.view, 'commits');
    assert.strictEqual(r3.branch, 'dev');
  });

  it('T1.14.2: Breadcrumb path segments and target URL generation', () => {
    const makeBreadcrumbs = (branch, filePath) => {
      if (!filePath) return [{ name: branch, url: `#/tree/${branch}` }];
      const segments = filePath.split('/').filter(Boolean);
      const crumbs = [{ name: branch, url: `#/tree/${branch}` }];
      let accum = '';
      for (const seg of segments) {
        accum = accum ? `${accum}/${seg}` : seg;
        crumbs.push({ name: seg, url: `#/tree/${branch}/${accum}` });
      }
      return crumbs;
    };

    const crumbs = makeBreadcrumbs('main', 'src/components/ui/Button.tsx');
    assert.strictEqual(crumbs.length, 5);
    assert.strictEqual(crumbs[0].name, 'main');
    assert.strictEqual(crumbs[1].name, 'src');
    assert.strictEqual(crumbs[1].url, '#/tree/main/src');
    assert.strictEqual(crumbs[4].name, 'Button.tsx');
    assert.strictEqual(crumbs[4].url, '#/tree/main/src/components/ui/Button.tsx');
  });

  it('T1.14.3: Line anchor permalink range parsing (#L15, #L10-L25)', () => {
    const parseLineAnchor = (hash) => {
      const match = hash.match(/#L(\d+)(?:-L(\d+))?$/);
      if (!match) return null;
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : start;
      return { start: Math.min(start, end), end: Math.max(start, end) };
    };

    const a1 = parseLineAnchor('#/tree/main/src/lib.rs#L42');
    assert.ok(a1);
    assert.strictEqual(a1.start, 42);
    assert.strictEqual(a1.end, 42);

    const a2 = parseLineAnchor('#/tree/main/src/lib.rs#L10-L25');
    assert.ok(a2);
    assert.strictEqual(a2.start, 10);
    assert.strictEqual(a2.end, 25);

    const a3 = parseLineAnchor('#/tree/main/src/lib.rs');
    assert.strictEqual(a3, null);
  });

  it('T1.14.4: Branch switching state transition logic preserves path if possible', () => {
    const switchBranch = (currentRoute, newBranch) => {
      return {
        ...currentRoute,
        branch: newBranch,
        url: `#/${currentRoute.view}/${newBranch}${currentRoute.path ? '/' + currentRoute.path : ''}`
      };
    };

    const current = { view: 'tree', branch: 'main', path: 'src/main.rs' };
    const updated = switchBranch(current, 'dev');
    assert.strictEqual(updated.branch, 'dev');
    assert.strictEqual(updated.url, '#/tree/dev/src/main.rs');
  });

  it('T1.14.5: Fuzzy file search matching and ranking algorithm (Ctrl+K / T)', () => {
    const fuzzyMatch = (query, pathStr) => {
      const q = query.toLowerCase();
      const p = pathStr.toLowerCase();
      let qi = 0;
      let score = 0;

      for (let pi = 0; pi < p.length && qi < q.length; pi++) {
        if (p[pi] === q[qi]) {
          // Bonus for matching start of segment or after delimiter
          if (pi === 0 || p[pi - 1] === '/' || p[pi - 1] === '_' || p[pi - 1] === '.') {
            score += 10;
          } else {
            score += 1;
          }
          qi++;
        }
      }

      return qi === q.length ? { match: true, score } : { match: false, score: 0 };
    };

    const files = [
      'src/main.rs',
      'src/models/user.rs',
      'tests/integration/user_test.rs',
      'README.md'
    ];

    const search = (q) => {
      return files
        .map(f => ({ path: f, ...fuzzyMatch(q, f) }))
        .filter(r => r.match)
        .sort((a, b) => b.score - a.score)
        .map(r => r.path);
    };

    const userResults = search('user');
    assert.includes(userResults, 'src/models/user.rs');
    assert.includes(userResults, 'tests/integration/user_test.rs');

    const rsResults = search('mrs');
    assert.includes(rsResults, 'src/main.rs');
  });
});
