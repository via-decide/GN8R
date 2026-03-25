/**
 * command-router.js
 *
 * Unified command router:
 *  - /task  → generates a real file for the user (Antigravity/Gemini)
 *  - /improve, /repos, /analyze, /branches, /cleanup → GitHub orchestration (Simba)
 *  - /catalog, /generate, /queue, /loop, /registry, /gaps → Engine-tools management
 *  - /status, /history, /logs, /cancel, /resume, /help, /start → Standard ops
 */

import crypto from 'node:crypto';
import { parseTaskMessage, parseUserTask, sanitizeTelegram, truncateForTelegram } from './task-parser.js';
import { runUserPipeline, runGitHubPipeline, STAGES } from './execution-pipeline.js';
import { TaskStatus } from './state-engine.js';
import { formatFileCaption } from './file-exporter.js';
import { listOwnerRepos, inspectRepository, listRepoBranches, deleteBranch } from './github.js';
import { generateTasks, generateNextTask, getCatalogSummary, formatTaskListForTelegram, formatTaskForTelegram, TOOL_CATALOG, discoverMissingTools, fetchAllRegisteredTools, formatRegistryReport, formatMissingToolsReport } from './task-generator.js';
import { startLoop, stopLoop, getLoopStatus } from './task-loop.js';

function nowIso() { return new Date().toISOString(); }
function isValidRepo(v) { return /^[^/\s]+\/[^/\s]+$/.test(v); }
function parseRepoArg(text) { const [, ...r] = text.trim().split(/\s+/); return r[0] || ''; }

function errMsg(title, cause, retryPossible, nextAction) {
  return [`❌ ${title}`, `Cause: ${cause}`, `Retry: ${retryPossible ? 'yes' : 'no'}`, `Next: ${nextAction}`].join('\n');
}

function formatStatus(task) {
  if (!task) return 'No active task. Use /task or /improve.';
  const lines = [
    `Task: ${(task.taskId || '?').slice(0, 8)}`,
    `Repo: ${task.repo || task.description?.slice(0, 40) || '?'}`,
    `Stage: ${task.currentStage || '?'}`,
    `Status: ${task.status || '?'}`,
  ];
  if (task.result?.prUrl) lines.push(`PR: ${task.result.prUrl}`);
  if (task.errorDetails) lines.push(`Error: ${task.errorDetails.likelyCause}`);
  lines.push(`Updated: ${task.timestamps?.updatedAt || 'n/a'}`);
  return lines.join('\n');
}

function formatHistory(tasks) {
  if (!tasks.length) return 'No task history yet.';
  return tasks.map((t, i) => {
    const id    = (t.taskId || '?').slice(0, 8);
    const status = t.status || '?';
    const label  = t.repo || t.description?.slice(0, 40) || '?';
    const time   = t.timestamps?.startedAt?.slice(0, 16) || '?';
    return `${i + 1}. [${status}] ${label} (${id}) — ${time}`;
  }).join('\n');
}

const HELP_TEXT = `⚡ *Decide Engine Bot — Antigravity Edition*

*File generation (for everyone):*
/task <description> — generate a real file
  Examples:
  \`/task create a landing page for a SaaS called FlowTrack\`
  \`/task generate a markdown resume template\`
  \`/task write a Python CSV parser script\`

*GitHub orchestration:*
/repos — list owner repositories
/analyze <owner/repo> — inspect repo metadata
/improve <owner/repo> — full pipeline with preview card
/task repo: owner/repo\\nmode: codex\\ntask: what to do

*Operations:*
/status — active task status
/history — recent task history
/logs [n] — last n log entries
/cancel — cancel running task
/resume — re-run last failed task
/branches <owner/repo> — list simba/* branches
/cleanup <owner/repo> — delete stale simba/* branches

*Engine-tools integration:*
/registry — scan live decide.engine-tools
/gaps [category] — show missing tools
/catalog — show tool catalog
/generate [category] — generate task list
/queue — show task queue
/queue clear — reset queue
/loop start [dry|live] — continuous execution
/loop stop — stop loop
/loop status — loop state`;

export class CommandRouter {
  constructor({ config, stateEngine, telegram }) {
    this.config = config;
    this.stateEngine = stateEngine;
    this.tg = telegram;
  }

  _isAdmin(chatId) {
    if (!this.config.enforceAdminOnly) return true;
    if (!this.config.adminChatIds?.length) return true;
    return this.config.adminChatIds.includes(String(chatId));
  }

