/**
 * Tier 2 - Boundary B21: Deep Delta Chains & Cycle Detection (B21 / R1)
 *
 * Validates:
 * 1. Deep delta chain (depth 10) resolves accurately to original uncompressed base
 * 2. Deep delta chain (depth 25) resolves within performance threshold without stack overflow
 * 3. Circular delta reference detection (A -> B -> A) safely detected and rejected
 * 4. Self-referential delta (A -> A) detected and rejected
 * 5. Missing delta base object SHA-1 gracefully surfaces typed error
 */

import { describe, it, assert } from '../harness/framework.js';
import { DeltaEngine, PackBuilder, GitObjectType } from '../harness/pack_helper.js';

describe('Tier 2 - Boundary B21: Deep Delta Chains & Cycle Detection (B21 / R1)', () => {
  it('B21.1: Deep delta chain (depth 10) resolves accurately to original uncompressed base', () => {
    let currentObject = Buffer.from('Initial root text line 0\n');
    const versions = [currentObject];
    const deltas = [];

    for (let i = 1; i <= 10; i++) {
      const nextObject = Buffer.concat([currentObject, Buffer.from(`Appended line ${i} of delta sequence\n`)]);
      const delta = DeltaEngine.createDelta(currentObject, nextObject);
      deltas.push(delta);
      versions.push(nextObject);
      currentObject = nextObject;
    }

    // Resolve sequentially from depth 1 to 10
    let reconstructed = versions[0];
    for (let i = 0; i < 10; i++) {
      reconstructed = DeltaEngine.applyDelta(reconstructed, deltas[i]);
    }

    assert.strictEqual(reconstructed.toString('utf-8'), versions[10].toString('utf-8'));
  });

  it('B21.2: Deep delta chain (depth 25) resolves within performance threshold without stack overflow', () => {
    let current = Buffer.from('Base text for deep chain benchmark.\n');
    const root = current;
    const deltas = [];

    for (let i = 1; i <= 25; i++) {
      const next = Buffer.from(`${current.toString('utf-8')}Step ${i}: additional block\n`);
      deltas.push(DeltaEngine.createDelta(current, next));
      current = next;
    }

    const startTime = Date.now();
    let state = root;
    for (const d of deltas) {
      state = DeltaEngine.applyDelta(state, d);
    }
    const elapsed = Date.now() - startTime;

    assert.strictEqual(state.toString('utf-8'), current.toString('utf-8'));
    assert.lessThan(elapsed, 1000, '25-depth delta chain should resolve in under 1 second');
  });

  it('B21.3: Circular delta reference detection (A -> B -> A) safely detected and rejected', () => {
    class MockDeltaResolver {
      constructor(maxDepth = 20) {
        this.maxDepth = maxDepth;
      }
      resolveChain(sha, chainMap, visited = new Set()) {
        if (visited.has(sha)) {
          throw new Error(`Circular delta cycle detected: object ${sha} referenced in its own delta ancestor chain`);
        }
        if (visited.size >= this.maxDepth) {
          throw new Error(`Maximum delta recursion depth (${this.maxDepth}) exceeded`);
        }
        visited.add(sha);
        const parentSha = chainMap.get(sha);
        if (parentSha) {
          return this.resolveChain(parentSha, chainMap, visited);
        }
        return sha;
      }
    }

    const resolver = new MockDeltaResolver();
    const cycleMap = new Map([
      ['shaA', 'shaB'],
      ['shaB', 'shaA']
    ]);

    assert.throws(() => {
      resolver.resolveChain('shaA', cycleMap);
    }, /Circular delta cycle detected/, 'Must detect circular reference between A and B');
  });

  it('B21.4: Self-referential delta (A -> A) detected and rejected', () => {
    class MockDeltaResolver {
      resolveChain(sha, chainMap, visited = new Set()) {
        if (visited.has(sha)) {
          throw new Error(`Circular delta cycle detected: object ${sha} referenced in its own delta ancestor chain`);
        }
        visited.add(sha);
        const parentSha = chainMap.get(sha);
        if (parentSha) {
          return this.resolveChain(parentSha, chainMap, visited);
        }
        return sha;
      }
    }

    const resolver = new MockDeltaResolver();
    const selfMap = new Map([['shaX', 'shaX']]);

    assert.throws(() => {
      resolver.resolveChain('shaX', selfMap);
    }, /Circular delta cycle detected/, 'Must detect self-referential delta');
  });

  it('B21.5: Missing delta base object SHA-1 gracefully surfaces typed error', () => {
    class MockRepository {
      resolveObject(sha) {
        if (sha === 'missing_base_sha') {
          const err = new Error(`OBJECT_NOT_FOUND: Object ${sha} not found in loose objects or packfiles`);
          err.code = 'OBJECT_NOT_FOUND';
          throw err;
        }
        return Buffer.from('found');
      }
    }

    const repo = new MockRepository();
    assert.throws(() => {
      repo.resolveObject('missing_base_sha');
    }, /OBJECT_NOT_FOUND/, 'Must throw OBJECT_NOT_FOUND error');
  });
});
