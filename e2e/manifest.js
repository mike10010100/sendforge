/**
 * Sendforge Phase 5 E2E Test Suite Manifest
 *
 * Registers, catalogs, and provides programmatic execution for all Phase 5 E2E test suites:
 * - Tier 1 Feature Suites: F33 (UX Polish), F34 (Fuzzy Finder), F35 (Multi-Repo), F36 (Edge Gateway), F37 (PWA Offline)
 * - Tier 2 Boundary Suite: B28-B31 (Phase 5 Boundaries)
 * - Tier 3 Combination Suite: C18-C21 (Phase 5 Cross-Feature Combinations)
 * - Tier 4 Workload Suite: W16-W17 (Real-World Multi-Repo & Collaboration Workloads)
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  TestReporter,
  getRegisteredSuites,
  clearRegisteredSuites
} from './harness/framework.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PHASE5_SUITES = [
  {
    id: 'F33',
    tier: 1,
    name: 'Tier 1 - Feature 33: Usability Polish & Quick Wins (F33 / R1)',
    file: path.join(__dirname, 'suites/f33_ux_polish.js'),
    description: 'Clone URL affordance, SHA copy badges, custom label chips, demo tag v0.1.0'
  },
  {
    id: 'F34',
    tier: 1,
    name: 'Tier 1 - Feature 34: Global Fuzzy File Finder (F34 / R2)',
    file: path.join(__dirname, 'suites/f34_fuzzy_finder.js'),
    description: 'Fuzzy tree indexer, score weighting, permalink parsing, character highlight ranges'
  },
  {
    id: 'F35',
    tier: 1,
    name: 'Tier 1 - Feature 35: Multi-Repository Portfolio & Dashboard (F35 / R3)',
    file: path.join(__dirname, 'suites/f35_multi_repo.js'),
    description: 'Multi-repo CLI exporter, repos.json schema, root dashboard HTML, owner nesting'
  },
  {
    id: 'F36',
    tier: 1,
    name: 'Tier 1 - Feature 36: Serverless Edge Write Gateway (F36 / R4)',
    file: path.join(__dirname, 'suites/f36_edge_gateway.js'),
    description: 'Edge issue/PR submit endpoints, loose Git object synthesis, Git ref updates'
  },
  {
    id: 'F37',
    tier: 1,
    name: 'Tier 1 - Feature 37: PWA & Full Offline Caching (F37 / R5)',
    file: path.join(__dirname, 'suites/f37_pwa_offline.js'),
    description: 'Service worker Cache-First & SWR strategies, manifest.json validation, offline badge'
  },
  {
    id: 'B28-B31',
    tier: 2,
    name: 'Tier 2 - Boundaries B28-B31: Phase 5 Corner Cases & Boundary Hardening',
    file: path.join(__dirname, 'suites/b28_b31_phase5_boundaries.js'),
    description: 'Empty queries, 10,000+ files tree indexing, deep owner hierarchies, path traversal rejection'
  },
  {
    id: 'C18-C21',
    tier: 3,
    name: 'Tier 3 - Combinations C18-C21: Cross-Feature Integration Workflows',
    file: path.join(__dirname, 'suites/c18_c21_phase5_combinations.js'),
    description: 'Multi-repo switching + fuzzy jumping, edge issues with custom chips, PWA cached clone copy'
  },
  {
    id: 'W16-W17',
    tier: 4,
    name: 'Tier 4 - Workloads W16-W17: Real-World Scenarios',
    file: path.join(__dirname, 'suites/w16_w17_phase5_workloads.js'),
    description: '10-repo portfolio export + concurrent serving + fuzzy search, end-to-end edge & PWA workflow'
  }
];

export async function runPhase5Suites(options = {}) {
  const format = options.format || 'console';
  clearRegisteredSuites();

  for (const suiteDef of PHASE5_SUITES) {
    await import(`file://${suiteDef.file}`);
  }

  const suitesToRun = getRegisteredSuites();
  const reporter = new TestReporter({ format });

  if (format === 'console') {
    console.log(`\n======================================================`);
    console.log(`  SENDFORGE PHASE 5 E2E SUITE RUNNER`);
    console.log(`  Suites: ${suitesToRun.length} registered`);
    console.log(`======================================================\n`);
  }

  for (const suite of suitesToRun) {
    if (format === 'console') {
      console.log(`\n\x1b[1m▶ ${suite.name}\x1b[0m`);
    }
    await suite.run(reporter);
  }

  return reporter.printSummary();
}

// Auto-run if executed directly via `node e2e/manifest.js`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPhase5Suites().then(summary => {
    process.exit(summary.success ? 0 : 1);
  }).catch(err => {
    console.error('Fatal error running Phase 5 suites:', err);
    process.exit(1);
  });
}
