import { describe, expect, it } from 'vitest';
import {
  formatRoute,
  parseRoute,
  type Route,
  type RouteCode,
  type RouteCommit,
  type RouteCommits,
  type RouteIssue,
  type RouteIssues,
  type RoutePull,
  type RoutePulls,
} from '../../src/ui/router.js';

describe('Hash Router AST & Deep Linking (router.ts)', () => {
  describe('parseRoute', () => {
    it('parses empty and root hash variations', () => {
      expect(parseRoute('')).toEqual({ type: 'code' });
      expect(parseRoute('#')).toEqual({ type: 'code' });
      expect(parseRoute('#/')).toEqual({ type: 'code' });
      expect(parseRoute('###///')).toEqual({ type: 'code' });
      expect(parseRoute('   #/   ')).toEqual({ type: 'code' });
    });

    it('parses tree and blob routes with path decoding', () => {
      expect(parseRoute('#/tree/src/ui')).toEqual({
        type: 'code',
        path: 'src/ui',
      });
      expect(parseRoute('#/blob/src/ui/App.tsx')).toEqual({
        type: 'code',
        path: 'src/ui/App.tsx',
      });
      expect(parseRoute('#/blob/docs%2Fguide.md')).toEqual({
        type: 'code',
        path: 'docs/guide.md',
      });
    });

    it('parses blob line range permalinks (#L10, #L10-L20)', () => {
      const singleLine = parseRoute('#/blob/src/main.rs#L42');
      expect(singleLine).toEqual({
        type: 'code',
        path: 'src/main.rs',
        lineRange: { start: 42, end: 42 },
      });

      const multiLine = parseRoute('#/blob/src/main.rs#L10-L25');
      expect(multiLine).toEqual({
        type: 'code',
        path: 'src/main.rs',
        lineRange: { start: 10, end: 25 },
      });

      const commitBlob = parseRoute(
        '#/commit/4b825dc642cb6eb9a060e54bf8d69288fbee4904/blob/src/lib.rs#L5-L15'
      );
      expect(commitBlob).toEqual({
        type: 'code',
        ref: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
        path: 'src/lib.rs',
        lineRange: { start: 5, end: 15 },
      });
    });

    it('parses commits and log routes', () => {
      expect(parseRoute('#/commits')).toEqual({ type: 'commits' });
      expect(parseRoute('#/log')).toEqual({ type: 'commits' });
      expect(parseRoute('#/commits/feature-branch')).toEqual({
        type: 'commits',
        ref: 'feature-branch',
      });
      expect(parseRoute('#/commits/v1.0.0')).toEqual({
        type: 'commits',
        ref: 'v1.0.0',
      });
    });

    it('parses individual commit diff routes', () => {
      expect(parseRoute('#/commit/4b825dc')).toEqual({
        type: 'commit',
        sha: '4b825dc',
      });
      expect(
        parseRoute('#/commit/4B825DC642CB6EB9A060E54BF8D69288FBEE4904')
      ).toEqual({
        type: 'commit',
        sha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      });
    });

    it('parses issues list routes with query filters', () => {
      expect(parseRoute('#/issues')).toEqual({ type: 'issues' });
      expect(parseRoute('#/issues/')).toEqual({ type: 'issues' });

      const filtered = parseRoute(
        '#/issues?filter=closed&q=login+bug&label=bug&author=Alice'
      );
      expect(filtered).toEqual({
        type: 'issues',
        filter: 'closed',
        query: 'login bug',
        label: 'bug',
        author: 'Alice',
      });

      const openFilter = parseRoute('#/issues?filter=open');
      expect(openFilter).toEqual({
        type: 'issues',
        filter: 'open',
      });

      const allFilter = parseRoute('#/issues?filter=all');
      expect(allFilter).toEqual({
        type: 'issues',
        filter: 'all',
      });

      const invalidFilter = parseRoute('#/issues?filter=invalid');
      expect(invalidFilter).toEqual({
        type: 'issues',
      });
    });

    it('parses issue detail routes', () => {
      expect(parseRoute('#/issues/1')).toEqual({
        type: 'issue',
        id: '1',
      });
      expect(parseRoute('#/issues/42')).toEqual({
        type: 'issue',
        id: '42',
      });
      expect(parseRoute('#/issues/feat%23123')).toEqual({
        type: 'issue',
        id: 'feat#123',
      });
    });

    it('parses pull requests list routes with query filters', () => {
      expect(parseRoute('#/pulls')).toEqual({ type: 'pulls' });
      expect(parseRoute('#/pulls/')).toEqual({ type: 'pulls' });

      const filtered = parseRoute(
        '#/pulls?filter=merged&q=refactor&label=core&author=Bob'
      );
      expect(filtered).toEqual({
        type: 'pulls',
        filter: 'merged',
        query: 'refactor',
        label: 'core',
        author: 'Bob',
      });

      const openFilter = parseRoute('#/pulls?filter=open');
      expect(openFilter).toEqual({
        type: 'pulls',
        filter: 'open',
      });
    });

    it('parses pull request detail routes and sub-tabs', () => {
      expect(parseRoute('#/pulls/1')).toEqual({
        type: 'pull',
        id: '1',
        tab: 'conversation',
      });
      expect(parseRoute('#/pulls/1/')).toEqual({
        type: 'pull',
        id: '1',
        tab: 'conversation',
      });
      expect(parseRoute('#/pulls/1/conversation')).toEqual({
        type: 'pull',
        id: '1',
        tab: 'conversation',
      });
      expect(parseRoute('#/pulls/1/commits')).toEqual({
        type: 'pull',
        id: '1',
        tab: 'commits',
      });
      expect(parseRoute('#/pulls/1/files')).toEqual({
        type: 'pull',
        id: '1',
        tab: 'files',
      });
    });
  });

  describe('formatRoute', () => {
    it('formats code root and blob routes', () => {
      const root: RouteCode = { type: 'code' };
      expect(formatRoute(root)).toBe('#/');

      const blob: RouteCode = { type: 'code', path: 'src/main.rs' };
      expect(formatRoute(blob)).toBe('#/blob/src/main.rs');

      const blobWithLine: RouteCode = {
        type: 'code',
        path: 'src/main.rs',
        lineRange: { start: 10, end: 10 },
      };
      expect(formatRoute(blobWithLine)).toBe('#/blob/src/main.rs#L10');

      const blobWithRange: RouteCode = {
        type: 'code',
        path: 'src/main.rs',
        lineRange: { start: 10, end: 20 },
      };
      expect(formatRoute(blobWithRange)).toBe('#/blob/src/main.rs#L10-L20');

      const commitBlob: RouteCode = {
        type: 'code',
        ref: '4b825dc',
        path: 'src/main.rs',
        lineRange: { start: 5, end: 15 },
      };
      expect(formatRoute(commitBlob)).toBe('#/commit/4b825dc/blob/src/main.rs#L5-L15');
    });

    it('formats commits routes', () => {
      const commits: RouteCommits = { type: 'commits' };
      expect(formatRoute(commits)).toBe('#/commits');

      const refCommits: RouteCommits = { type: 'commits', ref: 'main' };
      expect(formatRoute(refCommits)).toBe('#/commits/main');
    });

    it('formats commit diff routes', () => {
      const commit: RouteCommit = { type: 'commit', sha: '4b825dc' };
      expect(formatRoute(commit)).toBe('#/commit/4b825dc');
    });

    it('formats issues routes with and without query params', () => {
      const issues: RouteIssues = { type: 'issues' };
      expect(formatRoute(issues)).toBe('#/issues');

      const filteredIssues: RouteIssues = {
        type: 'issues',
        filter: 'closed',
        query: 'search term',
        label: 'bug',
        author: 'Alice',
      };
      const formatted = formatRoute(filteredIssues);
      expect(formatted).toContain('#/issues?');
      expect(formatted).toContain('filter=closed');
      expect(formatted).toContain('q=search+term');
      expect(formatted).toContain('label=bug');
      expect(formatted).toContain('author=Alice');

      const issueDetail: RouteIssue = { type: 'issue', id: '42' };
      expect(formatRoute(issueDetail)).toBe('#/issues/42');
    });

    it('formats pull requests routes with and without query params', () => {
      const pulls: RoutePulls = { type: 'pulls' };
      expect(formatRoute(pulls)).toBe('#/pulls');

      const filteredPulls: RoutePulls = {
        type: 'pulls',
        filter: 'merged',
        query: 'ui polish',
      };
      const formatted = formatRoute(filteredPulls);
      expect(formatted).toContain('#/pulls?');
      expect(formatted).toContain('filter=merged');
      expect(formatted).toContain('q=ui+polish');

      const prDetailConv: RoutePull = { type: 'pull', id: '1' };
      expect(formatRoute(prDetailConv)).toBe('#/pulls/1');

      const prDetailCommits: RoutePull = { type: 'pull', id: '1', tab: 'commits' };
      expect(formatRoute(prDetailCommits)).toBe('#/pulls/1/commits');

      const prDetailFiles: RoutePull = { type: 'pull', id: '1', tab: 'files' };
      expect(formatRoute(prDetailFiles)).toBe('#/pulls/1/files');
    });

    it('guarantees round-trip fidelity for canonical routes', () => {
      const testCases: Route[] = [
        { type: 'code' },
        { type: 'commits' },
        { type: 'commit', sha: '4b825dc' },
        { type: 'issues' },
        { type: 'issue', id: '12' },
        { type: 'pulls' },
        { type: 'pull', id: '3', tab: 'commits' },
        { type: 'pull', id: '3', tab: 'files' },
      ];

      for (const route of testCases) {
        const hash = formatRoute(route);
        const parsed = parseRoute(hash);
        expect(parsed).toEqual(route);
      }
    });
  });
});
