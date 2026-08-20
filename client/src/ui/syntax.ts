/**
 * Sendforge Modular In-Browser Syntax Highlighting Engine
 * Zero-dependency, deterministic tokenizer supporting 60+ languages with
 * multi-line state preservation, O(1) line caching, search match overlays,
 * and WCAG 2.1 AA/AAA dark theme compatibility.
 */

export type TokenType =
  | 'keyword'
  | 'type'
  | 'string'
  | 'comment'
  | 'number'
  | 'function'
  | 'operator'
  | 'preprocessor'
  | 'punctuation'
  | 'plain'
  | 'tag'
  | 'attribute'
  | 'variable'
  | 'constant'
  | 'regex'
  | 'property';

export interface Token {
  readonly type: TokenType;
  readonly text: string;
}

export type SyntaxToken = Token;
export type TokenizedLine = readonly Token[];

export interface MultiLineState {
  readonly kind?:
    | 'none'
    | 'block-comment'
    | 'html-comment'
    | 'haskell-comment'
    | 'lua-comment'
    | 'ocaml-comment'
    | 'multiline-string'
    | 'heredoc'
    | 'raw-string';
  readonly inBlockComment?: boolean;
  readonly commentDelimiter?: string;
  readonly commentDepth?: number;
  readonly inMultiLineString?: boolean;
  readonly stringDelimiter?: string;
  readonly inHeredoc?: boolean;
  readonly heredocDelimiter?: string;
  readonly rawStringHashes?: number;
  readonly depth?: number;
  readonly quote?: string;
  readonly marker?: string;
  readonly hashes?: number;
}

export interface TokenizeLineResult {
  readonly tokens: Token[];
  readonly stateOut: MultiLineState;
}

export interface HighlightedFileResult {
  readonly language: string;
  readonly lines: readonly Token[][];
}

export interface SyntaxCacheEntry {
  readonly text: string;
  readonly stateIn: MultiLineState;
  readonly stateOut: MultiLineState;
  readonly tokens: Token[];
}

/**
 * Line-indexed syntax cache for O(1) lookups during rendering and scrolling.
 */
export class LineSyntaxCache {
  private readonly entries = new Map<number, SyntaxCacheEntry>();
  private language = '';
  private textFingerprint = '';

  public reset(language = '', textFingerprint = ''): void {
    if (this.language !== language || this.textFingerprint !== textFingerprint) {
      this.entries.clear();
      this.language = language;
      this.textFingerprint = textFingerprint;
    }
  }

  public invalidate(): void {
    this.entries.clear();
    this.language = '';
    this.textFingerprint = '';
  }

  public clear(): void {
    this.invalidate();
  }

  public get(lineIdx: number): SyntaxCacheEntry | undefined {
    return this.entries.get(lineIdx);
  }

  public set(lineIdx: number, entry: SyntaxCacheEntry): void {
    this.entries.set(lineIdx, entry);
  }

  public tokenizeLine(lineText: string, lineIndex: number, language: string): Token[] {
    const cached = this.entries.get(lineIndex);
    if (cached?.text === lineText && this.language === language) {
      return [...cached.tokens];
    }
    const prevState = lineIndex > 0 ? this.entries.get(lineIndex - 1)?.stateOut ?? {} : {};
    const res = tokenizeLine(lineText, prevState, language);
    this.entries.set(lineIndex, {
      text: lineText,
      stateIn: prevState,
      stateOut: res.stateOut,
      tokens: res.tokens,
    });
    return [...res.tokens];
  }
}

// Language Definition Interface
interface BlockCommentRule {
  readonly start: string;
  readonly end: string;
  readonly nested?: boolean;
}

interface LanguageDef {
  readonly name: string;
  readonly keywords?: Set<string>;
  readonly types?: Set<string>;
  readonly builtins?: Set<string>;
  readonly lineComments?: readonly string[];
  readonly blockComments?: readonly BlockCommentRule[];
  readonly stringDelimiters?: readonly string[];
  readonly tripleQuotes?: readonly string[];
  readonly supportsHeredoc?: boolean;
  readonly preprocessors?: RegExp;
  readonly customLineTokenizer?: (
    line: string,
    stateIn: MultiLineState
  ) => TokenizeLineResult | null;
}

// Extension and Filename Mapping
const EXTENSION_MAP: Record<string, string> = {
  // Systems & Low-Level
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  hh: 'cpp',
  'c++': 'cpp',
  'h++': 'cpp',
  cs: 'csharp',
  csx: 'csharp',
  zig: 'zig',
  go: 'go',
  d: 'd',
  di: 'd',
  s: 'assembly',
  asm: 'assembly',
  nasm: 'assembly',
  wat: 'wat',
  wast: 'wat',
  nim: 'nim',
  nims: 'nim',
  nimble: 'nim',
  v: 'v',
  f: 'fortran',
  for: 'fortran',
  f90: 'fortran',
  f95: 'fortran',
  f03: 'fortran',
  f08: 'fortran',
  adb: 'ada',
  ads: 'ada',
  ha: 'hare',

  // Web & Scripting
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  tsx: 'tsx',
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  php: 'php',
  phtml: 'php',
  php3: 'php',
  php4: 'php',
  php5: 'php',
  phps: 'php',
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',
  t: 'perl',
  sh: 'bash',
  bash: 'bash',
  zsh: 'zsh',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  r: 'r',
  jl: 'julia',
  tcl: 'tcl',
  tk: 'tcl',
  applescript: 'applescript',
  scpt: 'applescript',
  groovy: 'groovy',
  gvy: 'groovy',
  gy: 'groovy',
  gsh: 'groovy',

  // Functional & VM
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  sc: 'scala',
  swift: 'swift',
  hs: 'haskell',
  lhs: 'haskell',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hrl: 'erlang',
  clj: 'clojure',
  cljs: 'clojure',
  cljc: 'clojure',
  edn: 'clojure',
  ml: 'ocaml',
  mli: 'ocaml',
  fs: 'fsharp',
  fsi: 'fsharp',
  fsx: 'fsharp',
  dart: 'dart',

  // Data, Config & Schemas
  json: 'json',
  jsonc: 'jsonc',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  svg: 'xml',
  plist: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  wsdl: 'xml',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  nix: 'nix',
  dockerfile: 'dockerfile',
  mk: 'makefile',
  cmake: 'cmake',
  proto: 'protobuf',
  tf: 'terraform',
  tfvars: 'terraform',
  hcl: 'terraform',
  wgsl: 'wgsl',
  glsl: 'glsl',
  vert: 'glsl',
  frag: 'glsl',
  geom: 'glsl',
  comp: 'glsl',
  tesc: 'glsl',
  tese: 'glsl',

  // Documents & Formats
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mkdn: 'markdown',
  mdx: 'markdown',
  diff: 'diff',
  patch: 'diff',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  properties: 'ini',
  env: 'ini',
  editorconfig: 'ini',
  gitconfig: 'ini',
  tex: 'latex',
  sty: 'latex',
  cls: 'latex',
  dtx: 'latex',
  ins: 'latex',
  bib: 'bibtex',
  csv: 'csv',
  tsv: 'csv',
  log: 'log',
};

const FILENAME_MAP: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  cmakelists_txt: 'cmake',
  rakefile: 'ruby',
  gemfile: 'ruby',
  capfile: 'ruby',
  vagrantfile: 'ruby',
  jenkinsfile: 'groovy',
  _bashrc: 'bash',
  _bash_profile: 'bash',
  _zshrc: 'zsh',
  _profile: 'bash',
  _gitconfig: 'ini',
  _editorconfig: 'ini',
  _env: 'ini',
  cargo_toml: 'toml',
  cargo_lock: 'toml',
  gopkg_toml: 'toml',
  pipfile: 'toml',
  tsconfig_json: 'jsonc',
  jsconfig_json: 'jsonc',
};

/**
 * Fast extension and filename matcher to detect language.
 */
export function detectLanguage(pathOrFilename: string): string {
  if (!pathOrFilename) return 'plain';
  const clean = pathOrFilename.replace(/\\/g, '/');
  const baseName = (clean.split('/').pop() ?? clean).toLowerCase();

  const normalizedFileName = baseName.replace(/^[.]/, '_').replace(/[.]/g, '_');
  if (normalizedFileName in FILENAME_MAP) {
    const lang = FILENAME_MAP[normalizedFileName];
    if (lang) return lang;
  }
  if (baseName.startsWith('dockerfile')) {
    return 'dockerfile';
  }

  const dotIdx = baseName.lastIndexOf('.');
  if (dotIdx !== -1 && dotIdx < baseName.length - 1) {
    const ext = baseName.slice(dotIdx + 1);
    if (ext in EXTENSION_MAP) {
      const lang = EXTENSION_MAP[ext];
      if (lang) return lang;
    }
  }

  return 'plain';
}

function makeSet(words: readonly string[]): Set<string> {
  return new Set(words);
}

// ----------------------------------------------------------------------------
// Language Catalog & Grammars
// ----------------------------------------------------------------------------

const RUST_KEYWORDS = makeSet([
  'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else',
  'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop',
  'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self',
  'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use',
  'where', 'while', 'yield',
]);

const RUST_TYPES = makeSet([
  'bool', 'char', 'i8', 'i16', 'i32', 'i64', 'i128', 'isize',
  'u8', 'u16', 'u32', 'u64', 'u128', 'usize', 'f32', 'f64',
  'str', 'String', 'Vec', 'Option', 'Result', 'Some', 'None', 'Ok', 'Err',
  'Box', 'Rc', 'Arc', 'Cell', 'RefCell', 'HashMap', 'HashSet', 'BTreeMap', 'BTreeSet',
]);

const C_KEYWORDS = makeSet([
  'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do',
  'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline',
  'int', 'long', 'register', 'restrict', 'return', 'short', 'signed', 'sizeof',
  'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile',
  'while', '_Alignas', '_Alignof', '_Atomic', '_Bool', '_Complex', '_Generic',
  '_Imaginary', '_Noreturn', '_Static_assert', '_Thread_local',
]);