  async handleMessage({ chatId, text, userId }) {
    const trimmed = sanitizeTelegram(text || '').trim();
    const uid = userId || chatId;

    if (this.config.enforceAdminOnly && !this._isAdmin(chatId)) {
      await this.tg.sendMessage(chatId, '🔒 Access restricted. Your chat ID is not in the admin list.');
      return;
    }

    try {
      if (trimmed.startsWith('/start') || trimmed.startsWith('/help')) {
        await this.tg.sendMessage(chatId, HELP_TEXT); return;
      }

      if (trimmed.startsWith('/repos')) {
        const repos = await listOwnerRepos(this.config);
        const out = repos.slice(0, 20).map(r => `- ${r.fullName} (${r.language})`).join('\n');
        await this.tg.sendMessage(chatId, `Repos:\n${out}`); return;
      }

      if (trimmed.startsWith('/analyze')) {
        const repo = parseRepoArg(trimmed);
        if (!repo || !isValidRepo(repo)) { await this.tg.sendMessage(chatId, errMsg('Analyze failed', 'Invalid repo.', true, '/analyze owner/repo')); return; }
        await this.tg.sendMessage(chatId, `🔎 Inspecting ${repo}...`);
        const audit = await inspectRepository(repo, this.config);
        await this.tg.sendMessage(chatId, `✅ ${repo}\nBranch: ${audit.defaultBranch}\nLang: ${audit.language}\nSource: ${audit.auditSource}\nREADME: ${audit.readmeSnippet !== 'not found' ? 'found' : 'missing'}`);
        return;
      }

      if (trimmed.startsWith('/improve')) {
        const repo = parseRepoArg(trimmed);
        if (!repo || !isValidRepo(repo)) { await this.tg.sendMessage(chatId, errMsg('Improve failed', 'Invalid repo.', true, '/improve owner/repo')); return; }
        const taskId = crypto.randomUUID();
        const preview = { taskId, repo, action: 'improve', requestedAt: nowIso() };
        await this.stateEngine.setPendingPreview(chatId, preview);
        await this.tg.sendPreviewCard(chatId, {
          text: [`🧪 Simba Task Preview`, `Repo: ${repo}`, `Stages: ${STAGES.join(' → ')}`, `Push: ${this.config.allowLivePush ? 'enabled' : 'disabled'}`, `PR: ${this.config.allowLivePr ? 'enabled' : 'disabled'}`].join('\n'),
          buttons: [
            [{ text: '▶ Run dry-run', callback_data: `run:${taskId}:dry` }],
            [{ text: '🚀 Run live',   callback_data: `run:${taskId}:live` }],
            [{ text: '✕ Cancel',      callback_data: `cancel:${taskId}` }],
          ],
        });
        return;
      }

      if (trimmed.startsWith('/task')) {
        const body = trimmed.slice('/task'.length).trim();

        // ── User file generation (no repo field) ──
        if (!body.includes('repo:') && !body.startsWith('{')) {
          const parsed = parseUserTask(trimmed);
          if (!parsed) { await this.tg.sendMessage(chatId, 'Please describe your task:\n\n`/task create a markdown resume template`'); return; }
          if (parsed.error) { await this.tg.sendMessage(chatId, `❌ ${parsed.error}`); return; }

          const active = await this.stateEngine.getActiveTask(chatId);
          if (active) { await this.tg.sendMessage(chatId, `⚠ Task already running. /cancel to stop it.`); return; }

          const taskId = crypto.randomUUID();
          await this.stateEngine.setTaskState(chatId, taskId, {
            taskId, description: parsed.description, status: TaskStatus.PENDING,
            timestamps: { startedAt: nowIso(), updatedAt: nowIso() },
          });

          await this.tg.sendMessage(chatId, `🚀 *Task received*\n\n_${parsed.description.slice(0, 100)}_\n\nRunning pipeline...`);

          const result = await runUserPipeline(
            { id: taskId, userId: chatId, description: parsed.description },
            this.config, this.stateEngine,
            async (msg) => { await this.tg.sendMessage(chatId, msg); }
          );

          if (!result.success) {
            await this.tg.sendMessage(chatId, `❌ *Task failed*\n\n${result.error}\n\nPlease try again.`);
            return;
          }

          for (const artifact of result.artifacts) {
            const caption = formatFileCaption(result.plan, artifact);
            try {
              await this.tg.sendDocument(chatId, artifact.filepath, artifact.filename, caption);
            } catch {
              const preview = artifact.content.slice(0, 3000);
              await this.tg.sendMessage(chatId, `✅ *${artifact.filename}*\n\`\`\`\n${preview}\n\`\`\``);
            }
          }
          await this.tg.sendMessage(chatId, `✅ Done! Need something else? /task`);
          return;
        }

        // ── GitHub orchestration (has repo: field) ──
        if (!body) { await this.tg.sendMessage(chatId, 'Usage:\n/task\nrepo: owner/repo\nmode: codex_then_antigravity\ntask: what to do'); return; }
        await this.tg.sendMessage(chatId, '⏳ Running task...');
        let parsed;
        try { parsed = parseTaskMessage(body); }
        catch (parseErr) { await this.tg.sendMessage(chatId, errMsg('Task parse failed', parseErr.message, true, 'Check formatting.')); return; }

        const taskId = crypto.randomUUID();
        try {
          const task = await runGitHubPipeline({
            taskId, chatId, repo: parsed.targetRepo,
            taskDescription: parsed.taskDescription,
            constraints: parsed.constraints, goal: parsed.goal,
            mode: parsed.mode, dryRun: false,
            config: this.config, stateEngine: this.stateEngine,
            onStageUpdate: async ({ stage, details }) => { await this.tg.sendMessage(chatId, `[${stage}] ${truncateForTelegram(details)}`); },
          });
          await this._sendTaskResult(chatId, task);
        } catch (err) {
          await this.tg.sendMessage(chatId, errMsg('Task failed', err.message, true, '/resume'));
        }
        return;
      }

      if (trimmed.startsWith('/status')) {
        const task = await this.stateEngine.getActiveTask(chatId);
        await this.tg.sendMessage(chatId, formatStatus(task)); return;
      }

      if (trimmed.startsWith('/history')) {
        const tasks = await this.stateEngine.getTaskHistory(chatId, 10);
        await this.tg.sendMessage(chatId, `📋 Recent tasks:\n${formatHistory(tasks)}`); return;
      }

      if (trimmed.startsWith('/logs')) {
        const count = Number(trimmed.split(/\s+/)[1]) || 20;
        const logs = await this.stateEngine.getLogs(chatId, count);
        if (!logs.length) { await this.tg.sendMessage(chatId, 'No logs yet.'); return; }
        const out = logs.map(l => `[${l.ts?.slice(11, 19) || '?'}] ${l.stage || '?'}: ${l.details || ''}`).join('\n');
        await this.tg.sendMessage(chatId, `📝 Logs (${logs.length}):\n${out}`); return;
      }

      if (trimmed.startsWith('/cancel')) {
        const cancelled = await this.stateEngine.cancelActiveTask(chatId);
        await this.tg.sendMessage(chatId, cancelled ? `Cancelled task ${cancelled.slice(0, 8)}.` : 'No active task to cancel.'); return;
      }

      if (trimmed.startsWith('/branches')) {
        const repo = parseRepoArg(trimmed);
        if (!repo || !isValidRepo(repo)) { await this.tg.sendMessage(chatId, errMsg('Branches', 'Invalid repo.', true, '/branches owner/repo')); return; }
        const [owner, repoName] = repo.split('/');
        const branches = await listRepoBranches(owner, repoName, this.config, 'simba/');
        await this.tg.sendMessage(chatId, branches.length ? `Branches on ${repo}:\n${branches.map(b => `- ${b}`).join('\n')}` : `No simba/* branches on ${repo}.`); return;
      }

      if (trimmed.startsWith('/cleanup')) {
        const repo = parseRepoArg(trimmed);
        if (!repo || !isValidRepo(repo)) { await this.tg.sendMessage(chatId, errMsg('Cleanup', 'Invalid repo.', true, '/cleanup owner/repo')); return; }
        const [owner, repoName] = repo.split('/');
        const branches = await listRepoBranches(owner, repoName, this.config, 'simba/');
        if (!branches.length) { await this.tg.sendMessage(chatId, `No simba/* branches to clean.`); return; }
        await this.tg.sendMessage(chatId, `🧹 Deleting ${branches.length} branches...`);
        let deleted = 0;
        for (const b of branches) { try { await deleteBranch(owner, repoName, b, this.config); deleted++; } catch {} }
        await this.tg.sendMessage(chatId, `Deleted ${deleted}/${branches.length} branches.`); return;
      }

      if (trimmed.startsWith('/resume')) {
        const task = await this.stateEngine.getActiveTask(chatId);
        if (!task) { await this.tg.sendMessage(chatId, 'No task to resume.'); return; }
        if (!task.repo) { await this.tg.sendMessage(chatId, 'Cannot resume a user file task. Use /task again.'); return; }
        const taskId = crypto.randomUUID();
        await this.tg.sendMessage(chatId, `🔄 Resuming pipeline for ${task.repo}...`);
        const result = await runGitHubPipeline({
          taskId, chatId, repo: task.repo,
          taskDescription: task.taskDescription || `Improve ${task.repo}`,
          constraints: task.constraints || '', goal: task.goal || '',
          mode: task.mode || 'codex_then_antigravity', dryRun: task.mode === 'dry-run',
          config: this.config, stateEngine: this.stateEngine,
          onStageUpdate: async ({ stage, details }) => { await this.tg.sendMessage(chatId, `[${stage}] ${details}`); },
        });
        await this._sendTaskResult(chatId, result); return;
      }

      if (trimmed.startsWith('/catalog')) {
        const summary = getCatalogSummary();
        const lines = Object.entries(summary).map(([cat, info]) => `${cat} (${info.total}): ${info.tools.join(', ')}`);
        await this.tg.sendMessage(chatId, `📦 Tool Catalog:\n${lines.join('\n')}`); return;
      }

      if (trimmed.startsWith('/generate')) {
        const arg = trimmed.slice('/generate'.length).trim();
        const categories = arg ? arg.split(/[\s,]+/).filter(Boolean) : null;
        await this.tg.sendMessage(chatId, '🔍 Generating tasks...');
        const queue = await this.stateEngine.getTaskQueue(chatId);
        const excludeIds = new Set([...queue.completed, ...queue.pending].map(t => t.toolId).filter(Boolean));
        const tasks = await generateTasks(this.config, { categories, maxTasks: 20, excludeIds });
        if (tasks.length) {
          for (const t of tasks) await this.stateEngine.addToQueue(chatId, { toolId: t.metadata?.toolId, ...t });
        }
        await this.tg.sendMessage(chatId, `📋 Generated ${tasks.length} tasks:\n${formatTaskListForTelegram(tasks)}`);
        if (tasks.length) await this.tg.sendMessage(chatId, 'Use /loop start dry to execute, or /loop start live for real PRs.');
        return;
      }

      if (trimmed.startsWith('/queue')) {
        const arg = trimmed.slice('/queue'.length).trim();
        if (arg === 'clear') { await this.stateEngine.clearTaskQueue(chatId); await this.tg.sendMessage(chatId, 'Task queue cleared.'); return; }
        const q = await this.stateEngine.getTaskQueue(chatId);
        const lines = [`📊 Task Queue`, `Pending: ${q.pending.length}`, `Completed: ${q.completed.length}`, `Failed: ${q.failed.length}`];
        if (q.completed.length) { lines.push('\n✅ Completed (last 10):'); q.completed.slice(-10).forEach(t => lines.push(`  ${t.toolId || t.taskId?.slice(0, 8)}${t.prUrl ? ` → ${t.prUrl}` : ''}`)); }
        if (q.failed.length) { lines.push('\n❌ Failed:'); q.failed.slice(-5).forEach(t => lines.push(`  ${t.toolId || '?'}: ${t.error || 'unknown'}`)); }
        if (q.pending.length) { lines.push('\n⏳ Pending:'); q.pending.slice(-10).forEach(t => lines.push(`  ${t.toolId || '?'} [${t.metadata?.category || '?'}]`)); }
        await this.tg.sendMessage(chatId, lines.join('\n')); return;
      }

      if (trimmed.startsWith('/loop')) {
        const args = trimmed.slice('/loop'.length).trim().split(/\s+/);
        const sub = args[0] || '';
        if (sub === 'stop') { const stopped = stopLoop(chatId); await this.tg.sendMessage(chatId, stopped ? '⏹ Loop will stop after current task.' : 'No loop running.'); return; }
        if (sub === 'status') {
          const status = getLoopStatus(chatId);
          if (!status) { await this.tg.sendMessage(chatId, 'No loop active.'); return; }
          await this.tg.sendMessage(chatId, [`🔄 Loop Status`, `Running: ${status.running}`, `Completed: ${status.tasksCompleted}`, `Failed: ${status.tasksFailed}`, `Mode: ${status.dryRun ? 'dry-run' : 'live'}`, `Started: ${status.startedAt}`].join('\n')); return;
        }
        if (sub === 'start') {
          const mode = args[1] || 'dry';
          const dryRun = mode !== 'live';
          const categories = args[2] ? args[2].split(',') : null;
          startLoop({ chatId, config: this.config, stateEngine: this.stateEngine, messenger: { sendMessage: (id, t) => this.tg.sendMessage(id, t) }, dryRun, delayMs: 10_000, maxTasks: 50, categories })
            .catch(async err => { await this.tg.sendMessage(chatId, errMsg('Loop crashed', err.message, true, '/loop start')); });
          return;
        }
        await this.tg.sendMessage(chatId, 'Usage: /loop start [dry|live] [category] | /loop stop | /loop status'); return;
      }

      if (trimmed.startsWith('/registry')) {
        await this.tg.sendMessage(chatId, '🔍 Scanning live decide.engine-tools registry...');
        try {
          const tools = await fetchAllRegisteredTools(this.config);
          await this.tg.sendMessage(chatId, truncateForTelegram(formatRegistryReport(tools)));
        } catch (err) { await this.tg.sendMessage(chatId, errMsg('Registry scan failed', err.message, true, 'Check GITHUB_TOKEN.')); }
        return;
      }

      if (trimmed.startsWith('/gaps')) {
        const arg = trimmed.slice('/gaps'.length).trim();
        const categories = arg ? arg.split(/[\s,]+/).filter(Boolean) : null;
        const catalogToCheck = categories ? Object.fromEntries(Object.entries(TOOL_CATALOG).filter(([cat]) => categories.includes(cat))) : TOOL_CATALOG;
        await this.tg.sendMessage(chatId, '🔍 Checking for missing tools...');
        try {
          const missing = await discoverMissingTools(catalogToCheck, this.config);
          await this.tg.sendMessage(chatId, truncateForTelegram(formatMissingToolsReport(missing)));
        } catch (err) { await this.tg.sendMessage(chatId, errMsg('Gaps check failed', err.message, true, 'Check GITHUB_TOKEN.')); }
        return;
      }

      await this.tg.sendMessage(chatId, 'Unknown command. /help for options.');
    } catch (err) {
      console.error(`[Router] Error for ${chatId}:`, err.message);
      await this.tg.sendMessage(chatId, errMsg('Command failed', err.message, true, 'Retry or /status.'));
    }
  }

