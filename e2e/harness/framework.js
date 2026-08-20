/**
 * Sendforge E2E Test Framework
 * Lightweight, zero-dependency, robust test runner and assertion library
 * supporting async tests, lifecycle hooks, TAP output, JUnit XML, and colorful summaries.
 */

import fs from 'node:fs';
import path from 'node:path';

export class AssertionFailure extends Error {
  constructor(message, expected, actual) {
    super(message);
    this.name = 'AssertionFailure';
    this.expected = expected;
    this.actual = actual;
  }
}

export const assert = {
  ok(value, msg = 'Expected truthy value') {
    if (!value) {
      throw new AssertionFailure(msg, true, value);
    }
  },

  strictEqual(actual, expected, msg) {
    if (actual !== expected) {
      const message = msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
      throw new AssertionFailure(message, expected, actual);
    }
  },

  notStrictEqual(actual, expected, msg) {
    if (actual === expected) {
      const message = msg || `Expected values to differ, both were ${JSON.stringify(actual)}`;
      throw new AssertionFailure(message, 'different', actual);
    }
  },

  deepEqual(actual, expected, msg) {
    const aStr = JSON.stringify(actual);
    const eStr = JSON.stringify(expected);
    if (aStr !== eStr) {
      const message = msg || `Deep equality mismatch:\nExpected: ${eStr}\nActual:   ${aStr}`;
      throw new AssertionFailure(message, expected, actual);
    }
  },

  includes(container, item, msg) {
    if (typeof container === 'string' || Array.isArray(container)) {
      if (!container.includes(item)) {
        const message = msg || `Expected container to include ${JSON.stringify(item)}`;
        throw new AssertionFailure(message, item, container);
      }
    } else {
      throw new AssertionFailure('Invalid container for includes assertion', true, false);
    }
  },

  notIncludes(container, item, msg) {
    if (typeof container === 'string' || Array.isArray(container)) {
      if (container.includes(item)) {
        const message = msg || `Expected container NOT to include ${JSON.stringify(item)}`;
        throw new AssertionFailure(message, 'not present', item);
      }
    }
  },

  match(str, regex, msg) {
    if (!regex.test(str)) {
      const message = msg || `Expected ${JSON.stringify(str)} to match regex ${regex}`;
      throw new AssertionFailure(message, regex.toString(), str);
    }
  },

  notMatch(str, regex, msg) {
    if (regex.test(str)) {
      const message = msg || `Expected ${JSON.stringify(str)} NOT to match regex ${regex}`;
      throw new AssertionFailure(message, 'no match', str);
    }
  },

  throws(fn, expectedErr, msg) {
    let threw = false;
    let errResult = null;
    try {
      fn();
    } catch (err) {
      threw = true;
      errResult = err;
    }
    if (!threw) {
      throw new AssertionFailure(msg || 'Expected function to throw an error', 'Error', 'No error');
    }
    if (expectedErr) {
      if (typeof expectedErr === 'function' && !(errResult instanceof expectedErr)) {
        throw new AssertionFailure(msg || `Expected error instance of ${expectedErr.name}`, expectedErr.name, errResult);
      } else if (expectedErr instanceof RegExp && !expectedErr.test(String(errResult))) {
        throw new AssertionFailure(msg || `Expected error matching ${expectedErr}`, expectedErr.toString(), String(errResult));
      }
    }
  },

  async rejects(promiseOrAsyncFn, expectedErr, msg) {
    let threw = false;
    let errResult = null;
    try {
      const p = typeof promiseOrAsyncFn === 'function' ? promiseOrAsyncFn() : promiseOrAsyncFn;
      await p;
    } catch (err) {
      threw = true;
      errResult = err;
    }
    if (!threw) {
      throw new AssertionFailure(msg || 'Expected async function/promise to reject', 'Rejection', 'Resolved');
    }
    if (expectedErr) {
      if (typeof expectedErr === 'function' && !(errResult instanceof expectedErr)) {
        throw new AssertionFailure(msg || `Expected error instance of ${expectedErr.name}`, expectedErr.name, errResult);
      } else if (expectedErr instanceof RegExp && !expectedErr.test(String(errResult))) {
        throw new AssertionFailure(msg || `Expected error matching ${expectedErr}`, expectedErr.toString(), String(errResult));
      }
    }
  },

  greaterThan(actual, threshold, msg) {
    if (!(actual > threshold)) {
      throw new AssertionFailure(msg || `Expected ${actual} > ${threshold}`, `> ${threshold}`, actual);
    }
  },

  greaterThanOrEqual(actual, threshold, msg) {
    if (!(actual >= threshold)) {
      throw new AssertionFailure(msg || `Expected ${actual} >= ${threshold}`, `>= ${threshold}`, actual);
    }
  },

  lessThan(actual, threshold, msg) {
    if (!(actual < threshold)) {
      throw new AssertionFailure(msg || `Expected ${actual} < ${threshold}`, `< ${threshold}`, actual);
    }
  },

  lessThanOrEqual(actual, threshold, msg) {
    if (!(actual <= threshold)) {
      throw new AssertionFailure(msg || `Expected ${actual} <= ${threshold}`, `<= ${threshold}`, actual);
    }
  },

  between(actual, min, max, msg) {
    if (!(actual >= min && actual <= max)) {
      throw new AssertionFailure(msg || `Expected ${actual} between [${min}, ${max}]`, `[${min}, ${max}]`, actual);
    }
  }
};