const C_TYPES = makeSet([
  'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'size_t', 'ssize_t', 'uintptr_t', 'intptr_t', 'ptrdiff_t', 'bool', 'true', 'false',
  'NULL', 'FILE',
]);

const CPP_KEYWORDS = makeSet([
  ...C_KEYWORDS,
  'alignas', 'alignof', 'and', 'and_eq', 'asm', 'bitand', 'bitor', 'catch', 'class',
  'compl', 'concept', 'consteval', 'constexpr', 'constinit', 'const_cast', 'co_await',
  'co_return', 'co_yield', 'decltype', 'delete', 'dynamic_cast', 'explicit', 'export',
  'final', 'friend', 'import', 'module', 'mutable', 'namespace', 'new', 'noexcept',
  'not', 'not_eq', 'nullptr', 'operator', 'or', 'or_eq', 'override', 'private',
  'protected', 'public', 'reinterpret_cast', 'requires', 'static_assert', 'static_cast',
  'template', 'this', 'thread_local', 'throw', 'try', 'typeid', 'typename', 'using',
  'virtual', 'xor', 'xor_eq',
]);

const CPP_TYPES = makeSet([
  ...C_TYPES,
  'string', 'wstring', 'u16string', 'u32string', 'string_view',
  'vector', 'map', 'unordered_map', 'set', 'unordered_set', 'pair', 'tuple',
  'unique_ptr', 'shared_ptr', 'weak_ptr', 'optional', 'variant', 'any', 'array',
]);

const CSHARP_KEYWORDS = makeSet([
  'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char',
  'checked', 'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do',
  'double', 'else', 'enum', 'event', 'explicit', 'extern', 'false', 'finally',
  'fixed', 'float', 'for', 'foreach', 'goto', 'if', 'implicit', 'in', 'int',
  'interface', 'internal', 'is', 'lock', 'long', 'namespace', 'new', 'null',
  'object', 'operator', 'out', 'override', 'params', 'private', 'protected',
  'public', 'readonly', 'record', 'ref', 'return', 'sbyte', 'sealed', 'short',
  'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this',
  'throw', 'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe',
  'ushort', 'using', 'var', 'virtual', 'void', 'volatile', 'while', 'yield',
  'async', 'await', 'get', 'set', 'init', 'value', 'global',
]);

const CSHARP_TYPES = makeSet([
  'Task', 'List', 'Dictionary', 'Action', 'Func', 'Nullable', 'Span', 'Memory',
  'IEnumerable', 'ICollection', 'IList', 'IDictionary', 'Guid', 'DateTime', 'TimeSpan',
]);

const ZIG_KEYWORDS = makeSet([
  'addrspace', 'align', 'allowzero', 'and', 'anyframe', 'anytype', 'asm', 'async',
  'await', 'break', 'callconv', 'catch', 'comptime', 'const', 'continue', 'defer',
  'else', 'errdefer', 'error', 'export', 'extern', 'fn', 'for', 'if', 'inline',
  'noalias', 'noinline', 'nosuspend', 'opaque', 'or', 'orelse', 'packed', 'pub',
  'resume', 'return', 'linksection', 'struct', 'suspend', 'switch', 'test',
  'threadlocal', 'try', 'union', 'unreachable', 'usingnamespace', 'var', 'volatile', 'while',
]);

const ZIG_TYPES = makeSet([
  'i8', 'i16', 'i32', 'i64', 'i128', 'u8', 'u16', 'u32', 'u64', 'u128', 'isize', 'usize',
  'f16', 'f32', 'f64', 'f80', 'f128', 'bool', 'void', 'type', 'anyerror', 'c_int',
  'c_ulong', 'noreturn', 'c_void',
]);

const GO_KEYWORDS = makeSet([
  'break', 'default', 'func', 'interface', 'select', 'case', 'defer', 'go', 'map',
  'struct', 'chan', 'else', 'goto', 'package', 'switch', 'const', 'fallthrough',
  'if', 'range', 'type', 'continue', 'for', 'import', 'return', 'var',
]);

const GO_TYPES = makeSet([
  'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32', 'uint64',
  'uintptr', 'float32', 'float64', 'complex64', 'complex128', 'string', 'bool', 'byte',
  'rune', 'error', 'any', 'comparable', 'nil', 'true', 'false', 'iota', 'append', 'cap',
  'close', 'complex', 'copy', 'delete', 'imag', 'len', 'make', 'new', 'panic', 'print',
  'println', 'real', 'recover',
]);

const TS_KEYWORDS = makeSet([
  'import', 'export', 'from', 'as', 'default', 'interface', 'type', 'enum',
  'namespace', 'declare', 'abstract', 'implements', 'extends', 'public',
  'private', 'protected', 'readonly', 'override', 'keyof', 'typeof', 'infer',
  'is', 'satisfies', 'const', 'let', 'var', 'function', 'return', 'if',
  'else', 'switch', 'case', 'default', 'for', 'while', 'do', 'try', 'catch',
  'finally', 'throw', 'class', 'new', 'this', 'super', 'async', 'await',
  'yield', 'debugger', 'in', 'of', 'instanceof', 'delete', 'void', 'true',
  'false', 'null', 'undefined', 'NaN', 'Infinity', 'with',
]);

const TS_TYPES = makeSet([
  'any', 'unknown', 'never', 'void', 'null', 'undefined', 'boolean', 'number',
  'string', 'symbol', 'bigint', 'object', 'Record', 'Partial', 'Required',
  'Readonly', 'Pick', 'Omit', 'Promise', 'Array', 'Map', 'Set', 'WeakMap',
  'WeakSet', 'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Function', 'Date', 'RegExp', 'Error', 'JSON', 'Math', 'console', 'window', 'document',
]);

const PYTHON_KEYWORDS = makeSet([
  'and', 'as', 'assert', 'async', 'await', 'break', 'case', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'False', 'finally', 'for', 'from',
  'global', 'if', 'import', 'in', 'is', 'lambda', 'match', 'None', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while', 'with', 'yield',
]);

const PYTHON_TYPES = makeSet([
  'int', 'float', 'complex', 'str', 'bytes', 'bytearray', 'memoryview', 'list',
  'tuple', 'range', 'dict', 'set', 'frozenset', 'bool', 'type', 'object', 'len',
  'print', 'input', 'open', 'enumerate', 'zip', 'map', 'filter', 'isinstance',
  'issubclass', 'hasattr', 'getattr', 'setattr', 'delattr', 'super', 'self', 'cls',
  'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError',
]);

const RUBY_KEYWORDS = makeSet([
  'alias', 'and', 'BEGIN', 'begin', 'break', 'case', 'class', 'def', 'defined?',
  'do', 'else', 'elsif', 'END', 'end', 'ensure', 'false', 'for', 'if', 'in',
  'module', 'next', 'nil', 'not', 'or', 'redo', 'rescue', 'retry', 'return',
  'self', 'super', 'then', 'true', 'undef', 'unless', 'until', 'when', 'while',
  'yield', 'require', 'require_relative', 'include', 'extend', 'attr_accessor',
  'attr_reader', 'attr_writer', 'private', 'protected', 'public',
]);

const RUBY_TYPES = makeSet([
  'Integer', 'Float', 'String', 'Array', 'Hash', 'Symbol', 'Regexp', 'Proc',
  'Lambda', 'NilClass', 'TrueClass', 'FalseClass', 'Numeric', 'Object', 'Class',
  'Module', 'StandardError', 'puts', 'p', 'print', 'raise',
]);

const PHP_KEYWORDS = makeSet([
  'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class',
  'clone', 'const', 'continue', 'declare', 'default', 'die', 'do', 'echo', 'else',
  'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch',
  'endwhile', 'eval', 'exit', 'extends', 'final', 'finally', 'fn', 'for', 'foreach',
  'function', 'global', 'goto', 'if', 'implements', 'include', 'include_once',
  'instanceof', 'insteadof', 'interface', 'isset', 'list', 'match', 'namespace',
  'new', 'or', 'print', 'private', 'protected', 'public', 'readonly', 'require',
  'require_once', 'return', 'static', 'switch', 'throw', 'trait', 'try', 'unset',
  'use', 'var', 'while', 'xor', 'yield', 'true', 'false', 'null',
]);

const PHP_TYPES = makeSet([
  'int', 'float', 'string', 'bool', 'void', 'iterable', 'mixed', 'object', 'self', 'parent',
]);

const LUA_KEYWORDS = makeSet([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
  'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then',
  'true', 'until', 'while',
]);

const LUA_TYPES = makeSet([
  'assert', 'collectgarbage', 'dofile', 'error', 'getmetatable', 'ipairs', 'load',
  'loadfile', 'next', 'pairs', 'pcall', 'print', 'rawequal', 'rawget', 'rawlen',
  'rawset', 'require', 'select', 'setmetatable', 'tonumber', 'tostring', 'type',
  'warn', 'xpcall', 'string', 'table', 'math', 'io', 'os', 'debug', 'coroutine', 'utf8',
]);

const PERL_KEYWORDS = makeSet([
  'my', 'our', 'local', 'state', 'sub', 'use', 'no', 'require', 'package', 'if',
  'elsif', 'else', 'unless', 'while', 'until', 'for', 'foreach', 'return', 'last',
  'next', 'redo', 'die', 'warn', 'eval', 'scalar', 'undef', 'do', 'given', 'when', 'default',
]);

const PERL_TYPES = makeSet([
  'print', 'say', 'printf', 'sprintf', 'shift', 'unshift', 'push', 'pop', 'splice',
  'keys', 'values', 'each', 'exists', 'delete', 'map', 'grep', 'sort', 'chomp',
  'chop', 'split', 'join', 'length', 'substr', 'index', 'rindex', 'defined', 'ref',
]);

