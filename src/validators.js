/**
 * validators.js — deterministic rule checks + sandbox test orchestration.
 *
 * Public API:
 *   runValidation({ filePath, content, repo, config, onProgress })
 *     → { passed, ruleFindings[], testResult, reason? }
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { withRepoSandbox, applySynthesizedFile, runTestsInSandbox } from './sandbox.js';

const execFileP = promisify(execFile);

const SECRET_PATTERNS = [
  { name: 'aws_access_key',    re: /AKIA[0-9A-Z]{16}/ },
  { name: 'github_pat',        re: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'github_oauth',      re: /gho_[A-Za-z0-9]{36}/ },
  { name: 'openai_key',        re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'private_key_block', re: /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/ },
];

const BANNED_PATH_RES = [
  /^\.github\/workflows\//,
  /^node_modules\//,
  /(^|\/)\.env(\.|$)/,
  /\.pem$/,
];

export function runRuleChecks(filePath, content, config) {
  const findings = [];
  const maxBytes = config.validateMaxFileBytes || 1048576;

  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    findings.push({ rule: 'max_file_bytes', detail: `file > ${maxBytes} bytes` });
  }

  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(content)) findings.push({ rule: 'secret_pattern', detail: name });
  }

  for (const re of BANNED_PATH_RES) {
    if (re.test(filePath)) {
      findings.push({ rule: 'banned_path', detail: `${filePath} matches ${re}` });
      break;
    }
  }

  return findings;
}

/**
 * Lightweight syntax check. Returns null on pass, string reason on fail.
 * Skips silently for unsupported extensions.
 */
async function runSyntaxCheck(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.json') {
    try { JSON.parse(content); return null; }
    catch (e) { return `invalid JSON: ${e.message}`; }
  }

  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    const tmp = path.join(os.tmpdir(), `gn8r-syn-${Date.now()}-${process.pid}${ext}`);
    try {
      await fs.writeFile(tmp, content, 'utf8');
      await execFileP('node', ['--check', tmp], { timeout: 10000 });
      return null;
    } catch (e) {
      return `node --check failed: ${(e.stderr || e.message || '').slice(0, 400)}`;
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }

  if (ext === '.py') {
    const tmp = path.join(os.tmpdir(), `gn8r-syn-${Date.now()}-${process.pid}.py`);
    try {
      await fs.writeFile(tmp, content, 'utf8');
      await execFileP('python3', ['-m', 'py_compile', tmp], { timeout: 10000 });
      return null;
    } catch (e) {
      return `py_compile failed: ${(e.stderr || e.message || '').slice(0, 400)}`;
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }

  return null;
}

/**
 * Full validation: rule checks → syntax → optional sandbox tests.
 */
export async function runValidation({ filePath, content, repo, config, onProgress }) {
  onProgress?.('• Rule checks…');
  const ruleFindings = runRuleChecks(filePath, content, config);
  if (ruleFindings.length) {
    return {
      passed: false, ruleFindings,
      testResult: { ran: false, passed: false, reason: 'rules_blocked' },
      reason: ruleFindings.map(f => `${f.rule}:${f.detail}`).join('; '),
    };
  }

  onProgress?.('• Syntax sniff…');
  const syntaxFail = await runSyntaxCheck(filePath, content);
  if (syntaxFail) {
    return {
      passed: false, ruleFindings: [{ rule: 'syntax', detail: syntaxFail }],
      testResult: { ran: false, passed: false, reason: 'syntax_blocked' },
      reason: syntaxFail,
    };
  }

  if (!config.validateRunTests) {
    return {
      passed: true, ruleFindings: [],
      testResult: { ran: false, passed: true, reason: 'tests-disabled' },
    };
  }

  onProgress?.('• Cloning repo + running tests in sandbox…');
  let testResult;
  try {
    testResult = await withRepoSandbox(repo, config, async (sandboxDir) => {
      await applySynthesizedFile(sandboxDir, filePath, content);
      return runTestsInSandbox(sandboxDir, config);
    });
  } catch (err) {
    return {
      passed: false, ruleFindings: [],
      testResult: { ran: false, passed: false, reason: 'sandbox_error', output: err.message },
      reason: `sandbox error: ${err.message}`,
    };
  }

  if (testResult.ran && !testResult.passed) {
    return {
      passed: false, ruleFindings: [], testResult,
      reason: `tests failed (${testResult.reason || 'non-zero exit'})`,
    };
  }

  return { passed: true, ruleFindings: [], testResult };
}