export class TestSuite {
  constructor(name, filename = '') {
    this.name = name;
    this.filename = filename;
    this.tests = [];
    this.beforeAllHooks = [];
    this.afterAllHooks = [];
    this.beforeEachHooks = [];
    this.afterEachHooks = [];
  }

  addTest(name, fn, options = {}) {
    this.tests.push({
      name,
      fn,
      timeout: options.timeout || 30000,
      skip: !!options.skip,
      only: !!options.only,
    });
  }

  beforeAll(fn) {
    this.beforeAllHooks.push(fn);
  }

  afterAll(fn) {
    this.afterAllHooks.push(fn);
  }

  beforeEach(fn) {
    this.beforeEachHooks.push(fn);
  }

  afterEach(fn) {
    this.afterEachHooks.push(fn);
  }

  async run(reporter = null) {
    const results = [];
    const hasOnly = this.tests.some(t => t.only);
    const testsToRun = hasOnly ? this.tests.filter(t => t.only) : this.tests;

    try {
      for (const hook of this.beforeAllHooks) {
        await hook();
      }

      for (const test of testsToRun) {
        if (test.skip) {
          results.push({ name: test.name, status: 'skipped', durationMs: 0 });
          if (reporter) reporter.onTestResult(this, test.name, 'skipped', 0, null);
          continue;
        }

        let testError = null;
        const startTime = Date.now();

        try {
          for (const hook of this.beforeEachHooks) {
            await hook();
          }

          // Execute with timeout
          let timeoutHandle;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error(`Test timed out after ${test.timeout}ms`));
            }, test.timeout);
          });

          await Promise.race([
            Promise.resolve(test.fn()),
            timeoutPromise
          ]);

          clearTimeout(timeoutHandle);
        } catch (err) {
          testError = err;
        } finally {
          for (const hook of this.afterEachHooks) {
            try {
              await hook();
            } catch (cleanupErr) {
              if (!testError) testError = cleanupErr;
            }
          }
        }

        const durationMs = Date.now() - startTime;
        const status = testError ? 'failed' : 'passed';

        results.push({
          name: test.name,
          status,
          durationMs,
          error: testError
        });

        if (reporter) {
          reporter.onTestResult(this, test.name, status, durationMs, testError);
        }
      }
    } catch (suiteErr) {
      results.push({
        name: `${this.name} (suite setup/teardown failure)`,
        status: 'failed',
        durationMs: 0,
        error: suiteErr
      });
      if (reporter) {
        reporter.onTestResult(this, `${this.name} (suite error)`, 'failed', 0, suiteErr);
      }
    } finally {
      for (const hook of this.afterAllHooks) {
        try {
          await hook();
        } catch (err) {
          console.error(`Error in afterAll hook of suite "${this.name}":`, err);
        }
      }
    }

    return results;
  }
}

// Global DSL registry
let currentSuite = null;
const globalSuites = [];

export function describe(name, fn) {
  const suite = new TestSuite(name);
  currentSuite = suite;
  globalSuites.push(suite);
  fn();
  currentSuite = null;
  return suite;
}

export function it(name, fn, options = {}) {
  if (!currentSuite) {
    throw new Error(`"it" must be called inside a "describe" block`);
  }
  currentSuite.addTest(name, fn, options);
}

export function test(name, fn, options = {}) {
  return it(name, fn, options);
}

it.skip = (name, fn) => it(name, fn, { skip: true });
it.only = (name, fn) => it(name, fn, { only: true });

export function beforeAll(fn) {
  if (!currentSuite) throw new Error(`"beforeAll" must be called inside a "describe" block`);
  currentSuite.beforeAll(fn);
}

export function afterAll(fn) {
  if (!currentSuite) throw new Error(`"afterAll" must be called inside a "describe" block`);
  currentSuite.afterAll(fn);
}

export function beforeEach(fn) {
  if (!currentSuite) throw new Error(`"beforeEach" must be called inside a "describe" block`);
  currentSuite.beforeEach(fn);
}

export function afterEach(fn) {
  if (!currentSuite) throw new Error(`"afterEach" must be called inside a "describe" block`);
  currentSuite.afterEach(fn);
}

