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

/**
 * Lightweight, safe CommonMark subset renderer for READMEs and markdown files.
 */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const htmlParts: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let inList = false;

  for (const rawLine of lines) {
    // Code block detection
    if (rawLine.startsWith('```')) {
      if (inCodeBlock) {
        htmlParts.push(
          `<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(
            codeLines.join('\n')
          )}</code></pre>`
        );
        inCodeBlock = false;
        codeLines = [];
      } else {
        if (inList) {
          htmlParts.push('</ul>');
          inList = false;
        }
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
      if (inList) {
        htmlParts.push('</ul>');
        inList = false;
      }
      continue;
    }

    // Headers
    if (trimmed.startsWith('# ')) {
      htmlParts.push(`<h1>${formatInlineMarkdown(trimmed.slice(2))}</h1>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      htmlParts.push(`<h2>${formatInlineMarkdown(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      htmlParts.push(`<h3>${formatInlineMarkdown(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith('#### ')) {
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
      htmlParts.push('</ul>');
      inList = false;
    }

    // Paragraph
    htmlParts.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
  }

  if (inCodeBlock) {
    htmlParts.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  if (inList) {
    htmlParts.push('</ul>');
  }

  return htmlParts.join('\n');
}

function formatInlineMarkdown(text: string): string {
  let res = escapeHtml(text);
  // Inline code: `code`
  res = res.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold: **text**
  res = res.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *text*
  res = res.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Links: [label](url)
  res = res.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return res;
}
