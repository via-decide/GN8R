/**
 * execution-pipeline.js
 *
 * TWO pipelines in one:
 *
 * 1. runUserPipeline()   — generates a file for a regular user via Antigravity (Gemini)
 *    PLAN → AUDIT → GENERATE → BUILD → RETURN
 *
 * 2. runGitHubPipeline() — full Simba-style GitHub orchestration
 *    PLAN → AUDIT → GENERATE → ARTIFACTS → PUSH → PR → COMPLETE
 */

import path from 'node:path';
import { TaskStatus } from './state-engine.js';
import { buildEngineContext } from './engine-bridge.js';
import { detectOutputType, buildFilename } from './task-parser.js';
import { buildCodexPrompt, buildRepairPrompt, buildPrPackage, buildExecutionPacket, buildUserFilePrompt } from './templates.js';
import { writeArtifacts, writeUserArtifact } from './artifacts.js';
import { inspectRepository, getBranchSha, createBranch, commitFile, createPullRequest, deleteBranch } from './github.js';

export const STAGES = ['PLAN', 'AUDIT', 'GENERATE', 'ARTIFACTS', 'PUSH', 'PR', 'COMPLETE'];

const TELEGRAM_ASSISTANT_SYSTEM_PROMPT = 'You are a Telegram bot assistant. Always keep responses concise and under 800 characters when possible. Limit lists to 5 items.';
const TELEGRAM_ASSISTANT_SYSTEM_PROMPT = 'You are a Telegram bot assistant. Always keep responses under 800 characters and limit lists to 5 items.';

// ── Antigravity (Gemini) API helper ───────────────────────────

async function callAntigravity(systemPrompt, userPrompt, config) {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is not configured.');
  const model = config.geminiModel || 'gemini-2.5-pro-preview-05-06';
  const baseUrl = config.geminiApiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  const url = `${baseUrl}/models/${model}:generateContent?key=${config.geminiApiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: `${TELEGRAM_ASSISTANT_SYSTEM_PROMPT}\n\n${systemPrompt}` }],
      },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: config.geminiMaxTokens || 8192,
        temperature: 0.7,
      },
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Antigravity API ${res.status}: ${t}`); }
  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error('Antigravity returned no candidates.');
  return candidate.content?.parts?.map(p => p.text).join('') || '';
}

// ── 1. USER FILE GENERATION PIPELINE (Antigravity) ───────────

