export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const num = (bytes / Math.pow(k, i)).toFixed(1);
  return `${num} ${sizes[i] ?? 'B'}`;
}

export function formatSha(sha: string, len = 7): string {
  return sha.slice(0, len);
}

export function formatRelativeTime(timestampInSeconds: number): string {
  if (!timestampInSeconds) return 'Unknown';
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - timestampInSeconds);

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;

  const date = new Date(timestampInSeconds * 1000);
  return date.toISOString().slice(0, 10);
}

export function formatIsoDate(timestampInSeconds: number): string {
  if (!timestampInSeconds) return 'Unknown';
  const date = new Date(timestampInSeconds * 1000);
  return date.toUTCString();
}

/**
 * Escapes raw HTML strings to avoid XSS injections.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stripFormattingHtmlTags(text: string): string {
  return text
    .replace(/^<\/?(p|div|center|span)(\s+[^>]*)?>/gi, '')
    .replace(/<\/?(p|div|center|span)(\s+[^>]*)?>$/gi, '')
    .trim();
}

function renderTable(rows: string[]): string {
  if (rows.length < 2) return rows.map((r) => `<p>${formatInlineMarkdown(r)}</p>`).join('\n');
  const headerRow = rows[0];
  if (!headerRow) return '';

  const parseCells = (row: string) =>
    row
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());

  const headers = parseCells(headerRow);
  const bodyRows = rows.slice(2);

  let html = '<div class="table-wrapper"><table class="markdown-table"><thead><tr>';
  for (const h of headers) {
    html += `<th>${formatInlineMarkdown(h)}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const row of bodyRows) {
    const cells = parseCells(row);
    html += '<tr>';
    for (let i = 0; i < headers.length; i++) {
      html += `<td>${formatInlineMarkdown(cells[i] ?? '')}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  return html;
}

/**
 * Lightweight, safe, feature-rich CommonMark subset renderer for READMEs and markdown files.
 */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const htmlParts: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let inList = false;
  let inBlockquote = false;
  let blockquoteLines: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];

  const flushList = () => {
    if (inList) {
      htmlParts.push('</ul>');
      inList = false;
    }
  };

  const flushBlockquote = () => {
    if (inBlockquote) {
      htmlParts.push(
        `<blockquote><p>${blockquoteLines.map((l) => formatInlineMarkdown(l)).join('<br />')}</p></blockquote>`
      );
      inBlockquote = false;
      blockquoteLines = [];
    }
  };

  const flushTable = () => {
    if (inTable) {
      htmlParts.push(renderTable(tableRows));
      inTable = false;
      tableRows = [];
    }
  };

  for (const rawLine of lines) {
    // Code block detection
    if (rawLine.startsWith('```')) {
      flushList();
      flushBlockquote();
      flushTable();
      if (inCodeBlock) {
        htmlParts.push(
          `<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(
            codeLines.join('\n')
          )}</code></pre>`
        );
        inCodeBlock = false;
        codeLines = [];
      } else {
        inCodeBlock = true;
        codeLang = rawLine.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }

    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushList();
      flushBlockquote();
      flushTable();
      continue;
    }

    // Horizontal Rules
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      flushList();
      flushBlockquote();
      flushTable();
      htmlParts.push('<hr />');
      continue;
    }

    // Blockquotes
    if (trimmed.startsWith('>')) {
      flushList();
      flushTable();
      inBlockquote = true;
      blockquoteLines.push(trimmed.replace(/^>\s*/, ''));
      continue;
    } else if (inBlockquote) {
      flushBlockquote();
    }

    // Table rows
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushList();
      flushBlockquote();
      inTable = true;
      tableRows.push(trimmed);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Headers
    if (trimmed.startsWith('# ')) {
      flushList();
      htmlParts.push(`<h1>${formatInlineMarkdown(trimmed.slice(2))}</h1>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      htmlParts.push(`<h2>${formatInlineMarkdown(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushList();
      htmlParts.push(`<h3>${formatInlineMarkdown(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith('#### ')) {
      flushList();
      htmlParts.push(`<h4>${formatInlineMarkdown(trimmed.slice(5))}</h4>`);
      continue;
    }

    // Lists
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) {
        htmlParts.push('<ul>');
        inList = true;
      }
      htmlParts.push(`<li>${formatInlineMarkdown(trimmed.slice(2))}</li>`);
      continue;
    } else if (inList) {
      flushList();
    }

    const sanitizedLine = stripFormattingHtmlTags(trimmed);
    if (!sanitizedLine) {
      continue;
    }

    // Paragraph
    htmlParts.push(`<p>${formatInlineMarkdown(sanitizedLine)}</p>`);
  }

  if (inCodeBlock) {
    htmlParts.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  flushList();
  flushBlockquote();
  flushTable();

  return htmlParts.join('\n');
}

function formatInlineMarkdown(text: string): string {
  let res = text;

  // Linked badges/images: [![alt](imgUrl)](linkUrl)
  res = res.replace(
    /\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)/g,
    '<a href="$3" target="_blank" rel="noopener noreferrer"><img src="$2" alt="$1" class="md-badge" /></a>'
  );

  // Standalone images: ![alt](imgUrl)
  res = res.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" class="md-image" />'
  );

  // Raw <a><img .../></a> if present
  res = res.replace(
    /<a\s+href="([^"]+)"\s*>\s*<img\s+src="([^"]+)"\s*(?:alt="([^"]*)")?\s*\/?>\s*<\/a>/gi,
    '<a href="$1" target="_blank" rel="noopener noreferrer"><img src="$2" alt="$3" class="md-badge" /></a>'
  );

  // Raw <img .../> if present
  res = res.replace(
    /<img\s+src="([^"]+)"\s*(?:alt="([^"]*)")?\s*(?:width="[^"]*")?\s*\/?>/gi,
    '<img src="$1" alt="$2" class="md-image" />'
  );

  // Preserve inline code spans: `code`
  const codeSpans: string[] = [];
  res = res.replace(/`([^`]+)`/g, (_match, p1: string) => {
    codeSpans.push(escapeHtml(p1));
    return `__CODE_SPAN_${codeSpans.length - 1}__`;
  });

  // Regular links: [label](url)
  res = res.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Bold: **text**
  res = res.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *text*
  res = res.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Restore inline code spans
  res = res.replace(/__CODE_SPAN_(\d+)__/g, (_match, idxStr: string) => {
    const idx = parseInt(idxStr, 10);
    return `<code>${codeSpans[idx] ?? ''}</code>`;
  });

  return res;
}

/**
 * Calculates a normalized age fraction [0.0, 1.0] where 1.0 represents the newest commit
 * and 0.0 represents the oldest commit in the blame scope.
 */
export function calculateAgeFraction(
  timestamp: number,
  oldestTimestamp: number,
  newestTimestamp: number
): number {
  if (newestTimestamp <= oldestTimestamp) {
    return 1.0;
  }
  const fraction = (timestamp - oldestTimestamp) / (newestTimestamp - oldestTimestamp);
  return Math.max(0, Math.min(1, fraction));
}

/**
 * Calculates normalized linear intensity between 0.0 (oldest) and 1.0 (newest).
 * Returns 0.5 when timestamps are invalid or identical.
 */
export function calculateHeatmapIntensity(
  timestamp: number,
  oldestTimestamp: number,
  newestTimestamp: number
): number {
  if (!timestamp || Number.isNaN(timestamp)) {
    return 0.5;
  }
  if (oldestTimestamp === newestTimestamp) {
    return 0.5;
  }
  const fraction = (timestamp - oldestTimestamp) / (newestTimestamp - oldestTimestamp);
  return Math.max(0, Math.min(1, fraction));
}

/**
 * Maps an age fraction to CSS colors for the blame heatmap border and background tint.
 * - Newest commits receive a vivid accent border with higher opacity.
 * - Oldest commits receive a calm, muted slate border with lower opacity.
 */
export function getHeatmapColor(ageFraction: number): {
  borderColor: string;
  bgColor: string;
} {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ageFraction) ? ageFraction : 0.5));
  const borderAlpha = 0.25 + clamped * 0.75;
  const bgAlpha = 0.02 + clamped * 0.06;

  return {
    borderColor: `rgba(88, 166, 255, ${borderAlpha.toFixed(2)})`,
    bgColor: `rgba(56, 139, 253, ${bgAlpha.toFixed(3)})`,
  };
}

/**
 * Extracts 1-2 uppercase initial characters from an author's name.
 * e.g. "Linus Torvalds" -> "LT", "Alice" -> "AL", "bob" -> "BO", "" -> "??"
 */
export function getAuthorInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '??';
  const parts = trimmed.split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) {
    const chars = Array.from(parts[0] ?? '');
    const single = chars.slice(0, 2).join('');
    return single.toUpperCase() || '??';
  }
  const firstChars = Array.from(parts[0] ?? '');
  const lastChars = Array.from(parts[parts.length - 1] ?? '');
  const first = firstChars[0] ?? '';
  const last = lastChars[0] ?? '';
  return (first + last).toUpperCase() || '??';
}

