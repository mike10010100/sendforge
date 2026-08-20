import { describe, expect, it, vi } from 'vitest';
import render from 'preact-render-to-string';
import { IssueDetailView } from '../../src/ui/IssueDetailView.js';
import type { Issue } from '../../src/engine/collab-client.js';

describe('IssueDetailView Component (IssueDetailView.tsx)', () => {
  const mockIssue: Issue = {
    id: '5',
    number: 5,
    title: 'Sanitize markdown HTML output in Issue comments',
    description:
      '# Security Note\nEnsure all markdown output is sanitized and raw `<script>` tags are escaped.',
    author: { name: 'Sec Engineer', email: 'security@sendforge.local' },
    status: 'open',
    createdAt: 1740000000,
    updatedAt: 1740003000,
    labels: ['security', 'core'],
    comments: [
      {
        id: 'c1',
        author: { name: 'Reviewer One', email: 'reviewer@sendforge.local' },
        body: 'Implemented html escaping in `utils.ts`.',
        createdAt: 1740001000,
      },
      {
        id: 'c2',
        author: { name: 'Sec Engineer', email: 'security@sendforge.local' },
        body: 'Verified against XSS test vector payloads. Looks good!',
        createdAt: 1740002000,
      },
    ],
  };

  it('renders issue header with title, #id badge, and open status badge', () => {
    const html = render(
      <IssueDetailView issue={mockIssue} onBack={vi.fn()} />
    );

    expect(html).toContain('Sanitize markdown HTML output in Issue comments');
    expect(html).toContain('#5');
    expect(html).toContain('data-testid="issue-status-badge"');
    expect(html).toContain('Open');
    expect(html).toContain('Sec Engineer');
    expect(html).toContain('← Back to Issues');
    expect(html).toContain('2 comments');
  });

  it('renders closed status badge when issue status is closed', () => {
    const closedIssue: Issue = {
      ...mockIssue,
      status: 'closed',
    };
    const html = render(
      <IssueDetailView issue={closedIssue} onBack={vi.fn()} />
    );

    expect(html).toContain('Closed');
    expect(html).toContain('status-pill-closed');
  });

  it('renders Markdown-rendered original post and comments timeline', () => {
    const html = render(
      <IssueDetailView issue={mockIssue} onBack={vi.fn()} />
    );

    // Markdown rendered description
    expect(html).toContain('data-testid="issue-description-card"');
    expect(html).toContain('<h1>Security Note</h1>');
    expect(html).toContain('Ensure all markdown output is sanitized');

    // Comments timeline
    expect(html).toContain('data-testid="comments-timeline"');
    expect(html).toContain('data-testid="comment-card-c1"');
    expect(html).toContain('data-testid="comment-card-c2"');
    expect(html).toContain('Implemented html escaping in <code>utils.ts</code>.');
    expect(html).toContain('Verified against XSS test vector payloads.');
  });

  it('renders Author role badge on comments made by original issue author', () => {
    const html = render(
      <IssueDetailView issue={mockIssue} onBack={vi.fn()} />
    );

    expect(html).toContain('<span class="author-role-badge">Author</span>');
  });

  it('renders sidebar labels and unique participants list', () => {
    const html = render(
      <IssueDetailView issue={mockIssue} onBack={vi.fn()} />
    );

    expect(html).toContain('data-testid="sidebar-labels-section"');
    expect(html).toContain('security');
    expect(html).toContain('core');

    expect(html).toContain('data-testid="sidebar-participants-section"');
    expect(html).toContain('(2)'); // 2 unique participants: Sec Engineer and Reviewer One
    expect(html).toContain('Sec Engineer');
    expect(html).toContain('Reviewer One');
  });

  it('renders fallback when issue description is empty', () => {
    const noDescIssue: Issue = {
      ...mockIssue,
      description: '',
      comments: [],
      labels: [],
    };
    const html = render(
      <IssueDetailView issue={noDescIssue} onBack={vi.fn()} />
    );

    expect(html).toContain('<em>No description provided.</em>');
    expect(html).toContain('None yet'); // Empty labels text
  });
});
