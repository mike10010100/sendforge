import { describe, expect, it } from 'vitest';
import render from 'preact-render-to-string';
import { App } from '../../src/ui/App.js';

describe('App Navigation & 4-Tab Top Navbar (App.tsx)', () => {
  it('renders top navigation bar with 4 tabs and count badges', () => {
    const html = render(<App baseUrl="" />);

    expect(html).toContain('data-testid="nav-tab-code"');
    expect(html).toContain('data-testid="nav-tab-commits"');
    expect(html).toContain('data-testid="nav-tab-issues"');
    expect(html).toContain('data-testid="nav-tab-pulls"');

    expect(html).toContain('📁 Code');
    expect(html).toContain('📜 Commits');
    expect(html).toContain('🎯 Issues');
    expect(html).toContain('🔀 Pull Requests');

    expect(html).toContain('data-testid="commits-count-badge"');
    expect(html).toContain('data-testid="issues-count-badge"');
    expect(html).toContain('data-testid="pulls-count-badge"');
  });

  it('renders brand title and file finder action', () => {
    const html = render(<App baseUrl="" />);

    expect(html).toContain('Sendforge');
    expect(html).toContain('🔍 Find file');
    expect(html).toContain('Ctrl+K');
  });

  it('renders active class on default Code tab', () => {
    const html = render(<App baseUrl="" />);

    expect(html).toContain('nav-tab active" data-testid="nav-tab-code"');
  });
});
