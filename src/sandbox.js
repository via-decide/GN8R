/**
 * sandbox.js — temp git clone + bounded test runner.
 *
 * Used by validators.js to execute the target repo's existing tests against
 * a synthesized file before we commit it via the Git API.
 *
 * SAFETY:
 *   - execFile (no shell), strict timeouts, cwd inside os.tmpdir()
 *   - Never runs `npm install` / postinstall scripts (RCE vector)
 *   - Token in clone URL is redacted in any error path
 *   - Sandbox dir is always removed in finally
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const execFileP = promisify(execFile);

function redactToken(s) {
  if (!s) return s;
  return String(s).replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@');
}

function buildCloneUrl(owner, repoName, config) {
  if (config.gitProvider === 'gitea') {
    const base = (config.giteaApiBaseUrl || '').replace(/\/api\/v1\/?$/, '');
    const host = base.replace(/^https?:\/\//, '');
    return `https://${encodeURIComponent(config.giteaToken || '')}@${host}/${owner}/${repoName}.git`;
  }
  return `https://x-access-token:${config.githubToken || ''}@github.com/${owner}/${repoName}.git`;
}

/**
 * Clone the repo shallowly, run fn(sandboxDir), clean up.
 * @returns whatever fn resolves to.
 */
export async function withRepoSandbox(repo, config, fn) {
  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) throw new Error('repo must be owner/repo format');

  const dir = path.join(os.tmpdir(), `gn8r-sandbox-${crypto.randomBytes(8).toString('hex')}`);
  const cloneUrl = buildCloneUrl(owner, repoName, config);
  const cloneTimeout = config.validateCloneTimeoutMs || 90000;

  try {
    try {
      await execFileP('git', ['clone', '--depth', '1', '--no-tags', cloneUrl, dir], {
        timeout: cloneTimeout,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    } catch (err) {
      throw new Error(`Clone failed: ${redactToken(err.stderr || err.message)}`);
    }

    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Detect a runnable test command from a repo on disk.
 * @returns {{ cmd: string, args: string[], kind: string } | null}
 */
export async function detectTestCommand(sandboxDir) {
  const pkgPath = path.join(sandboxDir, 'package.json');
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    if (pkg.scripts?.test && !/^echo /.test(pkg.scripts.test)) {
      // Only run if node_modules exists — we never install.
      const nm = await fs.stat(path.join(sandboxDir, 'node_modules')).catch(() => null);
      if (nm?.isDirectory()) {
        return { cmd: 'npm', args: ['test', '--silent'], kind: 'npm' };
      }
    }
  } catch {}

  const hasPyConfig = await Promise.any([
    fs.stat(path.join(sandboxDir, 'pyproject.toml')),
    fs.stat(path.join(sandboxDir, 'pytest.ini')),
    fs.stat(path.join(sandboxDir, 'setup.cfg')),
  ]).catch(() => null);
  if (hasPyConfig) {
    return { cmd: 'pytest', args: ['-q', '--no-header'], kind: 'pytest' };
  }

  return null;
}

/**
 * Truncate combined stdout/stderr to ~8 KB.
 */
function truncOutput(stdout = '', stderr = '') {
  const combined = `${stdout}\n${stderr}`.trim();
  const max = 8 * 1024;
  return combined.length > max ? combined.slice(0, max) + '\n…[truncated]' : combined;
}

/**
 * Run the detected test command in a sandbox dir.
 * @returns {{ ran: bool, passed: bool, command?: string, output?: string, reason?: string }}
 */
export async function runTestsInSandbox(sandboxDir, config) {
  const detected = await detectTestCommand(sandboxDir);
  if (!detected) return { ran: false, passed: true, reason: 'no-tests-detected' };

  const timeout = config.validateTestTimeoutMs || 180000;
  try {
    const { stdout, stderr } = await execFileP(detected.cmd, detected.args, {
      cwd: sandboxDir,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CI: '1', npm_config_audit: 'false', npm_config_fund: 'false' },
    });
    return {
      ran: true, passed: true,
      command: `${detected.cmd} ${detected.args.join(' ')}`,
      output: truncOutput(stdout, stderr),
    };
  } catch (err) {
    return {
      ran: true, passed: false,
      command: `${detected.cmd} ${detected.args.join(' ')}`,
      output: truncOutput(err.stdout, err.stderr || err.message),
      reason: err.killed ? 'timeout' : `exit ${err.code}`,
    };
  }
}

/**
 * Apply synthesized content into the sandbox at the given relative path.
 */
export async function applySynthesizedFile(sandboxDir, relPath, content) {
  // Refuse path escape
  const safe = path.normalize(relPath).replace(/^[\\/]+/, '');
  if (safe.startsWith('..')) throw new Error(`Refusing path outside sandbox: ${relPath}`);
  const full = path.join(sandboxDir, safe);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}
