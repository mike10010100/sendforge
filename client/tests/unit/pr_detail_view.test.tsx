import { describe, expect, it, vi } from 'vitest';
import render from 'preact-render-to-string';
import { PRDetailView } from '../../src/ui/PRDetailView.js';
import type { PullRequest } from '../../src/engine/collab-client.js';
import { GitRepositoryClient } from '../../src/engine/fetcher.js';

describe('PRDetailView Component (PRDetailView.tsx)', () => {
  const mockClient = new GitRepositoryClient('');

  const mockPr: PullRequest = {
    id: '10',
    number: 10,
    title: 'Support 3-way tree diff in Web Worker',
    description: '### Changes\n- Offloads Myers diff to worker\n- Computes merge base in-browser',
    author: { name: 'Dev Lead', email: 'lead@sendforge.local' },
    targetBranch: 'main',
    sourceBranch: 'feature/diff-worker',
    headCommit: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    status: 'open',
    createdAt: 1740000000,
    updatedAt: 1740002000,
    labels: ['engine', 'worker', 'm2'],
    comments: [
      {
        id: 'c1',
        author: { name: 'Reviewer One', email: 'reviewer@sendforge.local' },
        body: 'Looks very clean and fast!',
        createdAt: 1740001000,
      },
    ],
  };

  it('renders PR header with title, #id badge, status badge, and branch pills', () => {
    const html = render(
      <PRDetailView
        pr={mockPr}
        client={mockClient}
        activeTab="conversation"
        onBack={vi.fn()}
      />
    );

    expect(html).toContain('Support 3-way tree diff in Web Worker');
    expect(html).toContain('#10');
    expect(html).toContain('data-testid="pr-status-badge"');
    expect(html).toContain('Open');
    expect(html).toContain('main');
    expect(html).toContain('feature/diff-worker');
    expect(html).toContain('Dev Lead');
    expect(html).toContain('← Back to Pull Requests');
  });

  it('renders all 3 tabs with proper badges: Conversation, Commits, Files Changed', () => {
    const html = render(
      <PRDetailView
        pr={mockPr}
        client={mockClient}
        activeTab="conversation"
      />
    );

    expect(html).toContain('data-testid="pr-tab-conversation"');
    expect(html).toContain('data-testid="pr-tab-commits"');
    expect(html).toContain('data-testid="pr-tab-files"');
    expect(html).toContain('Conversation');
    expect(html).toContain('Commits');
    expect(html).toContain('Files Changed');
  });

  it('renders conversation tab with Markdown description, comments, and sidebar', () => {
    const html = render(
      <PRDetailView
        pr={mockPr}
        client={mockClient}
        activeTab="conversation"
      />
    );

    // Markdown description card
    expect(html).toContain('data-testid="pr-description-card"');
    expect(html).toContain('<h3>Changes</h3>');
    expect(html).toContain('<li>Offloads Myers diff to worker</li>');

    // Sidebar labels & participants
    expect(html).toContain('data-testid="sidebar-labels-section"');
    expect(html).toContain('engine');
    expect(html).toContain('worker');
    expect(html).toContain('m2');
    expect(html).toContain('data-testid="sidebar-branches-section"');
    expect(html).toContain('data-testid="sidebar-participants-section"');
  });

  it('renders commits tab structure', () => {
    const html = render(
      <PRDetailView
        pr={mockPr}
        client={mockClient}
        activeTab="commits"
      />
    );

    expect(html).toContain('data-testid="pr-commits-tab"');
    expect(html).toContain('Commits');
  });

  it('renders files changed tab structure with unified / split controls', () => {
    const html = render(
      <PRDetailView
        pr={mockPr}
        client={mockClient}
        activeTab="files"
      />
    );

    expect(html).toContain('data-testid="pr-files-tab"');
    expect(html).toContain('data-testid="diff-mode-unified-btn"');
    expect(html).toContain('data-testid="diff-mode-split-btn"');
    expect(html).toContain('Unified');
    expect(html).toContain('Split');
  });

  it('renders status badges for merged and closed PRs', () => {
    const mergedPr: PullRequest = {
      ...mockPr,
      status: 'merged',
    };
    const mergedHtml = render(
      <PRDetailView pr={mergedPr} client={mockClient} activeTab="conversation" />
    );
    expect(mergedHtml).toContain('Merged');
    expect(mergedHtml).toContain('status-pill-merged');

    const closedPr: PullRequest = {
      ...mockPr,
      status: 'closed',
    };
    const closedHtml = render(
      <PRDetailView pr={closedPr} client={mockClient} activeTab="conversation" />
    );
    expect(closedHtml).toContain('Closed');
    expect(closedHtml).toContain('status-pill-closed');
  });

  it('renders fallback when PR description is empty', () => {
    const noDescPr: PullRequest = {
      ...mockPr,
      description: '',
      comments: [],
      labels: [],
    };
    const html = render(
      <PRDetailView pr={noDescPr} client={mockClient} activeTab="conversation" />
    );

    expect(html).toContain('<em>No description provided.</em>');
    expect(html).toContain('None yet');
  });
});