const BASH_KEYWORDS = makeSet([
  'if', 'then', 'elif', 'else', 'fi', 'for', 'in', 'while', 'until', 'do', 'done',
  'case', 'esac', 'function', 'select', 'time', 'return', 'exit', 'export', 'local',
  'readonly', 'unset', 'alias', 'source', 'eval', 'exec', 'trap', 'shift', 'set',
  'typeset', 'declare', 'autoload', 'setopt', 'unsetopt', 'true', 'false',
]);

const BASH_TYPES = makeSet([
  'echo', 'printf', 'read', 'cd', 'pwd', 'test', 'which', 'command', 'type',
  'kill', 'wait', 'sleep', 'cat', 'grep', 'sed', 'awk', 'find', 'xargs', 'mkdir',
  'rm', 'cp', 'mv', 'chmod', 'chown', 'curl', 'wget', 'git', 'tar', 'gzip',
]);

const POWERSHELL_KEYWORDS = makeSet([
  'function', 'filter', 'param', 'begin', 'process', 'end', 'if', 'elseif', 'else',
  'switch', 'while', 'do', 'until', 'for', 'foreach', 'in', 'break', 'continue',
  'return', 'try', 'catch', 'finally', 'throw', 'trap', 'class', 'enum', 'using',
  'hidden', 'static', 'data', 'dynamicparam', 'inlinescript', 'parallel', 'sequence',
  'workflow', 'true', 'false', 'null',
]);

const R_KEYWORDS = makeSet([
  'if', 'else', 'repeat', 'while', 'function', 'for', 'in', 'next', 'break',
  'TRUE', 'FALSE', 'NULL', 'Inf', 'NaN', 'NA', 'NA_integer_', 'NA_real_',
  'NA_complex_', 'NA_character_',
]);

const R_TYPES = makeSet([
  'c', 'list', 'vector', 'matrix', 'data.frame', 'factor', 'library', 'require',
  'print', 'summary', 'plot', 'apply', 'lapply', 'sapply', 'tapply', 'vapply',
  'mapply', 'length', 'names', 'colnames', 'rownames', 'dim', 'nrow', 'ncol',
]);

const JULIA_KEYWORDS = makeSet([
  'baremodule', 'begin', 'break', 'catch', 'const', 'continue', 'do', 'else',
  'elseif', 'end', 'export', 'false', 'finally', 'for', 'function', 'global',
  'if', 'import', 'let', 'local', 'macro', 'module', 'quote', 'return', 'struct',
  'true', 'try', 'using', 'while', 'mutable', 'abstract', 'primitive', 'where', 'type',
]);

const JULIA_TYPES = makeSet([
  'Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'UInt8', 'UInt16', 'UInt32', 'UInt64',
  'UInt128', 'Float16', 'Float32', 'Float64', 'Bool', 'Char', 'String', 'Symbol',
  'Array', 'Vector', 'Matrix', 'Dict', 'Set', 'Tuple', 'Pair', 'Nothing', 'Any',
  'Union', 'Type', 'println', 'print', 'show',
]);

const JAVA_KEYWORDS = makeSet([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
  'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package',
  'private', 'protected', 'public', 'record', 'return', 'short', 'static',
  'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
  'transient', 'try', 'void', 'volatile', 'while', 'yield', 'var', 'sealed',
  'permits', 'non-sealed', 'true', 'false', 'null',
]);

const JAVA_TYPES = makeSet([
  'String', 'Integer', 'Long', 'Boolean', 'Double', 'Float', 'Short', 'Byte',
  'Character', 'List', 'Map', 'Set', 'Optional', 'Stream', 'System', 'Thread',
  'Object', 'Class', 'Exception', 'RuntimeException', 'StringBuilder', 'StringBuffer',
]);

const KOTLIN_KEYWORDS = makeSet([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if',
  'in', 'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this',
  'throw', 'true', 'try', 'typealias', 'val', 'var', 'when', 'while', 'by',
  'catch', 'constructor', 'delegate', 'dynamic', 'field', 'file', 'finally',
  'get', 'import', 'init', 'param', 'property', 'receiver', 'set', 'setparam',
  'where', 'actual', 'abstract', 'annotation', 'companion', 'const', 'crossinline',
  'data', 'enum', 'expect', 'external', 'final', 'infix', 'inline', 'inner',
  'internal', 'lateinit', 'noinline', 'open', 'operator', 'out', 'override',
  'private', 'protected', 'public', 'reified', 'sealed', 'suspend', 'tailrec',
  'vararg', 'value',
]);

const KOTLIN_TYPES = makeSet([
  'Int', 'Long', 'Short', 'Byte', 'Float', 'Double', 'Boolean', 'Char', 'String',
  'Array', 'List', 'Map', 'Set', 'Sequence', 'Unit', 'Nothing', 'Any', 'println',
]);

const SCALA_KEYWORDS = makeSet([
  'abstract', 'case', 'catch', 'class', 'def', 'do', 'else', 'extends', 'false',
  'final', 'finally', 'for', 'forSome', 'if', 'implicit', 'import', 'lazy',
  'match', 'new', 'null', 'object', 'override', 'package', 'private', 'protected',
  'return', 'sealed', 'super', 'this', 'throw', 'trait', 'true', 'try', 'type',
  'val', 'var', 'while', 'with', 'yield', 'given', 'using', 'extension', 'enum',
  'export', 'opaque', 'open', 'inline', 'transparent', 'derives', 'end',
]);

const SCALA_TYPES = makeSet([
  'Int', 'Long', 'Short', 'Byte', 'Float', 'Double', 'Boolean', 'Char', 'String',
  'Unit', 'Null', 'Nothing', 'Any', 'AnyRef', 'AnyVal', 'Option', 'Some', 'None',
  'Either', 'Left', 'Right', 'List', 'Vector', 'Map', 'Set', 'Future', 'println',
]);

const SWIFT_KEYWORDS = makeSet([
  'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func',
  'import', 'init', 'inout', 'internal', 'let', 'open', 'operator', 'private',
  'protocol', 'public', 'rethrows', 'static', 'struct', 'subscript', 'typealias',
  'var', 'break', 'case', 'continue', 'default', 'defer', 'do', 'else',
  'fallthrough', 'for', 'guard', 'if', 'in', 'repeat', 'return', 'switch',
  'where', 'while', 'as', 'Any', 'catch', 'false', 'is', 'nil', 'super',
  'self', 'Self', 'throw', 'throws', 'true', 'try', 'async', 'await', 'actor',
  'nonisolated', 'isolated', 'some', 'macro', 'consuming', 'borrowing',
]);

const SWIFT_TYPES = makeSet([
  'Int', 'Int8', 'Int16', 'Int32', 'Int64', 'UInt', 'UInt8', 'UInt16', 'UInt32', 'UInt64',
  'Float', 'Double', 'Bool', 'String', 'Character', 'Array', 'Dictionary', 'Set',
  'Optional', 'Result', 'Task', 'print',
]);

const HASKELL_KEYWORDS = makeSet([
  'as', 'case', 'of', 'class', 'data', 'default', 'deriving', 'do', 'forall',
  'foreign', 'hiding', 'if', 'then', 'else', 'import', 'in', 'infix', 'infixl',
  'infixr', 'instance', 'let', 'mdo', 'module', 'newtype', 'qualified', 'rec',
  'type', 'where',
]);

const HASKELL_TYPES = makeSet([
  'Int', 'Integer', 'Float', 'Double', 'Bool', 'Char', 'String', 'Maybe', 'Either',
  'IO', 'List', 'Just', 'Nothing', 'Left', 'Right', 'True', 'False', 'putStrLn', 'print',
]);

const ELIXIR_KEYWORDS = makeSet([
  'defmodule', 'def', 'defp', 'defmacro', 'defmacrop', 'defguard', 'defguardp',
  'defstruct', 'defprotocol', 'defimpl', 'defoverridable', 'use', 'import',
  'require', 'alias', 'if', 'unless', 'cond', 'case', 'with', 'for', 'receive',
  'try', 'rescue', 'catch', 'after', 'raise', 'throw', 'fn', 'end', 'do',
  'nil', 'true', 'false', 'quote', 'unquote',
]);

const ERLANG_KEYWORDS = makeSet([
  'after', 'and', 'andalso', 'band', 'begin', 'bnot', 'bor', 'bsl', 'bsr',
  'bxor', 'case', 'catch', 'cond', 'div', 'end', 'fun', 'if', 'let', 'not',
  'of', 'or', 'orelse', 'receive', 'rem', 'try', 'when', 'xor',
]);

const CLOJURE_KEYWORDS = makeSet([
  'def', 'defn', 'defn-', 'defmacro', 'defmulti', 'defmethod', 'defprotocol',
  'defrecord', 'deftype', 'let', 'if', 'if-let', 'if-not', 'when', 'when-let',
  'when-not', 'cond', 'case', 'loop', 'recur', 'do', 'fn', 'ns', 'require',
  'use', 'import', 'nil', 'true', 'false', 'quote', 'var', 'binding', 'declare',
  'doseq', 'dotimes',
]);

const OCAML_KEYWORDS = makeSet([
  'and', 'as', 'assert', 'asr', 'begin', 'class', 'constraint', 'do', 'done',
  'downto', 'else', 'end', 'exception', 'external', 'false', 'for', 'fun',
  'function', 'functor', 'if', 'in', 'include', 'inherit', 'initializer',
  'land', 'lazy', 'let', 'lor', 'lsl', 'lsr', 'lxor', 'match', 'method',
  'mod', 'module', 'mutable', 'new', 'nonrec', 'object', 'of', 'open', 'or',
  'private', 'rec', 'sig', 'struct', 'then', 'to', 'true', 'try', 'type',
  'val', 'virtual', 'when', 'while', 'with',
]);

