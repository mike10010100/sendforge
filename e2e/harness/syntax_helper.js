/**
 * Syntax Engine Reference Harness
 * Validates language detection across 50+ languages, lexical tokenization,
 * multi-line state preservation, WCAG 2.1 AA/AAA contrast ratios,
 * and search highlight overlay HTML formatting.
 */

export const SUPPORTED_LANGUAGES = [
  'rust', 'typescript', 'javascript', 'python', 'go', 'c', 'cpp', 'html', 'css',
  'json', 'yaml', 'toml', 'markdown', 'shell', 'sql', 'diff', 'zig', 'nix',
  'ruby', 'java', 'kotlin', 'swift', 'lua', 'php', 'csharp', 'dart', 'elixir',
  'erlang', 'haskell', 'ocaml', 'scala', 'r', 'perl', 'julia', 'clojure', 'lisp',
  'scheme', 'fortran', 'assembly', 'dockerfile', 'makefile', 'graphql', 'protobuf',
  'terraform', 'wgsl', 'glsl', 'vim', 'powershell', 'groovy', 'ini'
];

export const EXTENSION_MAP = {
  '.rs': 'rust',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.sass': 'css',
  '.less': 'css',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.sql': 'sql',
  '.diff': 'diff',
  '.patch': 'diff',
  '.zig': 'zig',
  '.nix': 'nix',
  '.rb': 'ruby',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.lua': 'lua',
  '.php': 'php',
  '.cs': 'csharp',
  '.dart': 'dart',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  '.scala': 'scala',
  '.r': 'r',
  '.R': 'r',
  '.pl': 'perl',
  '.pm': 'perl',
  '.jl': 'julia',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.lisp': 'lisp',
  '.lsp': 'lisp',
  '.scm': 'scheme',
  '.f90': 'fortran',
  '.f95': 'fortran',
  '.s': 'assembly',
  '.asm': 'assembly',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'protobuf',
  '.tf': 'terraform',
  '.hcl': 'terraform',
  '.wgsl': 'wgsl',
  '.glsl': 'glsl',
  '.vert': 'glsl',
  '.frag': 'glsl',
  '.vim': 'vim',
  '.ps1': 'powershell',
  '.groovy': 'groovy',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini'
};

export const FILENAME_MAP = {
  'dockerfile': 'dockerfile',
  'containerfile': 'dockerfile',
  'makefile': 'makefile',
  'gnumakefile': 'makefile',
  'cmakelists.txt': 'makefile',
  'cargo.toml': 'toml',
  'package.json': 'json',
  'tsconfig.json': 'json'
};

export class SyntaxValidator {
  /**
   * Detect language from file path or filename
   */
  static detectLanguage(filePath) {
    const filename = filePath.split('/').pop().toLowerCase();
    if (FILENAME_MAP[filename]) {
      return FILENAME_MAP[filename];
    }
    const extIdx = filename.lastIndexOf('.');
    if (extIdx !== -1) {
      const ext = filename.slice(extIdx);
      if (EXTENSION_MAP[ext]) {
        return EXTENSION_MAP[ext];
      }
    }
    return 'plain';
  }

  /**
   * Calculate relative luminance according to WCAG 2.1
   */
  static getRelativeLuminance(hexColor) {
    let hex = hexColor.replace(/^#/, '');
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    const num = parseInt(hex, 16);
    const r8 = (num >> 16) & 255;
    const g8 = (num >> 8) & 255;
    const b8 = num & 255;

    const sRGB = [r8 / 255, g8 / 255, b8 / 255].map(v => {
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
  }

  /**
   * Calculate WCAG 2.1 contrast ratio between two hex colors
   */
  static getContrastRatio(fgHex, bgHex) {
    const l1 = this.getRelativeLuminance(fgHex);
    const l2 = this.getRelativeLuminance(bgHex);
    const brighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (brighter + 0.05) / (darker + 0.05);
  }

  /**
   * Escape HTML special characters
   */
  static escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Overlay search highlight on tokens
   */
  static applySearchHighlight(tokens, searchQuery) {
    if (!searchQuery || searchQuery.trim() === '') {
      return tokens.map(t => `<span class="tok-${t.type}">${this.escapeHtml(t.text)}</span>`).join('');
    }

    const queryLower = searchQuery.toLowerCase();
    let resultHtml = '';

    for (const token of tokens) {
      const text = token.text;
      const textLower = text.toLowerCase();
      let lastIdx = 0;
      let matchIdx = textLower.indexOf(queryLower);

      if (matchIdx === -1) {
        resultHtml += `<span class="tok-${token.type}">${this.escapeHtml(text)}</span>`;
        continue;
      }

      resultHtml += `<span class="tok-${token.type}">`;
      while (matchIdx !== -1) {
        if (matchIdx > lastIdx) {
          resultHtml += this.escapeHtml(text.slice(lastIdx, matchIdx));
        }
        const matchText = text.slice(matchIdx, matchIdx + searchQuery.length);
        resultHtml += `<mark class="search-match">${this.escapeHtml(matchText)}</mark>`;
        lastIdx = matchIdx + searchQuery.length;
        matchIdx = textLower.indexOf(queryLower, lastIdx);
      }
      if (lastIdx < text.length) {
        resultHtml += this.escapeHtml(text.slice(lastIdx));
      }
      resultHtml += `</span>`;
    }

    return resultHtml;
  }
}
