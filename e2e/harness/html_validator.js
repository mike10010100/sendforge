/**
 * Zero-JS HTML Parser & Semantic Validator Helper
 * Parses and verifies static HTML fallback pages without executing JavaScript,
 * confirming semantic landmarks, file tree presence, README rendering, and XSS sanitization.
 */

import { assert } from './framework.js';

export class HtmlValidator {
  constructor(htmlString) {
    this.raw = htmlString || '';
  }

  /**
   * Check if standard HTML doctype and structure are present
   */
  assertValidDocument() {
    assert.match(this.raw, /<!DOCTYPE\s+html>/i, 'HTML must declare <!DOCTYPE html>');
    assert.match(this.raw, /<html[^>]*>/i, 'HTML must contain <html> root tag');
    assert.match(this.raw, /<head[^>]*>/i, 'HTML must contain <head> tag');
    assert.match(this.raw, /<body[^>]*>/i, 'HTML must contain <body> tag');
  }

  /**
   * Verify semantic HTML landmarks
   */
  assertSemanticLandmarks() {
    this.assertValidDocument();
    // Should have main content container or article
    const hasMain = /<main[^>]*>/i.test(this.raw) || /<article[^>]*>/i.test(this.raw) || /<div[^>]*class="[^"]*container[^"]*"[^>]*>/i.test(this.raw);
    assert.ok(hasMain, 'HTML must contain main or container semantic element');
  }

  /**
   * Verify file tree rendering in index.html fallback
   */
  assertFileTreeContains(expectedFiles = []) {
    for (const file of expectedFiles) {
      assert.includes(this.raw, file, `Static HTML must include filename "${file}" in the file tree`);
    }
  }

  /**
   * Verify pre-rendered README content in index.html fallback
   */
  assertReadmeRendered(expectedSnippets = []) {
    for (const snippet of expectedSnippets) {
      assert.includes(this.raw, snippet, `Static HTML must contain pre-rendered README snippet: "${snippet}"`);
    }
  }

  /**
   * Verify commit log entries in log.html fallback
   */
  assertCommitLogContains(expectedCommitHashesOrMessages = []) {
    for (const item of expectedCommitHashesOrMessages) {
      assert.includes(this.raw, item, `Static log.html must contain commit item: "${item}"`);
    }
  }

  /**
   * Verify XSS sanitization (no raw executable scripts or unsafe handlers)
   */
  assertNoXss(forbiddenPayloads = ['<script>alert', 'onerror=', 'onload=', 'javascript:']) {
    for (const payload of forbiddenPayloads) {
      // Must not appear as unescaped HTML tag or attribute
      const isDangerous = new RegExp(`<[^>]*${payload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(this.raw) ||
                          this.raw.includes('<script>alert');
      assert.ok(!isDangerous, `Static HTML must not contain unescaped XSS payload: "${payload}"`);
    }
  }

  /**
   * Extract title tag content
   */
  getTitle() {
    const match = this.raw.match(/<title[^>]*>(.*?)<\/title>/is);
    return match && match[1] ? match[1].trim() : '';
  }
}