const FSHARP_KEYWORDS = makeSet([
  'abstract', 'and', 'as', 'assert', 'base', 'begin', 'class', 'default',
  'delegate', 'do', 'done', 'downcast', 'downto', 'elif', 'else', 'end',
  'exception', 'extern', 'false', 'finally', 'for', 'fun', 'function', 'global',
  'if', 'in', 'inherit', 'inline', 'interface', 'internal', 'lazy', 'let',
  'match', 'member', 'module', 'mutable', 'namespace', 'new', 'not', 'null',
  'of', 'open', 'or', 'override', 'private', 'public', 'rec', 'return',
  'return!', 'select', 'static', 'struct', 'then', 'to', 'true', 'try', 'type',
  'upcast', 'use', 'use!', 'val', 'void', 'when', 'while', 'with', 'yield', 'yield!',
]);

const DART_KEYWORDS = makeSet([
  'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch',
  'class', 'const', 'continue', 'covariant', 'default', 'deferred', 'do',
  'dynamic', 'else', 'enum', 'export', 'extends', 'extension', 'external',
  'factory', 'false', 'final', 'finally', 'for', 'Function', 'get', 'hide',
  'if', 'implements', 'import', 'in', 'interface', 'is', 'late', 'library',
  'mixin', 'new', 'null', 'on', 'operator', 'part', 'required', 'rethrow',
  'return', 'set', 'show', 'static', 'super', 'switch', 'sync', 'this',
  'throw', 'true', 'try', 'typedef', 'var', 'void', 'while', 'with', 'yield',
]);

const SQL_KEYWORDS = makeSet([
  'select', 'from', 'where', 'insert', 'into', 'update', 'delete', 'create',
  'table', 'alter', 'drop', 'join', 'left', 'right', 'inner', 'outer', 'cross',
  'full', 'on', 'group', 'by', 'order', 'having', 'limit', 'offset', 'union',
  'all', 'and', 'or', 'not', 'in', 'exists', 'between', 'like', 'is', 'null',
  'true', 'false', 'case', 'when', 'then', 'else', 'end', 'as', 'distinct',
  'primary', 'key', 'foreign', 'references', 'index', 'view', 'trigger',
  'procedure', 'function', 'begin', 'commit', 'rollback', 'transaction',
  'grant', 'revoke', 'cascade', 'set', 'values', 'default', 'check', 'unique',
]);

const SQL_TYPES = makeSet([
  'int', 'integer', 'bigint', 'smallint', 'tinyint', 'varchar', 'char', 'text',
  'boolean', 'timestamp', 'datetime', 'date', 'time', 'float', 'double',
  'decimal', 'numeric', 'blob', 'json', 'uuid', 'bytea',
]);

const GRAPHQL_KEYWORDS = makeSet([
  'query', 'mutation', 'subscription', 'type', 'interface', 'union', 'enum',
  'input', 'schema', 'directive', 'fragment', 'on', 'extend', 'null', 'true', 'false',
]);

const GRAPHQL_TYPES = makeSet([
  'String', 'Int', 'Float', 'Boolean', 'ID',
]);

const NIX_KEYWORDS = makeSet([
  'let', 'in', 'rec', 'with', 'inherit', 'import', 'if', 'then', 'else',
  'assert', 'or', 'true', 'false', 'null',
]);

const DOCKERFILE_KEYWORDS = makeSet([
  'from', 'run', 'cmd', 'label', 'maintainer', 'expose', 'env', 'add',
  'copy', 'entrypoint', 'volume', 'user', 'workdir', 'arg', 'onbuild',
  'stopsignal', 'healthcheck', 'shell',
]);

const MAKEFILE_KEYWORDS = makeSet([
  'include', 'ifeq', 'ifneq', 'ifdef', 'ifndef', 'else', 'endif', '.PHONY', '.DEFAULT_GOAL',
]);

const CMAKE_KEYWORDS = makeSet([
  'cmake_minimum_required', 'project', 'add_executable', 'add_library',
  'target_link_libraries', 'target_include_directories', 'set', 'if', 'else',
  'elseif', 'endif', 'foreach', 'endforeach', 'while', 'endwhile', 'macro',
  'endmacro', 'function', 'endfunction', 'find_package', 'include', 'message', 'option',
]);

const PROTOBUF_KEYWORDS = makeSet([
  'syntax', 'package', 'import', 'option', 'message', 'enum', 'service',
  'rpc', 'returns', 'repeated', 'optional', 'required', 'oneof', 'map', 'reserved', 'to', 'max',
]);

const PROTOBUF_TYPES = makeSet([
  'int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64',
  'sfixed32', 'sfixed64', 'float', 'double', 'bool', 'string', 'bytes',
]);

const TERRAFORM_KEYWORDS = makeSet([
  'resource', 'data', 'variable', 'output', 'locals', 'module', 'provider',
  'terraform', 'backend', 'lifecycle', 'for_each', 'count', 'depends_on',
  'dynamic', 'content', 'true', 'false', 'null',
]);

const WGSL_KEYWORDS = makeSet([
  'fn', 'let', 'var', 'const', 'override', 'struct', 'type', 'return', 'if',
  'else', 'loop', 'for', 'while', 'break', 'continue', 'discard', 'switch',
  'case', 'default', 'enable', 'alias',
]);

const WGSL_TYPES = makeSet([
  'f32', 'f16', 'i32', 'u32', 'bool', 'vec2', 'vec3', 'vec4', 'mat2x2', 'mat3x3',
  'mat4x4', 'array', 'texture_2d', 'sampler',
]);

const GLSL_KEYWORDS = makeSet([
  'void', 'bool', 'int', 'uint', 'float', 'double', 'in', 'out', 'inout',
  'uniform', 'attribute', 'varying', 'layout', 'precision', 'highp', 'mediump',
  'lowp', 'if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'discard',
]);

const GLSL_TYPES = makeSet([
  'vec2', 'vec3', 'vec4', 'bvec2', 'bvec3', 'bvec4', 'ivec2', 'ivec3', 'ivec4',
  'uvec2', 'uvec3', 'uvec4', 'dvec2', 'dvec3', 'dvec4', 'mat2', 'mat3', 'mat4',
  'sampler2D', 'samplerCube', 'sampler2DShadow',
]);

const WAT_KEYWORDS = makeSet([
  'module', 'func', 'import', 'export', 'memory', 'table', 'data', 'elem',
  'type', 'param', 'result', 'local', 'global', 'mut', 'call', 'call_indirect',
  'drop', 'select', 'block', 'loop', 'if', 'else', 'br', 'br_if', 'br_table',
  'return', 'unreachable', 'nop', 'load', 'store',
]);

const WAT_TYPES = makeSet([
  'i32', 'i64', 'f32', 'f64', 'v128', 'funcref', 'externref',
]);

const NIM_KEYWORDS = makeSet([
  'addr', 'and', 'as', 'asm', 'bind', 'block', 'break', 'case', 'cast', 'concept',
  'const', 'continue', 'converter', 'defer', 'discard', 'distinct', 'div', 'do',
  'elif', 'else', 'end', 'enum', 'except', 'export', 'finally', 'for', 'from',
  'func', 'if', 'import', 'in', 'include', 'interface', 'is', 'isnot', 'iterator',
  'let', 'macro', 'method', 'mixin', 'mod', 'nil', 'not', 'notin', 'object', 'of',
  'or', 'out', 'proc', 'ptr', 'raise', 'ref', 'return', 'shl', 'shr', 'static',
  'template', 'try', 'tuple', 'type', 'using', 'var', 'when', 'while', 'xor', 'yield',
]);

const V_KEYWORDS = makeSet([
  'as', 'asm', 'assert', 'atomic', 'break', 'const', 'continue', 'defer', 'else',
  'enum', 'fn', 'for', 'go', 'goto', 'if', 'import', 'in', 'interface', 'is',
  'isreftype', 'lock', 'match', 'module', 'mut', 'none', 'or', 'pub', 'return',
  'rlock', 'select', 'shared', 'sizeof', 'static', 'struct', 'type', 'typeof',
  'union', 'unsafe', 'volatile', 'true', 'false',
]);

const FORTRAN_KEYWORDS = makeSet([
  'program', 'subroutine', 'function', 'module', 'use', 'implicit', 'none',
  'intent', 'parameter', 'if', 'then', 'else', 'elseif', 'endif', 'do', 'while',
  'enddo', 'select', 'case', 'end', 'contains', 'call', 'return', 'allocate',
  'deallocate', 'interface', 'type', 'print', 'write', 'read', 'format', 'stop',
  'cycle', 'exit',
]);

const ADA_KEYWORDS = makeSet([
  'abort', 'abs', 'abstract', 'accept', 'access', 'aliased', 'all', 'and',
  'array', 'at', 'begin', 'body', 'case', 'constant', 'declare', 'delay',
  'delta', 'digits', 'do', 'else', 'elsif', 'end', 'entry', 'exception',
  'exit', 'for', 'function', 'generic', 'goto', 'if', 'in', 'interface',
  'is', 'limited', 'loop', 'mod', 'new', 'not', 'null', 'of', 'or', 'others',
  'out', 'overriding', 'package', 'pragma', 'private', 'procedure', 'protected',
  'raise', 'range', 'record', 'rem', 'renames', 'requeue', 'return', 'reverse',
  'select', 'separate', 'some', 'subtype', 'synchronized', 'tagged', 'task',
  'terminate', 'then', 'type', 'until', 'use', 'when', 'while', 'with', 'xor',
]);

const HARE_KEYWORDS = makeSet([
  'abort', 'alloc', 'append', 'as', 'assert', 'break', 'case', 'const',
  'continue', 'def', 'defer', 'delete', 'else', 'enum', 'export', 'fn',
  'for', 'free', 'if', 'insert', 'let', 'match', 'nullable', 'return',
  'size', 'static', 'struct', 'switch', 'type', 'union', 'use', 'val', 'yield',
]);