export async function runUserPipeline(task, config, stateEngine, onProgress) {
  const taskId = task.id || `task_${Date.now()}`;
  const chatId = task.userId;

  try {
    await stateEngine.setTaskState(chatId, taskId, {
      taskId, status: TaskStatus.PLANNING, currentStage: 'PLAN',
      timestamps: { startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });

    // PLAN
    onProgress?.('📋 Planning task...');
    const outputType = detectOutputType(task.description);
    const filename   = buildFilename(task.description, outputType);
    const engineCtx  = await buildEngineContext(config.engineBaseUrl);

    const planSystem = `You are a task planning engine. Respond ONLY with valid JSON.`;
    const planPrompt = `Engine context:\n${engineCtx}\n\nUser task: "${task.description}"\nOutput type: ${outputType}\n\nRespond:\n{"title":"...","outputType":"${outputType}","outputFilename":"${filename}","steps":["..."],"complexity":"low|medium|high"}`;
    let plan = { title: task.description.slice(0, 50), outputType, outputFilename: filename, steps: ['Generate content', 'Build artifact'], complexity: 'medium' };
    try {
      const raw = await callAntigravity(planSystem, planPrompt, config);
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      plan = { ...plan, ...JSON.parse(cleaned) };
    } catch {}

    await stateEngine.setTaskState(chatId, taskId, { status: TaskStatus.AUDITING, currentStage: 'AUDIT', plan });
    await stateEngine.appendLog(chatId, { taskId, stage: 'PLAN', details: `Plan: ${plan.title}` });

    // GENERATE
    onProgress?.(`⚙️ Generating ${outputType.toUpperCase()} file...`);
    await stateEngine.setTaskState(chatId, taskId, { status: TaskStatus.GENERATING, currentStage: 'GENERATE' });

    const content = await callAntigravity(buildUserFilePrompt(task.description, outputType), `Generate the complete ${outputType} file for: ${task.description}`, config);
    await stateEngine.appendLog(chatId, { taskId, stage: 'GENERATE', details: `Generated ${content.length} chars` });

    // BUILD
    onProgress?.('📦 Building artifact...');
    await stateEngine.setTaskState(chatId, taskId, { status: TaskStatus.BUILDING, currentStage: 'BUILD' });
    const outputDir = path.join(config.artifactsDir, 'user-files');
    const filepath  = await writeUserArtifact(outputDir, `${taskId}_${plan.outputFilename}`, content);

    const artifact = { filename: plan.outputFilename, content, filepath, size: Buffer.byteLength(content, 'utf8'), outputType };

    await stateEngine.setTaskState(chatId, taskId, {
      status: TaskStatus.DONE, currentStage: 'COMPLETE',
      result: { artifacts: [artifact], plan },
      timestamps: { completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });
    await stateEngine.appendLog(chatId, { taskId, stage: 'COMPLETE', details: 'Done' });

    return { success: true, plan, artifacts: [artifact] };
  } catch (err) {
    await stateEngine.setTaskState(chatId, taskId, {
      status: TaskStatus.FAILED, errorDetails: { likelyCause: err.message },
      timestamps: { updatedAt: new Date().toISOString() },
    });
    await stateEngine.appendLog(chatId, { taskId, stage: 'FAILED', details: err.message });
    return { success: false, error: err.message };
  }
}

// ── 2. GITHUB ORCHESTRATION PIPELINE (from Simba) ────────────

export async function runGitHubPipeline({ taskId, chatId, repo, taskDescription, constraints, goal, mode, dryRun, config, stateEngine, onStageUpdate }) {
  const startedAt = new Date().toISOString();
  await stateEngine.setTaskState(chatId, taskId, {
    taskId, repo, mode: dryRun ? 'dry-run' : 'live', currentStage: 'PLAN',
    status: TaskStatus.RUNNING, result: null, errorDetails: null,
    timestamps: { startedAt, updatedAt: startedAt },
  });

  const emit = async (stage, details) => {
    await stateEngine.setTaskState(chatId, taskId, { currentStage: stage, timestamps: { updatedAt: new Date().toISOString() } });
    await stateEngine.appendLog(chatId, { taskId, stage, details });
    await onStageUpdate({ stage, details, taskId, repo, dryRun });
  };

  try {
    await emit('PLAN', 'Validating inputs and building task context.');
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) throw new Error('Repository must be in owner/repo format.');

    const taskInput = {
      targetRepo: repo,
      mode: mode || 'codex_then_antigravity',
      taskDescription: taskDescription || `Improve repository ${repo}`,
      constraints: constraints || 'Preserve existing code; prefer additive changes.',
      goal: goal || taskDescription || `Improve ${repo}`,
    };

    await emit('AUDIT', `Inspecting ${repo} via GitHub API.`);
    const repoAudit = await inspectRepository(repo, config);
    await emit('AUDIT', `Branch: ${repoAudit.defaultBranch} | Lang: ${repoAudit.language} | Source: ${repoAudit.auditSource}`);

    const input = { ...taskInput, repoAudit, defaultBranch: repoAudit.defaultBranch };

    await emit('GENERATE', 'Building codex prompt, antigravity repair prompt, and PR package.');
    const codexPrompt  = buildCodexPrompt(input);
    const repairPrompt = buildRepairPrompt(input);
    const prPackage    = buildPrPackage(input);
    const executionPacket = buildExecutionPacket(input, prPackage);
    const prMarkdown   = [`Branch: ${prPackage.branch}`, `Title: ${prPackage.title}`, '', prPackage.body].join('\n');

    await emit('ARTIFACTS', 'Writing artifacts to disk.');
    const outputDir = path.join(config.artifactsDir, repo.replace('/', '__'));
    const artifactPaths = await writeArtifacts(outputDir, { codexPrompt, repairPrompt, prMarkdown, executionPacket });
    await emit('ARTIFACTS', `Wrote ${artifactPaths.length} files to ${outputDir}`);

    // PUSH
    let pushResult = 'skipped';
    if (dryRun) {
      await emit('PUSH', 'Dry-run: branch creation and commit skipped.');
    } else if (!config.allowLivePush) {
      await emit('PUSH', 'Live push disabled (SIMBA_ALLOW_LIVE_PUSH != true). Artifacts saved locally only.');
    } else {
      await emit('PUSH', `Creating branch ${prPackage.branch}...`);
      try {
        const baseSha = await getBranchSha(owner, repoName, repoAudit.defaultBranch, config);
        try { await createBranch(owner, repoName, prPackage.branch, baseSha, config); }
        catch (branchErr) {
          if (branchErr.message.includes('422')) {
            await emit('PUSH', 'Branch exists — deleting and recreating...');
            await deleteBranch(owner, repoName, prPackage.branch, config);
            await createBranch(owner, repoName, prPackage.branch, baseSha, config);
          } else throw branchErr;
        }
        const artifactDir = `artifacts/${repo.replace('/', '__')}`;
        const files = {
          [`${artifactDir}/codex-task.md`]: codexPrompt,
          [`${artifactDir}/antigravity-repair-task.md`]: repairPrompt,
          [`${artifactDir}/pr-package.md`]: prMarkdown,
          [`${artifactDir}/execution.json`]: JSON.stringify(executionPacket, null, 2),
        };
        for (const [filePath, content] of Object.entries(files)) {
          await commitFile(owner, repoName, filePath, content, 'simba: add orchestration artifacts', prPackage.branch, config);
        }
        pushResult = 'pushed';
        await emit('PUSH', `Branch ${prPackage.branch} created with ${Object.keys(files).length} commits.`);
      } catch (pushErr) {
        pushResult = `failed: ${pushErr.message}`;
        await emit('PUSH', `⚠ Push failed: ${pushErr.message}`);
      }
    }

    // PR
    let prUrl = null;
    if (dryRun) { await emit('PR', 'Dry-run: PR creation skipped.'); }
    else if (!config.allowLivePr) { await emit('PR', 'Live PR disabled.'); }
    else if (pushResult !== 'pushed') { await emit('PR', `PR skipped — push: ${pushResult}`); }
    else {
      await emit('PR', 'Opening pull request...');
      try {
        const pr = await createPullRequest(owner, repoName, prPackage.branch, repoAudit.defaultBranch, prPackage.title, prPackage.body, config);
        prUrl = pr.url;
        await emit('PR', `PR opened: ${pr.url}`);
      } catch (prErr) {
        await emit('PR', `⚠ PR creation failed: ${prErr.message}`);
      }
    }

    const completedAt = new Date().toISOString();
    await emit('COMPLETE', 'Pipeline finished.');
    await stateEngine.setTaskState(chatId, taskId, {
      status: 'success',
      result: { summary: 'Pipeline completed', push: pushResult, prCreation: prUrl ? 'created' : 'skipped', prUrl: prUrl || null, artifactPaths, prPackage: { branch: prPackage.branch, title: prPackage.title }, repoAudit: { defaultBranch: repoAudit.defaultBranch, language: repoAudit.language } },
      timestamps: { completedAt, updatedAt: completedAt },
    });

    return await stateEngine.getTask(chatId, taskId);
  } catch (err) {
    const now = new Date().toISOString();
    await stateEngine.setTaskState(chatId, taskId, {
      status: 'failed',
      errorDetails: { likelyCause: err.message, retryPossible: true, nextAction: '/resume' },
      timestamps: { updatedAt: now, completedAt: now },
    });
    await stateEngine.appendLog(chatId, { taskId, stage: 'FAILED', details: err.message });
    await onStageUpdate({ stage: 'FAILED', details: `❌ ${err.message}`, taskId, repo, dryRun });
    return await stateEngine.getTask(chatId, taskId);
  }
}
