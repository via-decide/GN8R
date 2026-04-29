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
import { listOwnerRepos, inspectRepository, listRepoBranches, deleteBranch, mergePullRequest } from './git.js';
import { generateTasks, generateNextTask, getCatalogSummary, formatTaskListForTelegram, formatTaskForTelegram, TOOL_CATALOG, discoverMissingTools, fetchAllRegisteredTools, formatRegistryReport, formatMissingToolsReport } from './task-generator.js';
import { startLoop, stopLoop, getLoopStatus } from './task-loop.js';
import { MemoryManager } from './memory.js';
import { SkillsManager } from './skills.js';
import { EngineIntegrationManager } from './engine-integration.js';

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

const HELP_TEXT = `⚡ *GN8R — Antigravity Edition*

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
/loop status — loop state

*Engine World State:*
/auth <email> — link to Orchard account
/wallet — check Orchard balance/credits
/market — view global engine dynamics
/scaffold <name>: <prompt> — build tool spec
*Compliance:*
🛡️ All orchestration follows **SOP.md**.
⚠️ Repo tasks require the \`repo:\` field.`;

export class CommandRouter {
  constructor({ config, stateEngine, telegram }) {
    this.config = config;
    this.stateEngine = stateEngine;
    this.tg = telegram;
    this.memory = new MemoryManager(stateEngine);
    this.skills = new SkillsManager(stateEngine);
    this.engine = new EngineIntegrationManager(stateEngine);
  }

  _isAdmin(chatId) {
    if (!this.config.enforceAdminOnly) return true;
    if (!this.config.adminChatIds?.length) return true;
    return this.config.adminChatIds.includes(String(chatId));
  }