const D_KEYWORDS = makeSet([
  'abstract', 'alias', 'align', 'asm', 'assert', 'auto', 'body', 'bool', 'break',
  'byte', 'case', 'cast', 'catch', 'cdouble', 'cent', 'cfloat', 'char', 'class',
  'const', 'continue', 'creal', 'dchar', 'debug', 'default', 'delegate', 'delete',
  'deprecated', 'do', 'double', 'else', 'enum', 'export', 'extern', 'false',
  'final', 'finally', 'float', 'for', 'foreach', 'foreach_reverse', 'function',
  'goto', 'idouble', 'if', 'ifloat', 'immutable', 'import', 'in', 'inout', 'int',
  'interface', 'invariant', 'ireal', 'is', 'lazy', 'long', 'macro', 'mixin',
  'module', 'new', 'nothrow', 'null', 'out', 'override', 'package', 'pragma',
  'private', 'protected', 'public', 'pure', 'real', 'ref', 'return', 'scope',
  'shared', 'short', 'size_t', 'static', 'struct', 'super', 'switch',
  'synchronized', 'template', 'this', 'throw', 'true', 'try', 'typedef',
  'typeid', 'typeof', 'ubyte', 'ucent', 'uint', 'ulong', 'union', 'unittest',
  'ushort', 'version', 'void', 'wchar', 'while', 'with',
]);

const ASSEMBLY_KEYWORDS = makeSet([
  'mov', 'push', 'pop', 'lea', 'add', 'sub', 'mul', 'div', 'jmp', 'je', 'jne',
  'jz', 'jnz', 'jg', 'jge', 'jl', 'jle', 'call', 'ret', 'nop', 'ldr', 'str',
  'b', 'bl', 'bx', 'svc', 'syscall', 'int', 'cmp', 'test', 'xor', 'and', 'or',
  'shl', 'shr', 'sar', 'inc', 'dec', 'neg', 'not',
]);

const ASSEMBLY_TYPES = makeSet([
  'rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi', 'rbp', 'rsp', 'r8', 'r9', 'r10',
  'r11', 'r12', 'r13', 'r14', 'r15', 'eax', 'ebx', 'ecx', 'edx', 'esi', 'edi',
  'ebp', 'esp', 'ax', 'bx', 'cx', 'dx', 'al', 'bl', 'cl', 'dl', 'ah', 'bh',
  'ch', 'dh', 'r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'w0', 'w1',
  'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w30', 'x0', 'x1', 'x2', 'x3', 'x4',
  'x5', 'x6', 'x7', 'x30', 'sp', 'pc', 'lr',
]);

// ----------------------------------------------------------------------------
// Custom Language Tokenizers (Diff, Markdown, HTML/XML, CSS, JSON, INI)
// ----------------------------------------------------------------------------

function tokenizeDiffLine(line: string): TokenizeLineResult {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) {
    return { tokens: [{ type: 'type', text: line }], stateOut: {} };
  }
  if (line.startsWith('@@')) {
    return { tokens: [{ type: 'preprocessor', text: line }], stateOut: {} };
  }
  if (line.startsWith('+')) {
    return { tokens: [{ type: 'string', text: line }], stateOut: {} };
  }
  if (line.startsWith('-')) {
    return { tokens: [{ type: 'operator', text: line }], stateOut: {} };
  }
  return { tokens: [{ type: 'plain', text: line }], stateOut: {} };
}

function tokenizeMarkdownLine(line: string, stateIn: MultiLineState): TokenizeLineResult {
  // Code block fence
  if (line.startsWith('```') || line.startsWith('~~~')) {
    const inBlock = Boolean(stateIn.inBlockComment);
    return {
      tokens: [{ type: 'preprocessor', text: line }],
      stateOut: inBlock ? {} : { inBlockComment: true, commentDelimiter: '```' },
    };
  }
  if (stateIn.inBlockComment) {
    return { tokens: [{ type: 'string', text: line }], stateOut: stateIn };
  }

  // Header
  const headerMatch = /^#{1,6}\s+/.exec(line);
  if (headerMatch) {
    const hashes = headerMatch[0];
    const rest = line.slice(hashes.length);
    return {
      tokens: [
        { type: 'keyword', text: hashes },
        { type: 'function', text: rest },
      ],
      stateOut: {},
    };
  }

  // Blockquote or List
  if (/^>\s*/.test(line)) {
    const m = /^>\s*/.exec(line);
    const prefix = m ? m[0] : '>';
    return {
      tokens: [
        { type: 'punctuation', text: prefix },
        { type: 'plain', text: line.slice(prefix.length) },
      ],
      stateOut: {},
    };
  }

  const listMatch = /^(\s*[-*+]|\s*\d+\.)\s+/.exec(line);
  if (listMatch) {
    const bullet = listMatch[0];
    return {
      tokens: [
        { type: 'keyword', text: bullet },
        { type: 'plain', text: line.slice(bullet.length) },
      ],
      stateOut: {},
    };
  }

  // Tokenize inline markdown (backticks, bold, links)
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < line.length) {
    if (line[pos] === '`') {
      const nextTick = line.indexOf('`', pos + 1);
      if (nextTick !== -1) {
        tokens.push({ type: 'string', text: line.slice(pos, nextTick + 1) });
        pos = nextTick + 1;
        continue;
      }
    }
    const nextSpecial = line.indexOf('`', pos);
    if (nextSpecial === -1) {
      tokens.push({ type: 'plain', text: line.slice(pos) });
      break;
    } else {
      if (nextSpecial > pos) {
        tokens.push({ type: 'plain', text: line.slice(pos, nextSpecial) });
      }
      pos = nextSpecial;
    }
  }

  return { tokens, stateOut: {} };
}

function tokenizeHtmlXmlLine(line: string, stateIn: MultiLineState): TokenizeLineResult {
  const tokens: Token[] = [];
  let pos = 0;

  if (stateIn.inBlockComment) {
    const closeIdx = line.indexOf('-->');
    if (closeIdx === -1) {
      return { tokens: [{ type: 'comment', text: line }], stateOut: stateIn };
    }
    tokens.push({ type: 'comment', text: line.slice(0, closeIdx + 3) });
    pos = closeIdx + 3;
  }

  while (pos < line.length) {
    if (line.startsWith('<!--', pos)) {
      const closeIdx = line.indexOf('-->', pos + 4);
      if (closeIdx !== -1) {
        tokens.push({ type: 'comment', text: line.slice(pos, closeIdx + 3) });
        pos = closeIdx + 3;
        continue;
      } else {
        tokens.push({ type: 'comment', text: line.slice(pos) });
        return {
          tokens,
          stateOut: { inBlockComment: true, commentDelimiter: '-->' },
        };
      }
    }

    if (line[pos] === '<') {
      // Check DOCTYPE / CDATA
      if (line.startsWith('<!', pos) || line.startsWith('<?', pos)) {
        const closeIdx = line.indexOf('>', pos);
        if (closeIdx !== -1) {
          tokens.push({ type: 'preprocessor', text: line.slice(pos, closeIdx + 1) });
          pos = closeIdx + 1;
          continue;
        }
      }

      // Tag opening
      const tagMatch = /^<\/?([a-zA-Z0-9_:-]+)/.exec(line.slice(pos));
      if (tagMatch) {
        const matched = tagMatch[0];
        tokens.push({ type: 'punctuation', text: line.slice(pos, pos + (matched.startsWith('</') ? 2 : 1)) });
        const tagName = matched.startsWith('</') ? matched.slice(2) : matched.slice(1);
        tokens.push({ type: 'tag', text: tagName });
        pos += matched.length;

        // Attributes inside tag
        while (pos < line.length && line[pos] !== '>') {
          if (line.startsWith('/>', pos)) {
            tokens.push({ type: 'punctuation', text: '/>' });
            pos += 2;
            break;
          }
          if (line[pos] === ' ' || line[pos] === '\t') {
            tokens.push({ type: 'plain', text: line[pos] ?? '' });
            pos++;
            continue;
          }
          const attrMatch = /^([a-zA-Z0-9_:-]+)/.exec(line.slice(pos));
          if (attrMatch) {
            tokens.push({ type: 'attribute', text: attrMatch[0] });
            pos += attrMatch[0].length;
            if (pos < line.length && line[pos] === '=') {
              tokens.push({ type: 'operator', text: '=' });
              pos++;
              if (pos < line.length && (line[pos] === '"' || line[pos] === "'")) {
                const q = line[pos];
                const closeQ = line.indexOf(q ?? '', pos + 1);
                if (closeQ !== -1) {
                  tokens.push({ type: 'string', text: line.slice(pos, closeQ + 1) });
                  pos = closeQ + 1;
                } else {
                  tokens.push({ type: 'string', text: line.slice(pos) });
                  pos = line.length;
                }
              }
            }
            continue;
          }
          if (line[pos] === '>') {
            tokens.push({ type: 'punctuation', text: '>' });
            pos++;
            break;
          }
          tokens.push({ type: 'plain', text: line[pos] ?? '' });
          pos++;
        }
        continue;
      }
    }

    const nextTag = line.indexOf('<', pos);
    if (nextTag === -1) {
      tokens.push({ type: 'plain', text: line.slice(pos) });
      break;
    } else {
      tokens.push({ type: 'plain', text: line.slice(pos, nextTag) });
      pos = nextTag;
    }
  }

  return { tokens, stateOut: {} };
}

function tokenizeIniLine(line: string): TokenizeLineResult {
  const trimmed = line.trim();
  if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
    return { tokens: [{ type: 'comment', text: line }], stateOut: {} };
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return { tokens: [{ type: 'type', text: line }], stateOut: {} };
  }
  const eqIdx = line.indexOf('=');
  const colonIdx = line.indexOf(':');
  const sepIdx = eqIdx !== -1 ? (colonIdx !== -1 ? Math.min(eqIdx, colonIdx) : eqIdx) : colonIdx;

  if (sepIdx !== -1) {
    const key = line.slice(0, sepIdx);
    const sep = line[sepIdx] ?? '=';
    const val = line.slice(sepIdx + 1);
    return {
      tokens: [
        { type: 'keyword', text: key },
        { type: 'operator', text: sep },
        { type: 'string', text: val },
      ],
      stateOut: {},
    };
  }

  return { tokens: [{ type: 'plain', text: line }], stateOut: {} };
}