/**
 * Deterministically generates an accessible, vibrant HSL color string for an avatar
 * based on the author's name and email.
 */
export function getAuthorColor(name: string, email?: string): string {
  const seed = (email !== undefined && email !== '' ? email : (name !== '' ? name : 'default-author')).toLowerCase();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 42%)`;
}


/**
 * Extracts the subject line (first line) of a commit message.
 */
export function formatCommitSummary(message: string): string {
  if (!message) return '';
  const firstLine = message.split(/\r?\n/)[0] ?? '';
  return firstLine.trim();
}

/**
 * Represents a 1-based inclusive range of lines in a file.
 */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

export function parseLineHash(hash: string): LineRange | null {
  if (!hash) return null;
  const m = /(?:^|[#/])[lL](\d+)(?:-[lL](\d+))?$/i.exec(hash);
  if (!m?.[1]) return null;
  const s = parseInt(m[1], 10);
  const e = m[2] !== undefined ? parseInt(m[2], 10) : s;
  if (Number.isNaN(s) || Number.isNaN(e) || s < 1 || e < 1) return null;
  return { start: Math.min(s, e), end: Math.max(s, e) };
}

export function formatLineHash(start: number, end?: number): string {
  if (!start || !Number.isFinite(start) || start < 1) return '';
  if (end === undefined || !Number.isFinite(end) || end < 1 || end === start) {
    return `#L${Math.floor(start)}`;
  }
  const min = Math.floor(Math.min(start, end));
  const max = Math.floor(Math.max(start, end));
  return min === max ? `#L${min}` : `#L${min}-L${max}`;
}

export function buildPermalinkUrl(
  repoNameOrCommit: string,
  commitOidOrFilePath: string,
  filePathOrRange?: string | LineRange | null,
  maybeRange?: LineRange | null
): string {
  const is4 = typeof filePathOrRange === 'string';
  const commitOid = is4 ? commitOidOrFilePath : repoNameOrCommit;
  const filePath = is4 ? filePathOrRange : commitOidOrFilePath;
  const range = is4 ? maybeRange : filePathOrRange;
  const cleanPath = filePath.replace(/^\/+/, '');
  const hash = range && range.start >= 1 ? formatLineHash(range.start, range.end) : '';
  return `#/commit/${commitOid}/blob/${cleanPath}${hash}`;
}


