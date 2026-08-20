import { describe, expect, it } from 'vitest';
import render from 'preact-render-to-string';
import { IssuesView } from '../../src/ui/IssuesView.js';
import type { Issue } from '../../src/engine/collab-client.js';

describe('IssuesView Component (IssuesView.tsx)', () => {
  const mockIssues: readonly Issue[] = [
    {
      id: '1',
      number: 1,
      title: 'Fix edge case in blame age fraction calculation',
      description: 'Zero timestamps cause divide-by-zero NaN in heatmap border.',
      author: { name: 'Alice Chen', email: 'alice@example.com' },
      status: 'open',
      createdAt: 1740000000,
      updatedAt: 1740001000,
      labels: ['bug', 'ui'],
      comments: [
        {
          id: 'c1',
          author: { name: 'Bob Smith', email: 'bob@example.com' },
          body: 'I can reproduce this when timestamps match.',
          createdAt: 1740000500,
        },
      ],
    },
    {
      id: '2',
      number: 2,
      title: 'Support dark mode custom CSS variables',
      description: 'Add high contrast dark theme options.',
      author: { name: 'Bob Smith', email: 'bob@example.com' },
      status: 'closed',
      createdAt: 1739900000,
      updatedAt: 1739950000,
      labels: ['feature', 'design'],
      comments: [],
    },
    {
      id: '3',
      number: 3,
      title: 'Add memory leak detector for blob buffers',
      description: 'Ensure Uint8Array objects are garbage collected properly.',
      author: { name: 'Charlie Dev', email: 'charlie@example.com' },
      status: 'open',
      createdAt: 1739800000,
      updatedAt: 1739850000,
      labels: ['performance', 'core'],
      comments: [
        {
          id: 'c2',
          author: { name: 'Alice Chen', email: 'alice@example.com' },
          body: 'Tested with 10k blobs, looks clean.',
          createdAt: 1739820000,
        },
        {
          id: 'c3',
          author: { name: 'Charlie Dev', email: 'charlie@example.com' },
          body: 'Merged fix in PR #2.',
          createdAt: 1739830000,
        },
      ],
    },
  ];

  it('renders status tabs with accurate open, closed, and all count badges', () => {
    const html = render(<IssuesView issues={mockIssues} initialFilter="all" />);

    expect(html).toContain('Open');
    expect(html).toContain('Closed');
    expect(html).toContain('All');

    // 2 open, 1 closed, 3 total
    expect(html).toContain('data-testid="open-count-badge">2</span>');
    expect(html).toContain('data-testid="closed-count-badge">1</span>');
    expect(html).toContain('data-testid="all-count-badge">3</span>');
  });

  it('filters issues by status: open, closed, and all', () => {
    // Open filter (default)
    const openHtml = render(<IssuesView issues={mockIssues} initialFilter="open" />);
    expect(openHtml).toContain('Fix edge case in blame age fraction calculation');
    expect(openHtml).toContain('Add memory leak detector for blob buffers');
    expect(openHtml).not.toContain('Support dark mode custom CSS variables');

    // Closed filter
    const closedHtml = render(<IssuesView issues={mockIssues} initialFilter="closed" />);
    expect(closedHtml).not.toContain('Fix edge case in blame age fraction calculation');
    expect(closedHtml).not.toContain('Add memory leak detector for blob buffers');
    expect(closedHtml).toContain('Support dark mode custom CSS variables');

    // All filter
    const allHtml = render(<IssuesView issues={mockIssues} initialFilter="all" />);
    expect(allHtml).toContain('Fix edge case in blame age fraction calculation');
    expect(allHtml).toContain('Add memory leak detector for blob buffers');
    expect(allHtml).toContain('Support dark mode custom CSS variables');
  });

  it('filters issues by instant search query across title, body, author, and #id', () => {
    // Search by title
    const titleHtml = render(
      <IssuesView issues={mockIssues} initialFilter="all" initialQuery="memory leak" />
    );
    expect(titleHtml).toContain('Add memory leak detector for blob buffers');
    expect(titleHtml).not.toContain('Fix edge case in blame');

    // Search by author
    const authorHtml = render(
      <IssuesView issues={mockIssues} initialFilter="all" initialQuery="Bob Smith" />
    );
    expect(authorHtml).toContain('Support dark mode custom CSS variables');
    expect(authorHtml).not.toContain('Add memory leak detector');

    // Search by #id
    const idHtml = render(
      <IssuesView issues={mockIssues} initialFilter="all" initialQuery="#1" />
    );
    expect(idHtml).toContain('Fix edge case in blame age fraction calculation');
    expect(idHtml).not.toContain('Support dark mode');
  });

  it('filters issues by label chip and author dropdown', () => {
    // Filter by label 'bug'
    const bugHtml = render(
      <IssuesView issues={mockIssues} initialFilter="all" initialLabel="bug" />
    );
    expect(bugHtml).toContain('Fix edge case in blame age fraction calculation');
    expect(bugHtml).not.toContain('Support dark mode');

    // Filter by author 'Charlie Dev'
    const authorHtml = render(
      <IssuesView issues={mockIssues} initialFilter="all" initialAuthor="Charlie Dev" />
    );
    expect(authorHtml).toContain('Add memory leak detector for blob buffers');
    expect(authorHtml).not.toContain('Fix edge case in blame');
  });

  it('renders empty states with clear filters action', () => {
    const emptyHtml = render(<IssuesView issues={[]} />);
    expect(emptyHtml).toContain('No issues found');
    expect(emptyHtml).toContain('data-testid="issues-empty-state"');

    const noMatchHtml = render(
      <IssuesView issues={mockIssues} initialFilter="open" initialQuery="nonexistent-xyz" />
    );
    expect(noMatchHtml).toContain('No issues match your filters');
    expect(noMatchHtml).toContain('data-testid="clear-filters-btn"');
  });

  it('renders comment counts and author avatars', () => {
    const html = render(<IssuesView issues={mockIssues} initialFilter="all" />);

    expect(html).toContain('💬');
    expect(html).toContain('AC'); // Alice Chen initials
    expect(html).toContain('BS'); // Bob Smith initials
    expect(html).toContain('CD'); // Charlie Dev initials
  });
});