function tokenizeTomlLine(line: string, stateIn: MultiLineState): TokenizeLineResult {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) {
    return { tokens: [{ type: 'comment', text: line }], stateOut: stateIn };
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return { tokens: [{ type: 'type', text: line }], stateOut: {} };
  }
  return tokenizeIniLine(line);
}

function tokenizeYamlLine(line: string, stateIn: MultiLineState): TokenizeLineResult {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) {
    return { tokens: [{ type: 'comment', text: line }], stateOut: stateIn };
  }
  if (trimmed === '---' || trimmed === '...') {
    return { tokens: [{ type: 'preprocessor', text: line }], stateOut: stateIn };
  }
  const keyMatch = /^(\s*)([a-zA-Z0-9_.-]+)(\s*:)(.*)$/.exec(line);
  if (keyMatch) {
    const ws = keyMatch[1] ?? '';
    const key = keyMatch[2] ?? '';
    const colon = keyMatch[3] ?? ':';
    const rest = keyMatch[4] ?? '';
    const tokens: Token[] = [];
    if (ws) tokens.push({ type: 'plain', text: ws });
    tokens.push({ type: 'keyword', text: key });
    tokens.push({ type: 'operator', text: colon });
    if (rest) {
      tokens.push({ type: 'plain', text: rest });
    }
    return { tokens, stateOut: {} };
  }
  return { tokens: [{ type: 'plain', text: line }], stateOut: {} };
}

// ----------------------------------------------------------------------------
// Master Language Definition Registry
// ----------------------------------------------------------------------------

function getLanguageDef(language: string): LanguageDef {
  switch (language) {
    case 'toml':
      return {
        name: 'toml',
        lineComments: ['#'],
        tripleQuotes: ['"""', "'''"],
        stringDelimiters: ['"', "'"],
        customLineTokenizer: tokenizeTomlLine,
      };
    case 'yaml':
      return {
        name: 'yaml',
        lineComments: ['#'],
        stringDelimiters: ['"', "'"],
        customLineTokenizer: tokenizeYamlLine,
      };
    case 'rust':
      return {
        name: 'rust',
        keywords: RUST_KEYWORDS,
        types: RUST_TYPES,
        lineComments: ['///', '//!', '//'],
        blockComments: [{ start: '/*', end: '*/', nested: true }],
        stringDelimiters: ['"'],
        preprocessors: /^#\[.*?\]|^#!\[.*?\]/,
      };
    case 'c':
      return {
        name: 'c',
        keywords: C_KEYWORDS,
        types: C_TYPES,
        lineComments: ['//'],
        blockComments: [{ start: '/*', end: '*/' }],
        stringDelimiters: ['"', "'"],
        preprocessors: /^#\s*(include|define|undef|ifdef|ifndef|if|else|elif|endif|pragma|error|warning|line)\b/,
      };
    case 'cpp':
      return {
        name: 'cpp',
        keywords: CPP_KEYWORDS,
        types: CPP_TYPES,
        lineComments: ['//'],
        blockComments: [{ start: '/*', end: '*/' }],
        stringDelimiters: ['"', "'"],
        preprocessors: /^#\s*(include|define|undef|ifdef|ifndef|if|else|elif|endif|pragma|error|warning|line)\b/,
      };
    case 'csharp':
      return {
        name: 'csharp',
        keywords: CSHARP_KEYWORDS,
        types: CSHARP_TYPES,
        lineComments: ['///', '//'],
        blockComments: [{ start: '/*', end: '*/' }],
        stringDelimiters: ['"', "'"],
      };
    case 'zig':
      return {
        name: 'zig',
        keywords: ZIG_KEYWORDS,
        types: ZIG_TYPES,
        lineComments: ['///', '//!', '//'],
        stringDelimiters: ['"'],
      };
    case 'go':
      return {
        name: 'go',
        keywords: GO_KEYWORDS,
        types: GO_TYPES,
        lineComments: ['//'],
        blockComments: [{ start: '/*', end: '*/' }],
        stringDelimiters: ['"', '`', "'"],
      };
    case 'typescript':
    case 'javascript':
    case 'tsx':
    case 'jsx':
      return {
        name: language,
        keywords: TS_KEYWORDS,
        types: TS_TYPES,
        lineComments: ['//'],
        blockComments: [{ start: '/*', end: '*/' }],
        stringDelimiters: ['"', "'", '`'],
      };
    case 'python':
      return {
        name: 'python',
        keywords: PYTHON_KEYWORDS,
        types: PYTHON_TYPES,
        lineComments: ['#'],
        tripleQuotes: ['"""', "'''"],
        stringDelimiters: ['"', "'"],
      };
    case 'ruby':
      return {
        name: 'ruby',
        keywords: RUBY_KEYWORDS,
        types: RUBY_TYPES,
        lineComments: ['#'],
        stringDelimiters: ['"', "'"],
        supportsHeredoc: true,
      };
    case 'php':
      return {
        name: 'php',
        keywords: PHP_KEYWORDS,
        types: PHP_TYPES,
        lineComments: ['//', '#'],
        blockComments: [{ start: '/*', end: '*/' }],
        stringDelimiters: ['"', "'"],
        supportsHeredoc: true,
      };
    case 'lua':
      return {
        name: 'lua',
        keywords: LUA_KEYWORDS,
        types: LUA_TYPES,
        lineComments: ['--'],
        blockComments: [{ start: '--[[', end: ']]' }],
        stringDelimiters: ['"', "'"],
      };
    case 'perl':
      return {
        name: 'perl',
        keywords: PERL_KEYWORDS,
        types: PERL_TYPES,
        lineComments: ['#'],
        stringDelimiters: ['"', "'"],
      };
    case 'bash':
    case 'zsh':
      return {
        name: language,
        keywords: BASH_KEYWORDS,
        types: BASH_TYPES,
        lineComments: ['#'],
        stringDelimiters: ['"', "'"],
        supportsHeredoc: true,
      };
    case 'powershell':
      return {
        name: 'powershell',
        keywords: POWERSHELL_KEYWORDS,
        lineComments: ['#'],
        blockComments: [{ start: '<#', end: '#>' }],
        stringDelimiters: ['"', "'"],
      };
    case 'r':
      return {
        name: 'r',
        keywords: R_KEYWORDS,
        types: R_TYPES,
        lineComments: ['#'],
        stringDelimiters: ['"', "'"],
      };
    case 'julia':
      return {
        name: 'julia',
        keywords: JULIA_KEYWORDS,
        types: JULIA_TYPES,
        lineComments: ['#'],
        blockComments: [{ start: '#=', end: '=#', nested: true }],
        tripleQuotes: ['"""'],
        stringDelimiters: ['"'],
      };
    case 'java':
      return {
        name: 'java',
        keywords: JAVA_KEYWORDS,
        types: JAVA_TYPES,
        lineComments: ['///', '//'],
        blockComments: [{ start: '/*', end: '*/' }],
        tripleQuotes: ['"""'],
        stringDelimiters: ['"', "'"],
      };
    case 'kotlin':
      return {
        name: 'kotlin',
        keywords: KOTLIN_KEYWORDS,
        types: KOTLIN_TYPES,
        lineComments: ['//'],
        blockComments: [{ start: '/*', end: '*/', nested: true }],
        tripleQuotes: ['"""'],
        stringDelimiters: ['"', "'"],
      };
    case 'scala':
      return {
        name: 'scala',
        keywords: SCALA_KEYWORDS,
        types: SCALA_TYPES,
        lineComments: ['//'],
        blockComments: [{ start: '/*', end: '*/' }],
        tripleQuotes: ['"""'],
        stringDelimiters: ['"', "'"],
      };
    case 'swift':
      return {
        name: 'swift',
        keywords: SWIFT_KEYWORDS,
        types: SWIFT_TYPES,
        lineComments: ['///', '//'],
        blockComments: [{ start: '/*', end: '*/', nested: true }],
        tripleQuotes: ['"""'],
        stringDelimiters: ['"', "'"],
      };
    case 'haskell':
      return {
        name: 'haskell',
        keywords: HASKELL_KEYWORDS,
        types: HASKELL_TYPES,
        lineComments: ['--'],
        blockComments: [{ start: '{-', end: '-}', nested: true }],
        stringDelimiters: ['"', "'"],
      };
    case 'elixir':
      return {
        name: 'elixir',
        keywords: ELIXIR_KEYWORDS,
        lineComments: ['#'],
        tripleQuotes: ['"""', "'''"],
        stringDelimiters: ['"', "'"],
      };
    case 'erlang':
      return {
        name: 'erlang',
        keywords: ERLANG_KEYWORDS,
        lineComments: ['%'],
        stringDelimiters: ['"', "'"],
      };
    case 'clojure':
      return {
        name: 'clojure',
        keywords: CLOJURE_KEYWORDS,
        lineComments: [';;', ';'],
        stringDelimiters: ['"'],
      };
    case 'ocaml':
      return {
        name: 'ocaml',
        keywords: OCAML_KEYWORDS,
        blockComments: [{ start: '(*', end: '*)', nested: true }],
        stringDelimiters: ['"'],
      };
    case 'fsharp':
      return {
        name: 'fsharp',
        keywords: FSHARP_KEYWORDS,
        lineComments: ['//'],
        blockComments: [{ start: '(*', end: '*)' }],
        tripleQuotes: ['"""'],
        stringDelimiters: ['"', "'"],
      };
    case 'dart':
      return {
        name: 'dart',
        keywords: DART_KEYWORDS,
        lineComments: ['///', '//'],
        blockComments: [{ start: '/*', end: '*/' }],
        tripleQuotes: ['"""', "'''"],
        stringDelimiters: ['"', "'"],
      };
    case 'sql':
      return {
        name: 'sql',
        keywords: SQL_KEYWORDS,
        types: SQL_TYPES,
        lineComments: ['--', '#'],
        blockComments: [{ start: '/*', end: '*/' }],
        stringDelimiters: ["'", '"'],
      };
    case 'graphql':
      return {
        name: 'graphql',
        keywords: GRAPHQL_KEYWORDS,
        types: GRAPHQL_TYPES,
        lineComments: ['#'],
        stringDelimiters: ['"'],
      };
    case 'nix':
      return {
        name: 'nix',
        keywords: NIX_KEYWORDS,
        lineComments: ['#'],
        blockComments: [{ start: '/*', end: '*/' }],
        stringDelimiters: ['"'],
      };
    case 'dockerfile':
      return {
        name: 'dockerfile',
        keywords: DOCKERFILE_KEYWORDS,
        lineComments: ['#'],
        stringDelimiters: ['"', "'"],
      };
    case 'makefile':
      return {
        name: 'makefile',
        keywords: MAKEFILE_KEYWORDS,
        lineComments: ['#'],
        stringDelimiters: ['"', "'"],
      };
    case 'cmake':
      return {
        name: 'cmake',
        keywords: CMAKE_KEYWORDS,
        lineComments: ['#'],
        stringDelimiters: ['"'],
      };
    case 'protobuf':
      return {
        name: 'protobuf',
        keywords: PROTOBUF_KEYWORDS,
        types: PROTOBUF_TYPES,
        lineComments: ['//'],
        blockComments: [{ start: '/*', end: '*/' }],
        stringDelimiters: ['"', "'"],
      };
    case 'terraform':
      return {
        name: 'terraform',
        keywords: TERRAFORM_KEYWORDS,
        lineComments: ['#', '//'],
        blockComments: [{ start: '/*', end: '*/' }],
        stringDelimiters: ['"'],
      };
    case 'wgsl':
      return {
        name: 'wgsl',
        keywords: WGSL_KEYWORDS,
        types: WGSL_TYPES,
        lineComments: ['//'],
        blockComments: [{ start: '/*', end: '*/' }],
        stringDelimiters: ['"'],
      };
    case 'glsl':
      return {
        name: 'glsl',
        keywords: GLSL_KEYWORDS,
        types: GLSL_TYPES,
        lineComments: ['//'],
        blockComments: [{ start: '/*', end: '*/' }],
        stringDelimiters: ['"'],
      };
    case 'wat':
      return {
        name: 'wat',
        keywords: WAT_KEYWORDS,
        types: WAT_TYPES,
        lineComments: [';;'],
        blockComments: [{ start: '(;', end: ';)' }],
        stringDelimiters: ['"'],
      };
    case 'nim':
      return {
        name: 'nim',
        keywords: NIM_KEYWORDS,
        lineComments: ['##', '#'],
        blockComments: [{ start: '#[', end: ']#', nested: true }],
        tripleQuotes: ['"""'],
        stringDelimiters: ['"'],
      };
    case 'v':
      return {
        name: 'v',
        keywords: V_KEYWORDS,
        lineComments: ['//'],
        blockComments: [{ start: '/*', end: '*/' }],
        stringDelimiters: ["'", '"'],
      };
    case 'fortran':
      return {
        name: 'fortran',
        keywords: FORTRAN_KEYWORDS,
        lineComments: ['!'],
        stringDelimiters: ['"', "'"],
      };
    case 'ada':
      return {
        name: 'ada',
        keywords: ADA_KEYWORDS,
        lineComments: ['--'],
        stringDelimiters: ['"'],
      };
    case 'hare':
      return {
        name: 'hare',
        keywords: HARE_KEYWORDS,
        lineComments: ['//'],
        stringDelimiters: ['"'],
      };
    case 'd':
      return {
        name: 'd',
        keywords: D_KEYWORDS,
        lineComments: ['//'],
        blockComments: [
          { start: '/*', end: '*/' },
          { start: '/+', end: '+/', nested: true },
        ],
        stringDelimiters: ['"', '`'],
      };
    case 'assembly':
      return {
        name: 'assembly',
        keywords: ASSEMBLY_KEYWORDS,
        types: ASSEMBLY_TYPES,
        lineComments: [';', '#', '//'],
        stringDelimiters: ['"', "'"],
      };
    case 'diff':
      return {
        name: 'diff',
        customLineTokenizer: tokenizeDiffLine,
      };
    case 'markdown':
      return {
        name: 'markdown',
        customLineTokenizer: tokenizeMarkdownLine,
      };
    case 'html':
    case 'xml':
      return {
        name: language,
        customLineTokenizer: tokenizeHtmlXmlLine,
      };
    case 'ini':
      return {
        name: 'ini',
        customLineTokenizer: tokenizeIniLine,
      };
    default:
      return {
        name: language,
        stringDelimiters: ['"', "'"],
      };
  }
}

