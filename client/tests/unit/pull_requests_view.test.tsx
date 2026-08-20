import { describe, expect, it } from 'vitest';
import render from 'preact-render-to-string';
import { PullRequestsView } from '../../src/ui/PullRequestsView.js';
import type { PullRequest } from '../../src/engine/collab-client.js';

describe('PullRequestsView Component (PullRequestsView.tsx)', () => {
  const mockPulls: readonly PullRequest[] = [
    {
      id: '1',
      number: 1,
      title: 'Add interactive blame view',
      description: 'Implements in-browser git blame using Myers diff algorithm.',
      author: { name: 'Alice Chen', email: 'alice@example.com' },
      targetBranch: 'main',
      sourceBranch: 'feature/blame-view',
      headCommit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      status: 'open',
      createdAt: 1740000000,
      updatedAt: 1740001000,
      labels: ['feature', 'ui'],
      comments: [
        {
          id: 'c1',
          author: { name: 'Bob Smith', email: 'bob@example.com' },
          body: 'Great addition!',
          createdAt: 1740000500,
        },
      ],
    },
    {
      id: '2',
      number: 2,
      title: 'Optimize DAG LCA merge base calculation',
      description: 'Traverses commit graphs off-thread with priority queue.',
      author: { name: 'Bob Smith', email: 'bob@example.com' },
      targetBranch: 'main',
      sourceBranch: 'perf/dag-lca',
      headCommit: 'b2c3d4e5f60718293a4b5c6d7e8f90123456789a',
      status: 'merged',
      createdAt: 1739900000,
      updatedAt: 1739950000,
      labels: ['performance', 'core'],
      comments: [],
    },
    {
      id: '3',
      number: 3,
      title: 'Obsolete legacy export script',
      description: 'Superceded by Rust static generator.',
      author: { name: 'Charlie', email: 'charlie@example.com' },
      targetBranch: 'main',
      sourceBranch: 'cleanup/old-export',
      headCommit: 'c3d4e5f60718293a4b5c6d7e8f90123456789ab1',
      status: 'closed',
      createdAt: 1739800000,
      updatedAt: 1739850000,
      labels: ['cleanup'],
      comments: [],
    },
  ];

  it('renders status tabs with accurate counts', () => {
    const html = render(<PullRequestsView pulls={mockPulls} initialFilter="all" />);

    expect(html).toContain('Open');
    expect(html).toContain('Merged');
    expect(html).toContain('Closed');
    expect(html).toContain('All');

    // Count badges: 1 open, 1 merged, 1 closed, 3 total
    expect(html).toContain('data-testid="open-count-badge">1</span>');
    expect(html).toContain('data-testid="merged-count-badge">1</span>');
    expect(html).toContain('data-testid="closed-count-badge">1</span>');
    expect(html).toContain('data-testid="all-count-badge">3</span>');
  });

  it('filters by status: open, merged, closed, and all', () => {
    // 1. Open filter (default)
    const openHtml = render(<PullRequestsView pulls={mockPulls} initialFilter="open" />);
    expect(openHtml).toContain('Add interactive blame view');
    expect(openHtml).not.toContain('Optimize DAG LCA merge base calculation');
    expect(openHtml).not.toContain('Obsolete legacy export script');

    // 2. Merged filter
    const mergedHtml = render(<PullRequestsView pulls={mockPulls} initialFilter="merged" />);
    expect(mergedHtml).not.toContain('Add interactive blame view');
    expect(mergedHtml).toContain('Optimize DAG LCA merge base calculation');
    expect(mergedHtml).not.toContain('Obsolete legacy export script');

    // 3. Closed filter
    const closedHtml = render(<PullRequestsView pulls={mockPulls} initialFilter="closed" />);
    expect(closedHtml).not.toContain('Add interactive blame view');
    expect(closedHtml).not.toContain('Optimize DAG LCA merge base calculation');
    expect(closedHtml).toContain('Obsolete legacy export script');

    // 4. All filter
    const allHtml = render(<PullRequestsView pulls={mockPulls} initialFilter="all" />);
    expect(allHtml).toContain('Add interactive blame view');
    expect(allHtml).toContain('Optimize DAG LCA merge base calculation');
    expect(allHtml).toContain('Obsolete legacy export script');
  });

  it('filters by instant search query across title, description, author, branch, and #id', () => {
    // Search by title keyword
    const titleHtml = render(
      <PullRequestsView pulls={mockPulls} initialFilter="all" initialQuery="blame" />
    );
    expect(titleHtml).toContain('Add interactive blame view');
    expect(titleHtml).not.toContain('Optimize DAG LCA');

    // Search by author name
    const authorHtml = render(
      <PullRequestsView pulls={mockPulls} initialFilter="all" initialQuery="Charlie" />
    );
    expect(authorHtml).toContain('Obsolete legacy export script');
    expect(authorHtml).not.toContain('Add interactive blame view');

    // Search by branch name
    const branchHtml = render(
      <PullRequestsView pulls={mockPulls} initialFilter="all" initialQuery="perf/dag-lca" />
    );
    expect(branchHtml).toContain('Optimize DAG LCA merge base calculation');

    // Search by #id
    const idHtml = render(
      <PullRequestsView pulls={mockPulls} initialFilter="all" initialQuery="#1" />
    );
    expect(idHtml).toContain('Add interactive blame view');
    expect(idHtml).not.toContain('Optimize DAG LCA');
  });

  it('filters by label and author dropdown', () => {
    // Label filter
    const labelHtml = render(
      <PullRequestsView pulls={mockPulls} initialFilter="all" initialLabel="performance" />
    );
    expect(labelHtml).toContain('Optimize DAG LCA merge base calculation');
    expect(labelHtml).not.toContain('Add interactive blame view');

    // Author filter
    const authorHtml = render(
      <PullRequestsView pulls={mockPulls} initialFilter="all" initialAuthor="Alice Chen" />
    );
    expect(authorHtml).toContain('Add interactive blame view');
    expect(authorHtml).not.toContain('Optimize DAG LCA');
  });

  it('renders empty state when no PRs exist or match filters', () => {
    const emptyPullsHtml = render(<PullRequestsView pulls={[]} />);
    expect(emptyPullsHtml).toContain('No pull requests found');
    expect(emptyPullsHtml).toContain('data-testid="pulls-empty-state"');

    const noMatchHtml = render(
      <PullRequestsView pulls={mockPulls} initialFilter="open" initialQuery="nonexistent-xyz" />
    );
    expect(noMatchHtml).toContain('No pull requests match your filters');
    expect(noMatchHtml).toContain('Clear all filters');
  });

  it('renders author avatars with deterministic initials and branch pills', () => {
    const html = render(<PullRequestsView pulls={mockPulls} initialFilter="all" />);

    expect(html).toContain('AC'); // Alice Chen initials
    expect(html).toContain('BS'); // Bob Smith initials
    expect(html).toContain('CH'); // Charlie initials
    expect(html).toContain('feature/blame-view');
    expect(html).toContain('main');
    expect(html).toContain('#1');
    expect(html).toContain('💬'); // comment count indicator
  });
});