  async handleMessage(interaction) {
    const { chatId, userId, text } = interaction;
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

        // ── 1. Normal Task (User file generation) ──
        const isRepoTask = /(?:^|\n)\s*repo\s*:/i.test(body) || body.startsWith('{');
        if (!isRepoTask) {
          const parsed = parseUserTask(trimmed);
          if (!parsed && !interaction.photo && !interaction.voice) { await this.tg.sendMessage(chatId, 'Please describe your task or send a voice/photo:\n\n`/task create a resume`'); return; }
          
          const description = (parsed?.description || interaction.text || 'Process multi-modal input').trim();

          const active = await this.stateEngine.getActiveTask(chatId);
          if (active) { await this.tg.sendMessage(chatId, `⚠ Task already running. /cancel to stop it.`); return; }

          console.log(`[Router] Triggering NORMAL task pipeline (Beast-Mode) for ${chatId}`);
          const taskId = crypto.randomUUID();
          await this.stateEngine.setTaskState(chatId, taskId, {
            taskId, description, status: TaskStatus.PENDING,
            timestamps: { startedAt: nowIso(), updatedAt: nowIso() },
          });

          await this.tg.sendMessage(chatId, `🚀 *Synthesis Orchestrator Active*\n\n_${description.slice(0, 100)}_\n\nAnalyzing sensors...`);

          const result = await runUserPipeline(
            { id: taskId, userId: chatId, description, photo: interaction.photo, voice: interaction.voice, audio: interaction.audio },
            this.config, this.stateEngine, this.memory,
            async (msg) => { await this.tg.sendMessage(chatId, msg); }
          );

          if (!result.success) {
            await this.tg.sendMessage(chatId, `❌ *Synthesis failed*\n\n${result.error}\n\nPlease try again.`);
            return;
          }

          for (const artifact of result.artifacts) {
            const caption = formatFileCaption(result.plan, artifact, result.metrics);
            try {
              await this.tg.sendDocument(chatId, artifact.filepath, artifact.filename, caption, {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '✅ Merge', callback_data: `commander:merge:${taskId}` }, { text: '🔄 Tweak', callback_data: `commander:tweak:${taskId}` }],
                    [{ text: '✕ Close', callback_data: `commander:close:${taskId}` }]
                  ]
                }
              });
            } catch {
              const preview = artifact.content.slice(0, 3000);
              await this.tg.sendMessage(chatId, `✅ *${artifact.filename}*\n\`\`\`\n${preview}\n\`\`\``);
            }
          }
          return;
        }

        // ── 2. Repo Task (GitHub orchestration) ──
        if (!body) { await this.tg.sendMessage(chatId, 'Usage:\n/task\nrepo: owner/repo\ntask: what to do'); return; }
        
        console.log(`[Router] Triggering REPO task pipeline (Beast-Mode) for ${chatId}`);
        await this.tg.sendMessage(chatId, '⏳ activating orchestration sensors...');
        let parsed;
        try { parsed = parseTaskMessage(body); }
        catch (parseErr) { await this.tg.sendMessage(chatId, errMsg('Task parse failed', parseErr.message, true, 'Check formatting.')); return; }

        const taskId = crypto.randomUUID();
        try {
          const task = await runGitHubPipeline({
            taskId, chatId, repo: parsed.targetRepo,
            taskDescription: parsed.taskDescription,
            constraints: parsed.constraints, goal: parsed.goal,
            createPath: parsed.create,
            purpose: parsed.purpose,
            features: parsed.features,
            mode: parsed.mode, dryRun: false,
            config: this.config, stateEngine: this.stateEngine,
            photo: interaction.photo, voice: interaction.voice, audio: interaction.audio,
            onStageUpdate: async ({ stage, details }) => { await this.tg.sendMessage(chatId, `[${stage}] ${truncateForTelegram(details)}`); },
          });
          await this._sendTaskResult(chatId, task);
        } catch (err) {
          await this.tg.sendMessage(chatId, errMsg('Task failed', err.message, true, '/resume'));
        }
        return;
      }

      if (trimmed.startsWith('/remember')) {
        const body = trimmed.slice('/remember'.length).trim();
        if (!body) { await this.tg.sendMessage(chatId, 'Usage: `/remember key: value` or `/remember some fact`'); return; }
        const { key, value } = this.memory.extractKey(body);
        await this.memory.set(chatId, key, value);
        await this.tg.sendMessage(chatId, `📌 Remembered: *${key}* → ${value}`);
        return;
      }

      if (trimmed.startsWith('/recall')) {
        const key = trimmed.slice('/recall'.length).trim();
        if (key) {
          const fact = await this.memory.get(chatId, key);
          if (fact) await this.tg.sendMessage(chatId, `📌 *${key}*: ${fact.value}`);
          else await this.tg.sendMessage(chatId, `❌ Key "${key}" not found in memory.`);
        } else {
          const out = await this.memory.format(chatId);
          await this.tg.sendMessage(chatId, out);
        }
        return;
      }

      if (trimmed.startsWith('/forget')) {
        const key = trimmed.slice('/forget'.length).trim().toLowerCase();
        if (!key) { await this.tg.sendMessage(chatId, 'Usage: `/forget <key>` or `/forget all`'); return; }
        if (key === 'all') {
          await this.memory.delete(chatId, 'all');
          await this.tg.sendMessage(chatId, '🧠 Memory cleared.');
        } else {
          await this.memory.delete(chatId, key);
          await this.tg.sendMessage(chatId, `🗑️ Forgot: *${key}*`);
        }
        return;
      }

      if (trimmed.startsWith('/skill')) {
        const args = trimmed.slice('/skill'.length).trim().split(/\s+/);
        const sub = args[0] || 'help';

        if (sub === 'define') {
          const content = trimmed.slice(trimmed.indexOf('define') + 6).trim();
          const colonIdx = content.indexOf(':');
          if (colonIdx === -1) { await this.tg.sendMessage(chatId, 'Usage: `/skill define <name>: <prompt template>`'); return; }
          const name = content.slice(0, colonIdx).trim();
          const template = content.slice(colonIdx + 1).trim();
          const slug = await this.skills.define(chatId, name, { promptTemplate: template });
          await this.tg.sendMessage(chatId, `✅ Skill defined: \`${slug}\``);
        } else if (sub === 'list') {
          const out = await this.skills.format(chatId);
          await this.tg.sendMessage(chatId, out);
        } else if (sub === 'run') {
          const name = args[1];
          if (!name) { await this.tg.sendMessage(chatId, 'Usage: `/skill run <name> [input]`'); return; }
          const input = args.slice(2).join(' ');
          try {
            const invoked = await this.skills.invoke(chatId, name, input);
            await this.tg.sendMessage(chatId, `🚀 *Running skill:* \`${name}\`...`);
            const taskId = crypto.randomUUID();
            await runUserPipeline(
              { id: taskId, userId: chatId, description: invoked.description },
              this.config, this.stateEngine, this.memory,
              async (msg) => { await this.tg.sendMessage(chatId, msg); }
            ).then(async result => {
              if (result.success) {
                for (const artifact of result.artifacts) {
                  const caption = formatFileCaption(result.plan, artifact);
                  await this.tg.sendDocument(chatId, artifact.filepath, artifact.filename, caption).catch(async () => {
                    await this.tg.sendMessage(chatId, `✅ *${artifact.filename}*\n\`\`\`\n${artifact.content.slice(0, 3000)}\n\`\`\``);
                  });
                }
              } else {
                await this.tg.sendMessage(chatId, `❌ *Skill failed*\n\n${result.error}`);
              }
            });
          } catch (err) {
            await this.tg.sendMessage(chatId, `❌ Error: ${err.message}`);
          }
        } else if (sub === 'delete') {
          const name = args[1];
          if (!name) { await this.tg.sendMessage(chatId, 'Usage: `/skill delete <name>`'); return; }
          try {
            await this.skills.remove(chatId, name);
            await this.tg.sendMessage(chatId, `🗑️ Skill deleted: \`${name}\``);
          } catch (err) { await this.tg.sendMessage(chatId, `❌ ${err.message}`); }
        } else {
          const help = [
            '🛠️ *Skills Usage*',
            '`/skill define <name>: <prompt>` — Save a new workflow',
            '`/skill list` — Show all skills',
            '`/skill run <name> [input]` — Execute a skill',
            '`/skill delete <name>` — Remove a skill',
            '',
            'Use `{{input}}` in your prompt template to inject runtime text.'
          ].join('\n');
          await this.tg.sendMessage(chatId, help);
        }
        return;
      }

      if (trimmed.startsWith('/auth')) {
        const email = trimmed.slice('/auth'.length).trim();
        if (!email || !email.includes('@')) { await this.tg.sendMessage(chatId, 'Usage: `/auth your@email.com`'); return; }
        await this.engine.linkAuth(chatId, email);
        await this.tg.sendMessage(chatId, `📧 *Auth Linked*\n\nYour Telegram is now bridged to: ${email}\nUse /wallet to check your state.`);
        return;
      }

      if (trimmed.startsWith('/wallet')) {
        const wallet = await this.engine.getWallet(chatId);
        await this.tg.sendMessage(chatId, this.engine.formatWalletReport(wallet));
        return;
      }

      if (trimmed.startsWith('/market')) {
        const status = this.engine.getMarketStatus();
        await this.tg.sendMessage(chatId, this.engine.formatMarketReport(status));
        return;
      }

      if (trimmed.startsWith('/scaffold')) {
        const content = trimmed.slice('/scaffold'.length).trim();
        const colonIdx = content.indexOf(':');
        if (colonIdx === -1) { await this.tg.sendMessage(chatId, 'Usage: `/scaffold MyTool: description of what it does`'); return; }
        const name = content.slice(0, colonIdx).trim();
        const prompt = content.slice(colonIdx + 1).trim();
        
        await this.tg.sendMessage(chatId, `🛠️ *Scaffolding tool:* ${name}...`);
        const result = await this.engine.buildScaffold(name, prompt);
        
        const out = [
          `✅ *Scaffold Complete*`,
          `ID: \`${result.spec.id}\``,
          `Dir: \`${result.payload.toolDir}\``,
          '',
          `*Config Code:*`,
          `\`\`\`json\n${JSON.stringify(result.spec, null, 2)}\n\`\`\``,
          '',
          `*Starter HTML:*`,
          `\`\`\`html\n${result.template}\n\`\`\``
        ].join('\n');
        
        await this.tg.sendMessage(chatId, truncateForTelegram(out));
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
        } catch (err) { await this.tg.sendMessage(chatId, errMsg('Registry scan failed', err.message, true, 'Check GIT_PROVIDER and credentials (GITHUB_TOKEN or GITEA_TOKEN).')); }
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
        } catch (err) { await this.tg.sendMessage(chatId, errMsg('Gaps check failed', err.message, true, 'Check GIT_PROVIDER and credentials (GITHUB_TOKEN or GITEA_TOKEN).')); }
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
      if (data.startsWith('commander:')) {
        return await this._handleCommanderCallback({ chatId, data });
      }
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

  async _handleCommanderCallback({ chatId, data }) {
    const parts = data.split(':');
    const action = parts[1];
    const taskId = parts[2];
    
    if (!taskId) return;
    const task = await this.stateEngine.getTask(chatId, taskId);
    if (!task) { await this.tg.sendMessage(chatId, 'Task not found.'); return; }

    if (action === 'close') {
      await this.tg.sendMessage(chatId, `✕ Closed task: ${taskId.slice(0, 8)}`);
      return;
    }

    if (action === 'merge') {
      if (task.status === 'merged' || task.result?.mergeResult === 'auto-merged') {
        await this.tg.sendMessage(chatId, `✓ PR #${task.result?.prNumber} already merged.`);
        return;
      }
      if (!task.result?.prNumber || !task.repo) {
        await this.tg.sendMessage(chatId, '❌ No PR available for this task.');
        return;
      }
      const [owner, repoName] = task.repo.split('/');
      await this.tg.sendMessage(chatId, `⌛ Merging PR #${task.result.prNumber} in ${task.repo}...`);
      try {
        await mergePullRequest(owner, repoName, task.result.prNumber, this.config);
        await this.tg.sendMessage(chatId, `✅ PR #${task.result.prNumber} merged successfully!`);
        // Optional: cleanup branch
        if (task.result.prPackage?.branch) {
          await deleteBranch(owner, repoName, task.result.prPackage.branch, this.config).catch(() => {});
        }
      } catch (err) {
        await this.tg.sendMessage(chatId, `❌ Merge failed: ${err.message}`);
      }
      return;
    }

    if (action === 'tweak') {
      await this.tg.sendMessage(chatId, '🔄 Tweak mode: Reply with your adjustments.');
      return;
    }
  }

  async _sendTaskResult(chatId, task) {
    if (!task) { await this.tg.sendMessage(chatId, 'No task result.'); return; }
    if (task.status === 'success') {
      const lines = [`✅ Pipeline complete (Beast-Mode)`];
      if (task.repo) lines.push(`Repo: ${task.repo}`);
      if (task.mode && task.repo) lines.push(`Mode: ${task.mode}`);
      if (task.result?.metrics) {
        lines.push(`⚡ Efficiency: ${task.result.metrics.tokenEfficiency} | Confidence: ${task.result.metrics.confidence}`);
        lines.push(`⏱ Duration: ${task.result.metrics.duration}`);
      }
      if (task.result?.push && task.result.push !== 'n/a' && task.result.push !== 'skipped') lines.push(`Push: ${task.result.push}`);
      if (task.result?.prCreation && task.result.prCreation !== 'n/a' && task.result.prCreation !== 'skipped') lines.push(`PR: ${task.result.prCreation}`);
      if (task.result?.prUrl) lines.push(`🔗 ${task.result.prUrl}`);
      if (task.result?.prPackage?.branch) lines.push(`Branch: ${task.result.prPackage.branch}`);
      
      const buttons = [
        [{ text: '✅ Merge', callback_data: `commander:merge:${task.taskId}` }, { text: '🔄 Tweak', callback_data: `commander:tweak:${task.taskId}` }],
        [{ text: '✕ Close', callback_data: `commander:close:${task.taskId}` }]
      ];
      
      await this.tg.sendPreviewCard(chatId, { text: lines.join('\n'), buttons });
    } else {
      await this.tg.sendMessage(chatId, errMsg('Pipeline failed', task.errorDetails?.likelyCause || 'Unknown', task.errorDetails?.retryPossible ?? true, task.errorDetails?.nextAction || '/resume'));
    }
  }
}