// ----------------------------------------------------------------------------
// Core Deterministic Line Tokenizer Engine
// ----------------------------------------------------------------------------

function isWordChar(char: string): boolean {
  return /^[a-zA-Z0-9_$]$/.test(char);
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isOperatorChar(char: string): boolean {
  return /^[+\-*/%=&|^!~<>?:.]/.test(char);
}

function isPunctuationChar(char: string): boolean {
  return /^[{}[\](),;]/.test(char);
}

/**
 * Tokenizes a single line of text with multi-line state propagation.
 */
export function tokenizeLine(
  line: string,
  stateIn: MultiLineState,
  language: string
): TokenizeLineResult {
  if (line.length === 0) {
    return { tokens: [], stateOut: stateIn };
  }

  const grammar = getLanguageDef(language);

  // Custom tokenizer check (diff, markdown, html/xml, ini)
  if (grammar.customLineTokenizer) {
    const customRes = grammar.customLineTokenizer(line, stateIn);
    if (customRes) return customRes;
  }

  const tokens: Token[] = [];
  let pos = 0;
  const len = line.length;

  // 1. Multi-line continuation handling
  if (stateIn.inBlockComment) {
    const endDelim = stateIn.commentDelimiter ?? '*/';
    const closeIdx = line.indexOf(endDelim);
    if (closeIdx === -1) {
      return { tokens: [{ type: 'comment', text: line }], stateOut: stateIn };
    }
    const endPos = closeIdx + endDelim.length;
    tokens.push({ type: 'comment', text: line.slice(0, endPos) });
    pos = endPos;
  } else if (stateIn.inMultiLineString) {
    const quote = stateIn.stringDelimiter ?? '"""';
    const closeIdx = line.indexOf(quote);
    if (closeIdx === -1) {
      return { tokens: [{ type: 'string', text: line }], stateOut: stateIn };
    }
    const endPos = closeIdx + quote.length;
    tokens.push({ type: 'string', text: line.slice(0, endPos) });
    pos = endPos;
  } else if (stateIn.inHeredoc) {
    const marker = stateIn.heredocDelimiter ?? 'EOF';
    if (line.trim() === marker) {
      return { tokens: [{ type: 'keyword', text: line }], stateOut: {} };
    }
    return { tokens: [{ type: 'string', text: line }], stateOut: stateIn };
  }

  // 2. Tokenize line body
  while (pos < len) {
    const ch = line[pos] ?? '';

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      let end = pos + 1;
      while (end < len && (line[end] === ' ' || line[end] === '\t' || line[end] === '\r')) {
        end++;
      }
      tokens.push({ type: 'plain', text: line.slice(pos, end) });
      pos = end;
      continue;
    }

    // Line Comments
    let isLineComment = false;
    if (grammar.lineComments) {
      for (const lc of grammar.lineComments) {
        if (line.startsWith(lc, pos)) {
          tokens.push({ type: 'comment', text: line.slice(pos) });
          pos = len;
          isLineComment = true;
          break;
        }
      }
    }
    if (isLineComment) break;

    // Block Comment starts
    let isBlockComment = false;
    if (grammar.blockComments) {
      for (const bc of grammar.blockComments) {
        if (line.startsWith(bc.start, pos)) {
          const endIdx = line.indexOf(bc.end, pos + bc.start.length);
          if (endIdx !== -1) {
            tokens.push({ type: 'comment', text: line.slice(pos, endIdx + bc.end.length) });
            pos = endIdx + bc.end.length;
            isBlockComment = true;
            break;
          } else {
            tokens.push({ type: 'comment', text: line.slice(pos) });
            return {
              tokens,
              stateOut: {
                inBlockComment: true,
                commentDelimiter: bc.end,
                kind: 'block-comment',
              },
            };
          }
        }
      }
    }
    if (isBlockComment) continue;

    // Triple Quotes
    let isTripleQuote = false;
    if (grammar.tripleQuotes) {
      for (const tq of grammar.tripleQuotes) {
        if (line.startsWith(tq, pos)) {
          const endIdx = line.indexOf(tq, pos + tq.length);
          if (endIdx !== -1) {
            tokens.push({ type: 'string', text: line.slice(pos, endIdx + tq.length) });
            pos = endIdx + tq.length;
            isTripleQuote = true;
            break;
          } else {
            tokens.push({ type: 'string', text: line.slice(pos) });
            return {
              tokens,
              stateOut: {
                inMultiLineString: true,
                stringDelimiter: tq,
                kind: 'multiline-string',
                quote: tq,
              },
            };
          }
        }
      }
    }
    if (isTripleQuote) continue;

    // Single / Double Quoted Strings & Template Strings
    if (grammar.stringDelimiters?.includes(ch)) {
      const q = ch;
      let end = pos + 1;
      let escaped = false;
      let closed = false;

      while (end < len) {
        const c = line[end] ?? '';
        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === q) {
          closed = true;
          end++;
          break;
        }
        end++;
      }

      if (closed || q !== '`') {
        tokens.push({ type: 'string', text: line.slice(pos, end) });
        pos = end;
        continue;
      } else {
        // Unclosed template literal spanning multiple lines
        tokens.push({ type: 'string', text: line.slice(pos) });
        return {
          tokens,
          stateOut: {
            inMultiLineString: true,
            stringDelimiter: q,
            kind: 'multiline-string',
            quote: q,
          },
        };
      }
    }

    // Preprocessors / Annotations
    if (grammar.preprocessors && line.slice(pos).match(grammar.preprocessors)) {
      const match = grammar.preprocessors.exec(line.slice(pos));
      if (match?.index === 0) {
        tokens.push({ type: 'preprocessor', text: match[0] });
        pos += match[0].length;
        continue;
      }
    }

    // Preprocessor line start (e.g. #include, #[derive], @decorator)
    if (ch === '#' && (language === 'c' || language === 'cpp' || language === 'rust')) {
      let end = pos + 1;
      while (end < len && isWordChar(line[end] ?? '')) {
        end++;
      }
      tokens.push({ type: 'preprocessor', text: line.slice(pos, end) });
      pos = end;
      continue;
    }

    if (ch === '@' && (language === 'typescript' || language === 'java' || language === 'python' || language === 'swift')) {
      let end = pos + 1;
      while (end < len && isWordChar(line[end] ?? '')) {
        end++;
      }
      tokens.push({ type: 'preprocessor', text: line.slice(pos, end) });
      pos = end;
      continue;
    }

    // Numbers (hex, binary, octal, float, integer)
    if (isDigit(ch) || (ch === '.' && isDigit(line[pos + 1] ?? ''))) {
      let end = pos + 1;
      if (ch === '0' && (line[end] === 'x' || line[end] === 'X' || line[end] === 'b' || line[end] === 'B' || line[end] === 'o' || line[end] === 'O')) {
        end++;
        while (end < len && (/^[0-9a-fA-F_]$/.test(line[end] ?? ''))) {
          end++;
        }
      } else {
        while (end < len && (/^[0-9a-zA-Z._]$/.test(line[end] ?? ''))) {
          end++;
        }
      }
      tokens.push({ type: 'number', text: line.slice(pos, end) });
      pos = end;
      continue;
    }

    // Words / Identifiers / Keywords / Types / Functions
    if (isWordChar(ch)) {
      let end = pos + 1;
      while (end < len && isWordChar(line[end] ?? '')) {
        end++;
      }
      const word = line.slice(pos, end);
      const lowerWord = word.toLowerCase();

      // Check next non-whitespace character
      let nextNonWsIdx = end;
      while (nextNonWsIdx < len && (line[nextNonWsIdx] === ' ' || line[nextNonWsIdx] === '\t')) {
        nextNonWsIdx++;
      }
      const nextChar = line[nextNonWsIdx];

      if (grammar.keywords && (grammar.keywords.has(word) || grammar.keywords.has(lowerWord))) {
        tokens.push({ type: 'keyword', text: word });
      } else if (grammar.types && (grammar.types.has(word) || grammar.types.has(lowerWord))) {
        tokens.push({ type: 'type', text: word });
      } else if (nextChar === '(') {
        tokens.push({ type: 'function', text: word });
      } else if (/^[A-Z][a-zA-Z0-9_]*$/.test(word) && word.length > 1) {
        tokens.push({ type: 'type', text: word });
      } else {
        tokens.push({ type: 'plain', text: word });
      }

      pos = end;
      continue;
    }

    // Punctuation
    if (isPunctuationChar(ch)) {
      tokens.push({ type: 'punctuation', text: ch });
      pos++;
      continue;
    }

    // Operators
    if (isOperatorChar(ch)) {
      let end = pos + 1;
      while (end < len && isOperatorChar(line[end] ?? '')) {
        end++;
      }
      tokens.push({ type: 'operator', text: line.slice(pos, end) });
      pos = end;
      continue;
    }

    // Fallback single character
    tokens.push({ type: 'plain', text: ch });
    pos++;
  }

  return { tokens, stateOut: {} };
}

