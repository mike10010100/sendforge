#!/usr/bin/env node

/**
 * Sendforge E2E Master Test Runner
 * Discovers and executes test suites across all 4 tiers with flexible filtering,
 * formatted console output, TAP output, and JUnit XML report generation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestReporter, getRegisteredSuites, clearRegisteredSuites } from './harness/framework.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const args = process.argv.slice(2);
  let selectedTier = 'all'; // 'all', '1', '2', '3', '4'
  let format = 'console';   // 'console', 'tap', 'junit'
  let filter = null;
  let xmlOutPath = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--tier' && args[i + 1]) {
      selectedTier = args[++i];
    } else if (arg.startsWith('--tier=')) {
      selectedTier = arg.split('=')[1];
    } else if (arg === '--format' && args[i + 1]) {
      format = args[++i];
    } else if (arg.startsWith('--format=')) {
      format = arg.split('=')[1];
    } else if (arg === '--tap') {
      format = 'tap';
    } else if (arg === '--junit') {
      format = 'junit';
    } else if (arg === '--filter' && args[i + 1]) {
      filter = new RegExp(args[++i], 'i');
    } else if (arg === '--xml-out' && args[i + 1]) {
      xmlOutPath = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Sendforge E2E Master Test Runner

Usage:
  node e2e/runner.js [options]
  ./e2e/run_e2e.sh [options]

Options:
  --tier <1|2|3|4|all>   Select test tier to execute (default: all)
  --format <console|tap|junit> Output reporting format (default: console)
  --tap                  Shortcut for --format tap
  --junit                Shortcut for --format junit
  --filter <regex>       Filter test suite names by regex
  --xml-out <path>       File path to write JUnit XML report
  --help, -h             Show this help message
`);
      process.exit(0);
    }
  }

  const tierDirs = {
    '1': [path.join(__dirname, 'tier1_features')],
    '2': [path.join(__dirname, 'tier2_boundaries')],
    '3': [path.join(__dirname, 'tier3_combinations')],
    '4': [path.join(__dirname, 'tier4_workloads')],
    'all': [
      path.join(__dirname, 'tier1_features'),
      path.join(__dirname, 'tier2_boundaries'),
      path.join(__dirname, 'tier3_combinations'),
      path.join(__dirname, 'tier4_workloads')
    ]
  };

  const targetDirs = tierDirs[selectedTier] || tierDirs['all'];

  // Discover all test files
  const testFiles = [];
  for (const dir of targetDirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') || f.endsWith('.ts'));
      files.sort();
      for (const f of files) {
        testFiles.push(path.join(dir, f));
      }
    }
  }

  if (testFiles.length === 0) {
    console.error(`No test files found for tier "${selectedTier}"`);
    process.exit(1);
  }

  if (format === 'console') {
    console.log(`\n======================================================`);
    console.log(`  SENDFORGE E2E TEST RUNNER`);
    console.log(`  Tier: ${selectedTier.toUpperCase()}`);
    console.log(`  Suites: ${testFiles.length} files discovered`);
    console.log(`======================================================\n`);
  }

  clearRegisteredSuites();

  // Load all test suites
  for (const file of testFiles) {
    await import(`file://${file}`);
  }

  let suitesToRun = getRegisteredSuites();
  if (filter) {
    suitesToRun = suitesToRun.filter(s => filter.test(s.name));
  }

  const reporter = new TestReporter({ format });

  for (const suite of suitesToRun) {
    if (format === 'console') {
      console.log(`\n\x1b[1m▶ ${suite.name}\x1b[0m`);
    }
    await suite.run(reporter);
  }

  const summary = reporter.printSummary();

  if (xmlOutPath || format === 'junit') {
    const xml = reporter.generateJUnitXml();
    if (xmlOutPath) {
      fs.writeFileSync(xmlOutPath, xml, 'utf-8');
      if (format === 'console') {
        console.log(`JUnit XML report written to ${xmlOutPath}`);
      }
    } else if (format === 'junit') {
      console.log(xml);
    }
  }

  process.exit(summary.success ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error in test runner:', err);
  process.exit(1);
});
