import { describe, expect, it } from 'vitest';
import render from 'preact-render-to-string';
import {
  DashboardView,
  formatRelativeTime,
  type ForgeIndex,
} from '../../src/ui/DashboardView.js';

describe('DashboardView Component (DashboardView.tsx)', () => {
  const mockIndex: ForgeIndex = {
    version: 1,
    title: 'Sendforge Hub',
    generated_at: '2026-08-26T00:00:00Z',
    repos: [
      {
        id: 'alice/sendforge',
        name: 'sendforge',
        owner: 'alice',
        description: 'High-performance static-first Git forge engine in Rust.',
        default_branch: 'main',
        latest_commit: {
          oid: 'abc1234567890abcdef1234567890abcdef1234',
          summary: 'Implement multi-repository export and dashboard',
          author: 'Alice Chen',
          timestamp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        },
        stats: {
          commits: 120,
          branches: 4,
          tags: 2,
          issues: 5,
          pulls: 3,
        },
        path: 'alice/sendforge/',
      },
      {
        id: 'bob/tools',
        name: 'tools',
        owner: 'bob',
        description: 'CLI utilities and helper scripts.',
        default_branch: 'master',
        latest_commit: {
          oid: 'def5678901234567890abcdef1234567890abcde',
          summary: 'Add fast compression script',
          author: 'Bob Smith',
          timestamp: Math.floor(Date.now() / 1000) - 86400 * 2, // 2 days ago
        },
        stats: {
          commits: 45,
          branches: 2,
          tags: 1,
          issues: 1,
          pulls: 0,
        },
        path: 'bob/tools/',
      },
      {
        id: 'standalone-app',
        name: 'standalone-app',
        description: 'Independent single repository project.',
        default_branch: 'trunk',
        stats: {
          commits: 15,
          branches: 1,
          tags: 0,
          issues: 0,
          pulls: 0,
        },
        path: 'standalone-app/',
      },
    ],
  };

  it('renders dashboard title, subtitle, and global portfolio statistics', () => {
    const html = render(<DashboardView index={mockIndex} />);

    expect(html).toContain('Sendforge Hub');
    expect(html).toContain('High-Performance Multi-Repository Git Portfolio');
    expect(html).toContain('data-testid="forge-dashboard-view"');
    expect(html).toContain('data-testid="dashboard-global-stats"');

    // 3 repos total
    expect(html).toContain('Repositories');
    expect(html).toContain('3');

    // Total commits: 120 + 45 + 15 = 180
    expect(html).toContain('180');
    expect(html).toContain('Total Commits');
  });

  it('renders repository cards with name, owner, branch, description, and stats', () => {
    const html = render(<DashboardView index={mockIndex} />);

    // Check Repo 1
    expect(html).toContain('data-testid="repo-card-sendforge"');
    expect(html).toContain('data-testid="repo-link-sendforge"');
    expect(html).toContain('alice/sendforge/');
    expect(html).toContain('👤 alice');
    expect(html).toContain('main');
    expect(html).toContain('High-performance static-first Git forge engine in Rust.');
    expect(html).toContain('Implement multi-repository export and dashboard');
    expect(html).toContain('Alice Chen');
    expect(html).toContain('abc1234');
    expect(html).toContain('120'); // commits
    expect(html).toContain('4'); // branches

    // Check Repo 2
    expect(html).toContain('data-testid="repo-card-tools"');
    expect(html).toContain('👤 bob');
    expect(html).toContain('master');
    expect(html).toContain('Bob Smith');
    expect(html).toContain('def5678');

    // Check Repo 3 (no owner, fallback description)
    expect(html).toContain('data-testid="repo-card-standalone-app"');
    expect(html).toContain('trunk');
  });

  it('renders owner filter tabs for distinct repository owners', () => {
    const html = render(<DashboardView index={mockIndex} />);

    expect(html).toContain('data-testid="owner-pill-all"');
    expect(html).toContain('data-testid="owner-pill-alice"');
    expect(html).toContain('data-testid="owner-pill-bob"');
    expect(html).toContain('All Repositories (3)');
    expect(html).toContain('👤 alice (1)');
    expect(html).toContain('👤 bob (1)');
  });

  it('renders search input and sort selector with proper options', () => {
    const html = render(<DashboardView index={mockIndex} />);

    expect(html).toContain('data-testid="dashboard-search-input"');
    expect(html).toContain('data-testid="dashboard-sort-select"');
    expect(html).toContain('Recently Updated');
    expect(html).toContain('Repository Name (A-Z)');
    expect(html).toContain('Most Commits');
    expect(html).toContain('Most Issues &amp; Pulls');
  });

  it('renders empty state when index contains zero repositories', () => {
    const emptyIndex: ForgeIndex = {
      version: 1,
      title: 'Empty Forge',
      generated_at: '2026-08-26T00:00:00Z',
      repos: [],
    };

    const html = render(<DashboardView index={emptyIndex} />);

    expect(html).toContain('data-testid="dashboard-empty-state"');
    expect(html).toContain('No repositories found');
  });

  describe('formatRelativeTime helper', () => {
    const now = Math.floor(Date.now() / 1000);

    it('formats times accurately based on duration', () => {
      expect(formatRelativeTime(0)).toBe('unknown date');
      expect(formatRelativeTime(-100)).toBe('unknown date');
      expect(formatRelativeTime(now - 10)).toBe('just now');
      expect(formatRelativeTime(now - 120)).toBe('2m ago');
      expect(formatRelativeTime(now - 3600 * 3)).toBe('3h ago');
      expect(formatRelativeTime(now - 86400 * 5)).toBe('5d ago');
      expect(formatRelativeTime(now - 86400 * 60)).toBe('2mo ago');
      expect(formatRelativeTime(now - 86400 * 400)).toBe('1y ago');
    });
  });
});
