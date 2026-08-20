import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectLanguage,
  tokenizeCode,
  tokenizeFile,
  LineSyntaxCache,
  renderTokenToHtml,
  sliceTokensForSearch,
  applySearchHighlightToTokens,
  type Token,
} from '../src/ui/syntax.js';

describe('Syntax Highlighting Engine (syntax.ts)', () => {
  describe('1. Language Detection (detectLanguage)', () => {
    it('detects Systems & Low-Level languages by extension', () => {
      expect(detectLanguage('main.rs')).toBe('rust');
      expect(detectLanguage('src/lib.rs')).toBe('rust');
      expect(detectLanguage('app.c')).toBe('c');
      expect(detectLanguage('header.h')).toBe('c');
      expect(detectLanguage('server.cpp')).toBe('cpp');
      expect(detectLanguage('vector.hpp')).toBe('cpp');
      expect(detectLanguage('main.cc')).toBe('cpp');
      expect(detectLanguage('main.cxx')).toBe('cpp');
      expect(detectLanguage('Program.cs')).toBe('csharp');
      expect(detectLanguage('main.zig')).toBe('zig');
      expect(detectLanguage('server.go')).toBe('go');
      expect(detectLanguage('app.d')).toBe('d');
      expect(detectLanguage('boot.s')).toBe('assembly');
      expect(detectLanguage('kernel.asm')).toBe('assembly');
      expect(detectLanguage('module.wat')).toBe('wat');
      expect(detectLanguage('module.wast')).toBe('wat');
      expect(detectLanguage('script.nim')).toBe('nim');
      expect(detectLanguage('main.v')).toBe('v');
      expect(detectLanguage('matrix.f90')).toBe('fortran');
      expect(detectLanguage('calc.for')).toBe('fortran');
      expect(detectLanguage('pkg.adb')).toBe('ada');
      expect(detectLanguage('pkg.ads')).toBe('ada');
      expect(detectLanguage('main.ha')).toBe('hare');
    });

    it('detects Web & Scripting languages by extension', () => {
      expect(detectLanguage('index.ts')).toBe('typescript');
      expect(detectLanguage('types.mts')).toBe('typescript');
      expect(detectLanguage('common.cts')).toBe('typescript');
      expect(detectLanguage('app.js')).toBe('javascript');
      expect(detectLanguage('module.mjs')).toBe('javascript');
      expect(detectLanguage('bundle.cjs')).toBe('javascript');
      expect(detectLanguage('Component.jsx')).toBe('jsx');
      expect(detectLanguage('App.tsx')).toBe('tsx');
      expect(detectLanguage('script.py')).toBe('python');
      expect(detectLanguage('types.pyi')).toBe('python');
      expect(detectLanguage('model.rb')).toBe('ruby');
      expect(detectLanguage('index.php')).toBe('php');
      expect(detectLanguage('init.lua')).toBe('lua');
      expect(detectLanguage('script.pl')).toBe('perl');
      expect(detectLanguage('deploy.sh')).toBe('bash');
      expect(detectLanguage('setup.bash')).toBe('bash');
      expect(detectLanguage('prompt.zsh')).toBe('zsh');
      expect(detectLanguage('install.ps1')).toBe('powershell');
      expect(detectLanguage('analysis.r')).toBe('r');
      expect(detectLanguage('analysis.R')).toBe('r');
      expect(detectLanguage('model.jl')).toBe('julia');
      expect(detectLanguage('widget.tcl')).toBe('tcl');
      expect(detectLanguage('script.applescript')).toBe('applescript');
      expect(detectLanguage('build.groovy')).toBe('groovy');
    });

    it('detects Functional & VM languages by extension', () => {
      expect(detectLanguage('Main.java')).toBe('java');
      expect(detectLanguage('App.kt')).toBe('kotlin');
      expect(detectLanguage('build.gradle.kts')).toBe('kotlin');
      expect(detectLanguage('Server.scala')).toBe('scala');
      expect(detectLanguage('Views.swift')).toBe('swift');
      expect(detectLanguage('Main.hs')).toBe('haskell');
      expect(detectLanguage('Router.ex')).toBe('elixir');
      expect(detectLanguage('mix.exs')).toBe('elixir');
      expect(detectLanguage('server.erl')).toBe('erlang');
      expect(detectLanguage('core.clj')).toBe('clojure');
      expect(detectLanguage('data.edn')).toBe('clojure');
      expect(detectLanguage('main.ml')).toBe('ocaml');
      expect(detectLanguage('Program.fs')).toBe('fsharp');
      expect(detectLanguage('main.dart')).toBe('dart');
    });

    it('detects Data, Config & Schema formats by extension', () => {
      expect(detectLanguage('package.json')).toBe('json');
      expect(detectLanguage('config.jsonc')).toBe('jsonc');
      expect(detectLanguage('workflow.yaml')).toBe('yaml');
      expect(detectLanguage('docker-compose.yml')).toBe('yaml');
      expect(detectLanguage('Cargo.toml')).toBe('toml');
      expect(detectLanguage('pom.xml')).toBe('xml');
      expect(detectLanguage('icon.svg')).toBe('xml');
      expect(detectLanguage('index.html')).toBe('html');
      expect(detectLanguage('styles.css')).toBe('css');
      expect(detectLanguage('main.scss')).toBe('scss');
      expect(detectLanguage('query.sql')).toBe('sql');
      expect(detectLanguage('schema.graphql')).toBe('graphql');
      expect(detectLanguage('default.nix')).toBe('nix');
      expect(detectLanguage('CMakeLists.txt')).toBe('cmake');
      expect(detectLanguage('service.proto')).toBe('protobuf');
      expect(detectLanguage('main.tf')).toBe('terraform');
      expect(detectLanguage('shader.wgsl')).toBe('wgsl');
      expect(detectLanguage('shader.glsl')).toBe('glsl');
    });

    it('detects Documents & Formats by extension', () => {
      expect(detectLanguage('README.md')).toBe('markdown');
      expect(detectLanguage('changes.diff')).toBe('diff');
      expect(detectLanguage('patch.patch')).toBe('diff');
      expect(detectLanguage('settings.ini')).toBe('ini');
      expect(detectLanguage('app.cfg')).toBe('ini');
      expect(detectLanguage('paper.tex')).toBe('latex');
      expect(detectLanguage('refs.bib')).toBe('bibtex');
      expect(detectLanguage('data.csv')).toBe('csv');
      expect(detectLanguage('app.log')).toBe('log');
    });

    it('detects special exact filenames and hidden configs', () => {
      expect(detectLanguage('Dockerfile')).toBe('dockerfile');
      expect(detectLanguage('Dockerfile.prod')).toBe('dockerfile');
      expect(detectLanguage('Makefile')).toBe('makefile');
      expect(detectLanguage('GNUmakefile')).toBe('makefile');
      expect(detectLanguage('CMakeLists.txt')).toBe('cmake');
      expect(detectLanguage('Rakefile')).toBe('ruby');
      expect(detectLanguage('Gemfile')).toBe('ruby');
      expect(detectLanguage('Jenkinsfile')).toBe('groovy');
      expect(detectLanguage('.bashrc')).toBe('bash');
      expect(detectLanguage('.zshrc')).toBe('zsh');
      expect(detectLanguage('.gitconfig')).toBe('ini');
      expect(detectLanguage('.editorconfig')).toBe('ini');
      expect(detectLanguage('.env')).toBe('ini');
      expect(detectLanguage('Cargo.toml')).toBe('toml');
      expect(detectLanguage('tsconfig.json')).toBe('jsonc');
    });

    it('falls back to plain text for unknown extensions or missing input', () => {
      expect(detectLanguage('')).toBe('plain');
      expect(detectLanguage('unknown.xyz123')).toBe('plain');
      expect(detectLanguage('LICENSE')).toBe('plain');
    });
  });

  describe('2. Systems & Low-Level Tokenization', () => {
    it('tokenizes Rust keywords, types, strings, comments and macros', () => {
      const code = `pub fn calculate_sum(val: u64) -> Result<String, MyError> {\n    // Single-line comment\n    println!("Value: {}", val);\n    let is_valid = true;\n    Ok(format!("{is_valid}"))\n}`;
      const lines = tokenizeCode(code, 'rust');
      expect(lines).toHaveLength(6);

      const line0 = lines[0] ?? [];
      expect(line0.some((t) => t.type === 'keyword' && t.text === 'pub')).toBe(true);
      expect(line0.some((t) => t.type === 'keyword' && t.text === 'fn')).toBe(true);
      expect(line0.some((t) => t.type === 'type' && t.text === 'u64')).toBe(true);
      expect(line0.some((t) => t.type === 'type' && t.text === 'Result')).toBe(true);
      expect(line0.some((t) => t.type === 'type' && t.text === 'String')).toBe(true);

      const line1 = lines[1] ?? [];
      expect(line1.some((t) => t.type === 'comment' && t.text.includes('Single-line comment'))).toBe(true);

      const line2 = lines[2] ?? [];
      expect(line2.some((t) => t.type === 'string' && t.text === '"Value: {}"')).toBe(true);

      const line3 = lines[3] ?? [];
      expect(line3.some((t) => t.type === 'keyword' && t.text === 'let')).toBe(true);
      expect(line3.some((t) => t.type === 'keyword' && t.text === 'true')).toBe(true);
    });

    it('tokenizes C / C++ with preprocessors, types, and pointers', () => {
      const code = `#include <stdio.h>\n#define BUFFER_SIZE 1024\n\nint main(int argc, char** argv) {\n    printf("Hello C %d\\n", BUFFER_SIZE);\n    return 0;\n}`;
      const lines = tokenizeCode(code, 'c');
      expect(lines).toHaveLength(7);

      expect(lines[0]?.some((t) => t.type === 'preprocessor' && t.text.includes('#include'))).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'preprocessor' && t.text.includes('#define'))).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'keyword' && t.text === 'int')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'keyword' && t.text === 'char')).toBe(true);
      expect(lines[5]?.some((t) => t.type === 'keyword' && t.text === 'return')).toBe(true);
      expect(lines[5]?.some((t) => t.type === 'number' && t.text === '0')).toBe(true);
    });

    it('tokenizes Zig builtins, types, and control flow', () => {
      const code = `const std = @import("std");\npub fn main() !void {\n    const stdout = std.io.getStdOut().writer();\n    try stdout.print("Zig {d}\\n", .{42});\n}`;
      const lines = tokenizeCode(code, 'zig');
      expect(lines[0]?.some((t) => t.type === 'keyword' && t.text === 'const')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'type' && t.text === 'void')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'keyword' && t.text === 'try')).toBe(true);
    });

    it('tokenizes Go channels, packages, and goroutines', () => {
      const code = `package main\nimport "fmt"\nfunc worker(ch chan int) {\n    ch <- 42\n}`;
      const lines = tokenizeCode(code, 'go');
      expect(lines[0]?.some((t) => t.type === 'keyword' && t.text === 'package')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'keyword' && t.text === 'func')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'keyword' && t.text === 'chan')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'type' && t.text === 'int')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'operator' && t.text === '<-')).toBe(true);
    });

    it('tokenizes Assembly instructions, registers, and labels', () => {
      const code = `global _start\nsection .text\n_start:\n    mov rax, 60\n    xor rdi, rdi\n    syscall`;
      const lines = tokenizeCode(code, 'assembly');
      expect(lines[3]?.some((t) => t.type === 'keyword' && t.text === 'mov')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'type' && t.text === 'rax')).toBe(true);
      expect(lines[4]?.some((t) => t.type === 'keyword' && t.text === 'xor')).toBe(true);
      expect(lines[4]?.some((t) => t.type === 'type' && t.text === 'rdi')).toBe(true);
    });

    it('tokenizes Fortran, Ada, Nim, and V', () => {
      const ftn = `PROGRAM hello\n  PRINT *, "Hello Fortran"\nEND PROGRAM hello`;
      expect(tokenizeCode(ftn, 'fortran')[0]?.some((t) => t.type === 'keyword' && t.text.toLowerCase() === 'program')).toBe(true);

      const ada = `procedure Hello is\nbegin\n  null;\nend Hello;`;
      expect(tokenizeCode(ada, 'ada')[0]?.some((t) => t.type === 'keyword' && t.text === 'procedure')).toBe(true);

      const nim = `proc add(x, y: int): int =\n  result = x + y`;
      expect(tokenizeCode(nim, 'nim')[0]?.some((t) => t.type === 'keyword' && t.text === 'proc')).toBe(true);

      const v = `fn main() {\n  println('hello v')\n}`;
      expect(tokenizeCode(v, 'v')[0]?.some((t) => t.type === 'keyword' && t.text === 'fn')).toBe(true);
    });
  });

  describe('3. Web & Scripting Tokenization', () => {
    it('tokenizes TypeScript / JavaScript keywords, types, and decorators', () => {
      const code = `@Injectable()\nexport class UserService implements IUserService {\n  private readonly id: string = "usr_123";\n  async fetchUser(id: number): Promise<User | null> {\n    return await db.find(id);\n  }\n}`;
      const lines = tokenizeCode(code, 'typescript');
      expect(lines[0]?.some((t) => t.type === 'preprocessor' && t.text === '@Injectable')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'keyword' && t.text === 'export')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'keyword' && t.text === 'class')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'keyword' && t.text === 'implements')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'keyword' && t.text === 'private')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'type' && t.text === 'string')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'keyword' && t.text === 'async')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'type' && t.text === 'Promise')).toBe(true);
    });

    it('tokenizes Python defs, decorators, docstrings, and booleans', () => {
      const code = `@dataclass\ndef calculate_metric(data: list) -> float:\n    # Computes average\n    total = sum(data)\n    return total / len(data) if data else 0.0`;
      const lines = tokenizeCode(code, 'python');
      expect(lines[0]?.some((t) => t.type === 'preprocessor' && t.text === '@dataclass')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'keyword' && t.text === 'def')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'type' && t.text === 'float')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'comment' && t.text.includes('Computes average'))).toBe(true);
      expect(lines[4]?.some((t) => t.type === 'keyword' && t.text === 'return')).toBe(true);
      expect(lines[4]?.some((t) => t.type === 'keyword' && t.text === 'if')).toBe(true);
    });

    it('tokenizes Shell / Bash script keywords, flags, and variables', () => {
      const code = `#!/bin/bash\nset -euo pipefail\nif [ -z "$1" ]; then\n  echo "Error: missing arg"\n  exit 1\nfi`;
      const lines = tokenizeCode(code, 'bash');
      expect(lines[0]?.some((t) => t.type === 'comment')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'keyword' && t.text === 'if')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'keyword' && t.text === 'then')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'type' && t.text === 'echo')).toBe(true);
      expect(lines[4]?.some((t) => t.type === 'keyword' && t.text === 'exit')).toBe(true);
      expect(lines[5]?.some((t) => t.type === 'keyword' && t.text === 'fi')).toBe(true);
    });

    it('tokenizes Ruby, PHP, Lua, Perl, PowerShell, R, and Julia', () => {
      const rb = `class User < ApplicationRecord\n  validates :email, presence: true\nend`;
      expect(tokenizeCode(rb, 'ruby')[0]?.some((t) => t.type === 'keyword' && t.text === 'class')).toBe(true);

      const php = `<?php\nclass App {\n  public function run(): void {}\n}`;
      expect(tokenizeCode(php, 'php')[1]?.some((t) => t.type === 'keyword' && t.text === 'class')).toBe(true);

      const lua = `local function greet(name)\n  return "Hello " .. name\nend`;
      expect(tokenizeCode(lua, 'lua')[0]?.some((t) => t.type === 'keyword' && t.text === 'local')).toBe(true);

      const r = `result <- mean(c(1, 2, 3))\nprint(result)`;
      expect(tokenizeCode(r, 'r')[0]?.some((t) => t.type === 'operator' && t.text === '<-')).toBe(true);

      const jl = `function add(a::Int, b::Int)::Int\n  return a + b\nend`;
      expect(tokenizeCode(jl, 'julia')[0]?.some((t) => t.type === 'keyword' && t.text === 'function')).toBe(true);
    });
  });

  describe('4. Functional & VM Tokenization', () => {
    it('tokenizes Java sealed classes, records, and annotations', () => {
      const code = `@Override\npublic sealed interface Shape permits Circle, Square {\n    double area();\n}`;
      const lines = tokenizeCode(code, 'java');
      expect(lines[0]?.some((t) => t.type === 'preprocessor' && t.text === '@Override')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'keyword' && t.text === 'public')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'keyword' && t.text === 'sealed')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'keyword' && t.text === 'interface')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'keyword' && t.text === 'permits')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'keyword' && t.text === 'double')).toBe(true);
    });

    it('tokenizes Kotlin data classes and companion objects', () => {
      const code = `data class User(val id: String, var age: Int) {\n    companion object {\n        fun create() = User("0", 18)\n    }\n}`;
      const lines = tokenizeCode(code, 'kotlin');
      expect(lines[0]?.some((t) => t.type === 'keyword' && t.text === 'data')).toBe(true);
      expect(lines[0]?.some((t) => t.type === 'keyword' && t.text === 'class')).toBe(true);
      expect(lines[0]?.some((t) => t.type === 'keyword' && t.text === 'val')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'keyword' && t.text === 'companion')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'keyword' && t.text === 'object')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'keyword' && t.text === 'fun')).toBe(true);
    });

    it('tokenizes Haskell data types and where clauses', () => {
      const code = `data Option a = Some a | None\n\nmapOption :: (a -> b) -> Option a -> Option b\nmapOption f (Some x) = Some (f x)\nmapOption _ None = None`;
      const lines = tokenizeCode(code, 'haskell');
      expect(lines[0]?.some((t) => t.type === 'keyword' && t.text === 'data')).toBe(true);
      expect(lines[0]?.some((t) => t.type === 'type' && t.text === 'Some')).toBe(true);
      expect(lines[0]?.some((t) => t.type === 'type' && t.text === 'None')).toBe(true);
    });

    it('tokenizes Swift, Scala, Elixir, Erlang, Clojure, OCaml, and F#', () => {
      const sw = `actor BankAccount {\n  private var balance: Double = 0.0\n}`;
      expect(tokenizeCode(sw, 'swift')[0]?.some((t) => t.type === 'keyword' && t.text === 'actor')).toBe(true);

      const sc = `enum Color {\n  case Red, Green, Blue\n}`;
      expect(tokenizeCode(sc, 'scala')[0]?.some((t) => t.type === 'keyword' && t.text === 'enum')).toBe(true);

      const ex = `defmodule App.Server do\n  use GenServer\nend`;
      expect(tokenizeCode(ex, 'elixir')[0]?.some((t) => t.type === 'keyword' && t.text === 'defmodule')).toBe(true);

      const ml = `let rec fact n =\n  if n <= 1 then 1 else n * fact (n - 1)`;
      expect(tokenizeCode(ml, 'ocaml')[0]?.some((t) => t.type === 'keyword' && t.text === 'let')).toBe(true);
    });
  });

  describe('5. Data, Config & Formats Tokenization', () => {
    it('tokenizes JSON and JSONC', () => {
      const code = `{\n  "name": "sendforge",\n  "version": 1,\n  "private": true,\n  "description": null\n}`;
      const lines = tokenizeCode(code, 'json');
      expect(lines[0]?.some((t) => t.type === 'punctuation' && t.text === '{')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'string' && t.text.includes('"name"'))).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'number' && t.text === '1')).toBe(true);
    });

    it('tokenizes SQL queries with uppercase keywords and types', () => {
      const code = `SELECT id, name, created_at\nFROM users\nWHERE active = TRUE AND role IN ('admin', 'editor')\nORDER BY created_at DESC\nLIMIT 50;`;
      const lines = tokenizeCode(code, 'sql');
      expect(lines[0]?.some((t) => t.type === 'keyword' && t.text === 'SELECT')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'keyword' && t.text === 'FROM')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'keyword' && t.text === 'WHERE')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'keyword' && t.text === 'TRUE')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'keyword' && t.text === 'ORDER')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'keyword' && t.text === 'BY')).toBe(true);
      expect(lines[4]?.some((t) => t.type === 'keyword' && t.text === 'LIMIT')).toBe(true);
    });

    it('tokenizes Diff and Patch files', () => {
      const code = `diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,4 @@\n context line\n+added line\n-removed line`;
      const lines = tokenizeCode(code, 'diff');
      expect(lines[0]?.some((t) => t.type === 'type')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'type')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'type')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'preprocessor')).toBe(true);
      expect(lines[5]?.some((t) => t.type === 'string' && t.text === '+added line')).toBe(true);
      expect(lines[6]?.some((t) => t.type === 'operator' && t.text === '-removed line')).toBe(true);
    });

    it('tokenizes Markdown headers, fences, lists, and inline code', () => {
      const code = `# Sendforge Phase 4\n\n- Feature 1\n- Feature 2\n\n\`\`\`rust\nfn main() {}\n\`\`\``;
      const lines = tokenizeCode(code, 'markdown');
      expect(lines[0]?.some((t) => t.type === 'keyword' && t.text === '# ')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'keyword' && t.text === '- ')).toBe(true);
      expect(lines[5]?.some((t) => t.type === 'preprocessor' && t.text === '```rust')).toBe(true);
    });

    it('tokenizes HTML / XML tags, attributes, strings, and comments', () => {
      const code = `<!DOCTYPE html>\n<html>\n  <head>\n    <!-- Navigation bar -->\n    <meta charset="utf-8" />\n  </head>\n  <body class="dark-theme">\n    <h1 id="title">Hello World</h1>\n  </body>\n</html>`;
      const lines = tokenizeCode(code, 'html');
      expect(lines[0]?.some((t) => t.type === 'preprocessor')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'comment' && t.text.includes('Navigation bar'))).toBe(true);
      expect(lines[4]?.some((t) => t.type === 'tag' && t.text === 'meta')).toBe(true);
      expect(lines[4]?.some((t) => t.type === 'attribute' && t.text === 'charset')).toBe(true);
      expect(lines[4]?.some((t) => t.type === 'string' && t.text === '"utf-8"')).toBe(true);
    });

    it('tokenizes INI configuration files', () => {
      const code = `; Configuration header\n[server]\nhost = 127.0.0.1\nport: 8080`;
      const lines = tokenizeCode(code, 'ini');
      expect(lines[0]?.some((t) => t.type === 'comment')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'type' && t.text === '[server]')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'keyword' && t.text === 'host ')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'operator' && t.text === '=')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'string' && t.text === ' 127.0.0.1')).toBe(true);
    });

    it('tokenizes YAML, TOML, GraphQL, Protobuf, Terraform, and Shaders', () => {
      const toml = `[package]\nname = "sendforge"\nversion = "0.1.0"`;
      expect(tokenizeCode(toml, 'toml')[0]?.some((t) => t.type === 'type' && t.text === '[package]')).toBe(true);

      const gql = `type User {\n  id: ID!\n  name: String\n}`;
      expect(tokenizeCode(gql, 'graphql')[0]?.some((t) => t.type === 'keyword' && t.text === 'type')).toBe(true);

      const proto = `syntax = "proto3";\nmessage Request {\n  string query = 1;\n}`;
      expect(tokenizeCode(proto, 'protobuf')[1]?.some((t) => t.type === 'keyword' && t.text === 'message')).toBe(true);

      const tf = `resource "aws_s3_bucket" "b" {\n  bucket = "my-bucket"\n}`;
      expect(tokenizeCode(tf, 'terraform')[0]?.some((t) => t.type === 'keyword' && t.text === 'resource')).toBe(true);

      const wgsl = `struct VertexOutput {\n  @builtin(position) pos: vec4<f32>,\n};`;
      expect(tokenizeCode(wgsl, 'wgsl')[0]?.some((t) => t.type === 'keyword' && t.text === 'struct')).toBe(true);
    });
  });

  describe('6. Multi-Line State Transitions', () => {
    it('spans C-style block comments across multiple lines', () => {
      const code = `let x = 1;\n/* Start of comment\n   Middle of comment\n   End of comment */\nlet y = 2;`;
      const lines = tokenizeCode(code, 'rust');
      expect(lines).toHaveLength(5);
      expect(lines[1]?.every((t) => t.type === 'comment')).toBe(true);
      expect(lines[2]?.every((t) => t.type === 'comment')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'comment' && t.text.includes('End of comment */'))).toBe(true);
      expect(lines[4]?.some((t) => t.type === 'keyword' && t.text === 'let')).toBe(true);
    });

    it('spans HTML/XML multi-line comments across lines', () => {
      const code = `<div>\n  <!--\n    Multi line html\n    comment block\n  -->\n</div>`;
      const lines = tokenizeCode(code, 'html');
      expect(lines).toHaveLength(6);
      expect(lines[1]?.some((t) => t.type === 'comment')).toBe(true);
      expect(lines[2]?.every((t) => t.type === 'comment')).toBe(true);
      expect(lines[3]?.every((t) => t.type === 'comment')).toBe(true);
      expect(lines[4]?.some((t) => t.type === 'comment')).toBe(true);
      expect(lines[5]?.some((t) => t.type === 'tag' && t.text === 'div')).toBe(true);
    });

    it('spans Haskell block comments across lines', () => {
      const code = `{- Start haskell comment\n   middle\n   end -}\nmain = putStrLn "hi"`;
      const lines = tokenizeCode(code, 'haskell');
      expect(lines[0]?.every((t) => t.type === 'comment')).toBe(true);
      expect(lines[1]?.every((t) => t.type === 'comment')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'comment')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'type' && t.text === 'putStrLn')).toBe(true);
    });

    it('spans Python triple-quoted docstrings across lines', () => {
      const code = `def foo():\n    """\n    This is a multiline\n    docstring in Python.\n    """\n    return 42`;
      const lines = tokenizeCode(code, 'python');
      expect(lines[1]?.some((t) => t.type === 'string')).toBe(true);
      expect(lines[2]?.every((t) => t.type === 'string')).toBe(true);
      expect(lines[3]?.every((t) => t.type === 'string')).toBe(true);
      expect(lines[4]?.some((t) => t.type === 'string')).toBe(true);
      expect(lines[5]?.some((t) => t.type === 'keyword' && t.text === 'return')).toBe(true);
    });

    it('spans JavaScript template string across lines', () => {
      const code = `const template = \`hello\nworld\nend\`;\nconst next = 10;`;
      const lines = tokenizeCode(code, 'javascript');
      expect(lines[0]?.some((t) => t.type === 'string' && t.text === '`hello')).toBe(true);
      expect(lines[1]?.some((t) => t.type === 'string' && t.text === 'world')).toBe(true);
      expect(lines[2]?.some((t) => t.type === 'string' && t.text === 'end`')).toBe(true);
      expect(lines[3]?.some((t) => t.type === 'keyword' && t.text === 'const')).toBe(true);
    });

    it('spans Shell heredocs across lines', () => {
      const code = `cat <<EOF\nline 1\nline 2\nEOF\necho "done"`;
      const lines = tokenizeCode(code, 'bash');
      expect(lines).toHaveLength(5);
    });
  });

  describe('7. Line-by-Line Syntax Cache (LineSyntaxCache)', () => {
    let cache: LineSyntaxCache;

    beforeEach(() => {
      cache = new LineSyntaxCache();
    });

    it('stores and retrieves cached line entries', () => {
      const lineText = 'const answer: number = 42;';
      const tokens1 = cache.tokenizeLine(lineText, 0, 'typescript');
      expect(tokens1.some((t) => t.type === 'keyword' && t.text === 'const')).toBe(true);

      const cachedEntry = cache.get(0);
      expect(cachedEntry).toBeDefined();
      expect(cachedEntry?.text).toBe(lineText);

      // Subsequent retrieval uses cache
      const tokens2 = cache.tokenizeLine(lineText, 0, 'typescript');
      expect(tokens2).toEqual(tokens1);
    });

    it('invalidates and clears cache properly', () => {
      cache.tokenizeLine('let a = 1;', 0, 'rust');
      expect(cache.get(0)).toBeDefined();

      cache.invalidate();
      expect(cache.get(0)).toBeUndefined();
    });

    it('resets cache on language or fingerprint mismatch in tokenizeFile', () => {
      const text1 = 'fn first() {}';
      const res1 = tokenizeFile(text1, 'main.rs', cache);
      expect(res1.language).toBe('rust');
      expect(cache.get(0)).toBeDefined();

      const text2 = 'def first(): pass';
      const res2 = tokenizeFile(text2, 'main.py', cache);
      expect(res2.language).toBe('python');
      expect(cache.get(0)?.text).toBe('def first(): pass');
    });

    it('performs O(1) warm cache lookups across large file scrolling', () => {
      const sampleLines = Array.from({ length: 100 }, (_, i) => `let var_${String(i)} = ${String(i)};`);
      const fileText = sampleLines.join('\n');

      // Cold pass
      tokenizeFile(fileText, 'main.rs', cache);

      // Warm line lookups
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) {
        const tokens = cache.tokenizeLine(sampleLines[i] ?? '', i, 'rust');
        expect(tokens.length).toBeGreaterThan(0);
      }
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(50); // Under 50ms for 100 line lookups
    });
  });

  describe('8. Search Highlight Token Slicing & HTML Rendering', () => {
    it('slices tokens accurately around search matches', () => {
      const tokens: Token[] = [
        { type: 'keyword', text: 'function' },
        { type: 'plain', text: ' ' },
        { type: 'function', text: 'findUsers' },
        { type: 'punctuation', text: '(' },
        { type: 'punctuation', text: ')' },
      ];

      const segments = sliceTokensForSearch(tokens, 'find', true, 9);
      expect(segments).toHaveLength(6);

      const matchSeg = segments.find((s) => s.isSearchMatch);
      expect(matchSeg).toBeDefined();
      expect(matchSeg?.text).toBe('find');
      expect(matchSeg?.type).toBe('function');
      expect(matchSeg?.isCurrentMatch).toBe(true);
    });

    it('handles search query not found cleanly', () => {
      const tokens: Token[] = [{ type: 'keyword', text: 'return' }, { type: 'plain', text: ' 0;' }];
      const segments = sliceTokensForSearch(tokens, 'nonexistent');
      expect(segments).toHaveLength(2);
      expect(segments.every((s) => !s.isSearchMatch)).toBe(true);
    });

    it('handles multiple occurrences in a single line', () => {
      const tokens: Token[] = [
        { type: 'keyword', text: 'let' },
        { type: 'plain', text: ' item = item + item;' },
      ];
      const segments = sliceTokensForSearch(tokens, 'item');
      const matches = segments.filter((s) => s.isSearchMatch);
      expect(matches).toHaveLength(3);
    });

    it('handles special characters in search queries without regex errors', () => {
      const tokens: Token[] = [
        { type: 'plain', text: 'const fn = (a: number) => a * 2;' },
      ];
      const segments = sliceTokensForSearch(tokens, '(a: number)');
      expect(segments.some((s) => s.isSearchMatch && s.text === '(a: number)')).toBe(true);
    });

    it('renders HTML with <mark> tags and escaped special characters', () => {
      const tokens: Token[] = [
        { type: 'keyword', text: 'if' },
        { type: 'plain', text: ' (x < 10 && y > 20)' },
      ];
      const html = applySearchHighlightToTokens(tokens, 'x < 10');
      expect(html).toContain('&lt;');
      expect(html).toContain('&amp;&amp;');
      expect(html).toContain('<mark class="syn-search-match');
    });

    it('escapes HTML special characters correctly in renderTokenToHtml', () => {
      const token: Token = { type: 'string', text: '<script>alert("XSS & \'attack\'")</script>' };
      const html = renderTokenToHtml(token);
      expect(html).toBe('<span class="syn-string">&lt;script&gt;alert(&quot;XSS &amp; &#39;attack&#39;&quot;)&lt;/script&gt;</span>');
    });
  });
});
