/**
 * Process Supervisor for Sendforge CLI and Daemon Execution
 * Locates the compiled binary, executes CLI commands, and manages
 * the background `sendforge serve` static server daemon with health checks.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

export class SendforgeSupervisor {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || path.resolve('.');
    this.binaryPath = this._resolveBinaryPath();
    this.activeProcesses = new Set();
  }

  _resolveBinaryPath() {
    const candidates = [
      process.env.SENDFORGE_BIN,
      path.join(this.projectRoot, 'target', 'release', 'sendforge'),
      path.join(this.projectRoot, 'target', 'debug', 'sendforge'),
      path.join(this.projectRoot, 'target', 'release', 'sendforge-cli'),
      path.join(this.projectRoot, 'target', 'debug', 'sendforge-cli'),
    ].filter(Boolean);

    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        return cand;
      }
    }

    // Default to using cargo run if binary not pre-compiled
    return 'cargo';
  }

  /**
   * Run a Sendforge CLI command synchronously
   */
  runCli(args, options = {}) {
    const { cwd = this.projectRoot, stdin = '', env = {}, timeout = 15000 } = options;

    let cmd = this.binaryPath;
    let actualArgs = args;

    if (this.binaryPath === 'cargo') {
      cmd = 'cargo';
      actualArgs = ['run', '--quiet', '--', ...args];
    }

    const mergedEnv = {
      ...process.env,
      RUST_BACKTRACE: '1',
      ...env
    };

    const res = spawnSync(cmd, actualArgs, {
      cwd,
      input: stdin,
      env: mergedEnv,
      timeout,
      encoding: 'utf-8'
    });

    return {
      status: res.status,
      stdout: res.stdout || '',
      stderr: res.stderr || '',
      error: res.error
    };
  }

  /**
   * Helper for `sendforge init <repo-path>`
   */
  init(repoPath, options = {}) {
    const args = ['init', repoPath];
    if (options.bare !== false) args.push('--bare');
    if (options.defaultBranch) args.push('--default-branch', options.defaultBranch);
    if (options.extraArgs) args.push(...options.extraArgs);
    return this.runCli(args, options);
  }

  /**
   * Helper for `sendforge hook` (executing post-receive ref updates via stdin)
   */
  hook(repoPath, refLines, options = {}) {
    const stdin = Array.isArray(refLines) ? refLines.join('\n') + '\n' : String(refLines);
    const args = ['hook'];
    if (options.repoPath) args.push(options.repoPath);
    return this.runCli(args, { ...options, cwd: repoPath, stdin });
  }

  /**
   * Helper for `sendforge export <repo-path> <dest-dir>`
   */
  export(repoPath, destDir, options = {}) {
    const args = ['export', repoPath, destDir];
    if (options.baseUrl) args.push('--base-url', options.baseUrl);
    if (options.extraArgs) args.push(...options.extraArgs);
    return this.runCli(args, options);
  }

  /**
   * Get an available ephemeral TCP port
   */
  async getFreePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
  }

  /**
   * Start `sendforge serve` daemon in the background on an ephemeral port
   */
  async startServer(repoPath, options = {}) {
    const port = options.port || await this.getFreePort();
    const host = options.host || '127.0.0.1';
    const extraArgs = options.extraArgs || [];

    let cmd = this.binaryPath;
    let actualArgs = ['serve', repoPath, '--port', String(port), '--host', host, ...extraArgs];

    if (this.binaryPath === 'cargo') {
      cmd = 'cargo';
      actualArgs = ['run', '--quiet', '--', ...actualArgs];
    }

    const logs = { stdout: '', stderr: '' };
    const proc = spawn(cmd, actualArgs, {
      cwd: repoPath,
      env: { ...process.env, RUST_BACKTRACE: '1', ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.activeProcesses.add(proc);

    proc.stdout.on('data', chunk => {
      logs.stdout += chunk.toString('utf-8');
    });

    proc.stderr.on('data', chunk => {
      logs.stderr += chunk.toString('utf-8');
    });

    let exited = false;
    proc.on('exit', (code, signal) => {
      exited = true;
      this.activeProcesses.delete(proc);
    });

    const baseUrl = `http://${host}:${port}`;

    // Health check polling
    const maxWaitMs = options.timeoutMs || 10000;
    const startTime = Date.now();
    let ready = false;

    while (Date.now() - startTime < maxWaitMs) {
      if (exited) {
        throw new Error(`Server process exited prematurely with code ${proc.exitCode}:\n${logs.stderr}\n${logs.stdout}`);
      }

      try {
        const res = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(500) });
        if (res.status >= 200 && res.status < 500) {
          ready = true;
          break;
        }
      } catch (e) {
        // Retry
      }
      await new Promise(r => setTimeout(r, 100));
    }

    if (!ready) {
      proc.kill('SIGKILL');
      throw new Error(`Timed out waiting for Sendforge static server at ${baseUrl} after ${maxWaitMs}ms.\nLogs:\n${logs.stderr}\n${logs.stdout}`);
    }

    return {
      proc,
      port,
      host,
      baseUrl,
      logs,
      stop: async () => {
        if (!exited) {
          proc.kill('SIGTERM');
          await new Promise(resolve => {
            const timeout = setTimeout(() => {
              try { proc.kill('SIGKILL'); } catch (e) {}
              resolve();
            }, 3000);
            proc.on('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        }
        this.activeProcesses.delete(proc);
      }
    };
  }

  /**
   * Terminate all active processes
   */
  cleanup() {
    for (const proc of this.activeProcesses) {
      try {
        proc.kill('SIGKILL');
      } catch (e) {}
    }
    this.activeProcesses.clear();
  }
}

export { SendforgeSupervisor as Supervisor };