/**
 * Tokenizes multi-line code string into an array of token arrays.
 */
export function tokenizeCode(code: string, language: string): Token[][] {
  const lines = code.split(/\r?\n/);
  const result: Token[][] = [];
  let currentState: MultiLineState = {};
  for (const line of lines) {
    const res = tokenizeLine(line, currentState, language);
    result.push(res.tokens);
    currentState = res.stateOut;
  }
  return result;
}

/**
 * Tokenizes entire file contents with caching support.
 */
export function tokenizeFile(
  text: string,
  filePath: string,
  cache?: LineSyntaxCache
): HighlightedFileResult {
  const language = detectLanguage(filePath);
  const lines = text.split(/\r?\n/);
  const tokenizedLines: Token[][] = [];

  if (cache) {
    const fingerprint = `${String(text.length)}:${String(lines.length)}:${lines[0] ?? ''}`;
    cache.reset(language, fingerprint);
  }

  let currentState: MultiLineState = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (cache) {
      const cached = cache.get(i);
      if (cached?.text === line) {
        tokenizedLines.push([...cached.tokens]);
        currentState = cached.stateOut;
        continue;
      }
    }
    const res = tokenizeLine(line, currentState, language);
    if (cache) {
      cache.set(i, {
        text: line,
        stateIn: currentState,
        stateOut: res.stateOut,
        tokens: res.tokens,
      });
    }
    tokenizedLines.push(res.tokens);
    currentState = res.stateOut;
  }

  return { language, lines: tokenizedLines };
}

// ----------------------------------------------------------------------------
// HTML Escaping and Rendering
// ----------------------------------------------------------------------------

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes HTML and wraps in <span class="syn-{type}">...</span>.
 */
export function renderTokenToHtml(token: Token): string {
  const escaped = escapeHtml(token.text);
  if (token.type === 'plain') {
    return `<span class="syn-plain">${escaped}</span>`;
  }
  return `<span class="syn-${token.type}">${escaped}</span>`;
}

// ----------------------------------------------------------------------------
// Search Match Token Slicing & Highlighting
// ----------------------------------------------------------------------------

export interface SearchTokenSegment {
  readonly text: string;
  readonly type: TokenType;
  readonly isSearchMatch: boolean;
  readonly isCurrentMatch: boolean;
}

export function sliceTokensForSearch(
  tokens: readonly Token[],
  searchQuery: string,
  isLineActiveMatch = false,
  activeMatchStartCol?: number
): readonly SearchTokenSegment[] {
  if (!searchQuery) {
    return tokens.map((t) => ({
      text: t.text,
      type: t.type,
      isSearchMatch: false,
      isCurrentMatch: false,
    }));
  }

  const queryLower = searchQuery.toLowerCase();
  const segments: SearchTokenSegment[] = [];

  // Reconstruct full line and find all match ranges [start, end)
  let lineText = '';
  for (const t of tokens) {
    lineText += t.text;
  }
  const lineLower = lineText.toLowerCase();

  const matchRanges: { start: number; end: number }[] = [];
  let sPos = 0;
  while (sPos < lineLower.length) {
    const mIdx = lineLower.indexOf(queryLower, sPos);
    if (mIdx === -1) break;
    matchRanges.push({ start: mIdx, end: mIdx + queryLower.length });
    sPos = mIdx + queryLower.length;
  }

  if (matchRanges.length === 0) {
    return tokens.map((t) => ({
      text: t.text,
      type: t.type,
      isSearchMatch: false,
      isCurrentMatch: false,
    }));
  }

  let tokenOffset = 0;
  for (const token of tokens) {
    const tokenStart = tokenOffset;
    const tokenEnd = tokenOffset + token.text.length;
    tokenOffset = tokenEnd;

    // Find any match ranges that overlap [tokenStart, tokenEnd)
    const overlapping = matchRanges.filter((m) => m.end > tokenStart && m.start < tokenEnd);

    if (overlapping.length === 0) {
      segments.push({
        text: token.text,
        type: token.type,
        isSearchMatch: false,
        isCurrentMatch: false,
      });
      continue;
    }

    let relPos = 0;
    const tokLen = token.text.length;

    for (const match of overlapping) {
      const relMatchStart = Math.max(0, match.start - tokenStart);
      const relMatchEnd = Math.min(tokLen, match.end - tokenStart);

      // Pre-match portion in this token
      if (relMatchStart > relPos) {
        segments.push({
          text: token.text.slice(relPos, relMatchStart),
          type: token.type,
          isSearchMatch: false,
          isCurrentMatch: false,
        });
      }

      // Match portion
      if (relMatchEnd > relMatchStart) {
        const isCurrent =
          isLineActiveMatch &&
          activeMatchStartCol !== undefined &&
          activeMatchStartCol === match.start;

        segments.push({
          text: token.text.slice(relMatchStart, relMatchEnd),
          type: token.type,
          isSearchMatch: true,
          isCurrentMatch: isCurrent,
        });
        relPos = relMatchEnd;
      }
    }

    // Post-match trailing portion
    if (relPos < tokLen) {
      segments.push({
        text: token.text.slice(relPos),
        type: token.type,
        isSearchMatch: false,
        isCurrentMatch: false,
      });
    }
  }

  return segments;
}

/**
 * Slices tokens preserving syntax classes while wrapping match spans in <mark class="syn-search-match">.
 */
export function applySearchHighlightToTokens(
  tokens: Token[],
  searchQuery: string,
  isLineActiveMatch = false,
  activeMatchStartCol?: number
): string {
  const segments = sliceTokensForSearch(tokens, searchQuery, isLineActiveMatch, activeMatchStartCol);
  let html = '';
  for (const seg of segments) {
    const escaped = escapeHtml(seg.text);
    if (seg.isSearchMatch) {
      const activeCls = seg.isCurrentMatch ? ' syn-search-active' : '';
      html += `<mark class="syn-search-match${activeCls} syn-${seg.type}">${escaped}</mark>`;
    } else {
      html += `<span class="syn-${seg.type}">${escaped}</span>`;
    }
  }
  return html;
}