export function getRegisteredSuites() {
  return [...globalSuites];
}

export function clearRegisteredSuites() {
  globalSuites.length = 0;
}

export class TestReporter {
  constructor(options = {}) {
    this.format = options.format || 'console'; // 'console' | 'tap' | 'junit'
    this.totalTests = 0;
    this.passedTests = 0;
    this.failedTests = 0;
    this.skippedTests = 0;
    this.startTime = Date.now();
    this.records = [];
  }

  onTestResult(suite, testName, status, durationMs, error) {
    this.totalTests++;
    if (status === 'passed') this.passedTests++;
    else if (status === 'failed') this.failedTests++;
    else if (status === 'skipped') this.skippedTests++;

    this.records.push({
      suite: suite.name,
      testName,
      status,
      durationMs,
      error
    });

    if (this.format === 'console') {
      const icon = status === 'passed' ? '✓' : status === 'failed' ? '✗' : '○';
      const color = status === 'passed' ? '\x1b[32m' : status === 'failed' ? '\x1b[31m' : '\x1b[33m';
      const reset = '\x1b[0m';
      console.log(`  ${color}${icon}${reset} ${testName} (${durationMs}ms)`);
      if (error) {
        console.log(`      \x1b[31m${error.stack || error.message || error}\x1b[0m`);
      }
    } else if (this.format === 'tap') {
      const idx = this.totalTests;
      if (status === 'passed') {
        console.log(`ok ${idx} - ${suite.name} > ${testName} (${durationMs}ms)`);
      } else if (status === 'skipped') {
        console.log(`ok ${idx} - ${suite.name} > ${testName} # SKIP`);
      } else {
        console.log(`not ok ${idx} - ${suite.name} > ${testName}`);
        if (error) {
          console.log(`  ---`);
          console.log(`  message: ${JSON.stringify(error.message || String(error))}`);
          console.log(`  ...`);
        }
      }
    }
  }

  printSummary() {
    const totalDuration = Date.now() - this.startTime;
    if (this.format === 'console') {
      console.log('\n======================================================');
      console.log(`Test Execution Summary:`);
      console.log(`  Total:   ${this.totalTests}`);
      console.log(`  \x1b[32mPassed:  ${this.passedTests}\x1b[0m`);
      console.log(`  \x1b[31mFailed:  ${this.failedTests}\x1b[0m`);
      console.log(`  \x1b[33mSkipped: ${this.skippedTests}\x1b[0m`);
      console.log(`  Duration: ${(totalDuration / 1000).toFixed(2)}s`);
      console.log('======================================================\n');
    } else if (this.format === 'tap') {
      console.log(`1..${this.totalTests}`);
      console.log(`# tests ${this.totalTests}`);
      console.log(`# pass  ${this.passedTests}`);
      console.log(`# fail  ${this.failedTests}`);
      console.log(`# skip  ${this.skippedTests}`);
    }

    return {
      total: this.totalTests,
      passed: this.passedTests,
      failed: this.failedTests,
      skipped: this.skippedTests,
      durationMs: totalDuration,
      success: this.failedTests === 0
    };
  }

  generateJUnitXml() {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<testsuites name="Sendforge E2E Test Suite" tests="${this.totalTests}" failures="${this.failedTests}" skipped="${this.skippedTests}" time="${((Date.now() - this.startTime) / 1000).toFixed(3)}">\n`;

    // Group by suite
    const grouped = {};
    for (const rec of this.records) {
      if (!grouped[rec.suite]) grouped[rec.suite] = [];
      grouped[rec.suite].push(rec);
    }

    for (const [suiteName, tests] of Object.entries(grouped)) {
      const suiteTime = tests.reduce((acc, t) => acc + t.durationMs, 0) / 1000;
      const suiteFailures = tests.filter(t => t.status === 'failed').length;
      xml += `  <testsuite name="${escapeXml(suiteName)}" tests="${tests.length}" failures="${suiteFailures}" time="${suiteTime.toFixed(3)}">\n`;
      for (const t of tests) {
        xml += `    <testcase name="${escapeXml(t.testName)}" classname="${escapeXml(suiteName)}" time="${(t.durationMs / 1000).toFixed(3)}">\n`;
        if (t.status === 'failed') {
          xml += `      <failure message="${escapeXml(t.error?.message || 'Failed')}">${escapeXml(t.error?.stack || String(t.error))}</failure>\n`;
        } else if (t.status === 'skipped') {
          xml += `      <skipped/>\n`;
        }
        xml += `    </testcase>\n`;
      }
      xml += `  </testsuite>\n`;
    }

    xml += `</testsuites>\n`;
    return xml;
  }
}

function escapeXml(unsafe) {
  if (typeof unsafe !== 'string') unsafe = String(unsafe || '');
  return unsafe.replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}