  async handleCallback({ chatId, callbackQueryId, data }) {
    try {
      if (!data.startsWith('run:') && !data.startsWith('cancel:')) return;
      const chat = await this.stateEngine.getChatState(chatId);
      const pending = chat.pendingPreview;
      if (!pending) { await this.tg.sendMessage(chatId, 'Preview expired. Run /improve again.'); return; }

      const parts = data.split(':');
      const command = parts[0];
      const taskId  = parts[1];
      if (taskId !== pending.taskId) { await this.tg.sendMessage(chatId, 'Task mismatch. Run /improve again.'); return; }

      if (command === 'cancel') {
        await this.stateEngine.clearPendingPreview(chatId);
        await this.tg.sendMessage(chatId, 'Cancelled.'); return;
      }

      if (command === 'run') {
        const dryRun = parts[2] !== 'live';
        await this.stateEngine.clearPendingPreview(chatId);
        await this.tg.sendMessage(chatId, `🚀 Starting ${dryRun ? 'dry-run' : 'live'} pipeline for ${pending.repo}...`);
        const task = await runGitHubPipeline({
          taskId, chatId, repo: pending.repo,
          taskDescription: `Improve repository ${pending.repo}`,
          constraints: 'Preserve existing code; prefer additive changes.',
          goal: `Improve ${pending.repo} via bot pipeline`,
          mode: 'codex_then_antigravity', dryRun,
          config: this.config, stateEngine: this.stateEngine,
          onStageUpdate: async ({ stage, details }) => { await this.tg.sendMessage(chatId, `[${stage}] ${details}`); },
        });
        await this._sendTaskResult(chatId, task);
      }
    } catch (err) {
      console.error(`[Router] Callback error ${chatId}:`, err.message);
      await this.tg.sendMessage(chatId, errMsg('Callback failed', err.message, true, '/improve again.'));
    }
  }

  async _sendTaskResult(chatId, task) {
    if (!task) { await this.tg.sendMessage(chatId, 'No task result.'); return; }
    if (task.status === 'success') {
      const lines = [`✅ Pipeline complete`, `Repo: ${task.repo}`, `Mode: ${task.mode}`, `Push: ${task.result?.push || 'n/a'}`, `PR: ${task.result?.prCreation || 'n/a'}`];
      if (task.result?.prUrl) lines.push(`🔗 ${task.result.prUrl}`);
      if (task.result?.prPackage?.branch) lines.push(`Branch: ${task.result.prPackage.branch}`);
      await this.tg.sendMessage(chatId, lines.join('\n'));
    } else {
      await this.tg.sendMessage(chatId, errMsg('Pipeline failed', task.errorDetails?.likelyCause || 'Unknown', task.errorDetails?.retryPossible ?? true, task.errorDetails?.nextAction || '/resume'));
    }
  }
}
