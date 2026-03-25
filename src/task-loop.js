/**
 * task-loop.js — Continuous task execution loop (ported from Simba v2)
 */

import crypto from 'node:crypto';
import { generateNextTask, formatTaskForTelegram } from './task-generator.js';
import { runGitHubPipeline } from './execution-pipeline.js';

const DEFAULT_DELAY_MS = 10_000;
const MAX_CONSECUTIVE_FAILURES = 3;

const activeLoops = new Map();

export function isLoopRunning(chatId) {
  return activeLoops.get(String(chatId))?.running === true;
}

export function getLoopStatus(chatId) {
  const loop = activeLoops.get(String(chatId));
  if (!loop) return null;
  return {
    running: loop.running,
    tasksCompleted: loop.tasksCompleted,
    tasksFailed: loop.tasksFailed,
    currentTask: loop.currentTaskId,
    startedAt: loop.startedAt,
    dryRun: loop.dryRun,
  };
}

export function stopLoop(chatId) {
  const loop = activeLoops.get(String(chatId));
  if (loop) { loop.running = false; return true; }
  return false;
}

export async function startLoop({ chatId, config, stateEngine, messenger, dryRun = true, delayMs = DEFAULT_DELAY_MS, maxTasks = 50, categories = null }) {
  const key = String(chatId);
  if (activeLoops.get(key)?.running) {
    await messenger.sendMessage(chatId, '⚠ A loop is already running. Use /loop stop first.');
    return;
  }

  const loop = {
    running: true,
    tasksCompleted: 0,
    tasksFailed: 0,
    currentTaskId: null,
    startedAt: new Date().toISOString(),
    dryRun,
  };
  activeLoops.set(key, loop);

  await messenger.sendMessage(chatId,
    `🔄 Loop started (${dryRun ? 'dry-run' : 'live'})\nMax tasks: ${maxTasks} | Delay: ${delayMs / 1000}s between tasks`
  );

  let consecutiveFailures = 0;

  while (loop.running && loop.tasksCompleted + loop.tasksFailed < maxTasks) {
    const task = await generateNextTask(config, stateEngine, chatId, categories);
    if (!task) {
      await messenger.sendMessage(chatId, '✅ Loop complete — no more tasks in queue.');
      break;
    }

    const taskId = crypto.randomUUID();
    loop.currentTaskId = taskId;
    await messenger.sendMessage(chatId, `⏳ Running task ${loop.tasksCompleted + loop.tasksFailed + 1}:\n${formatTaskForTelegram(task)}`);

    try {
      await runGitHubPipeline({
        taskId, chatId,
        repo: task.targetRepo,
        taskDescription: task.taskDescription,
        constraints: task.constraints,
        goal: task.goal,
        mode: task.mode || 'codex_then_antigravity',
        dryRun,
        config, stateEngine,
        onStageUpdate: async ({ stage, details }) => {
          await messenger.sendMessage(chatId, `[${stage}] ${details}`);
        },
      });

      loop.tasksCompleted++;
      consecutiveFailures = 0;
      const toolId = task.metadata?.toolId || taskId.slice(0, 8);
      await stateEngine.markQueueTask(chatId, toolId, 'completed', { taskId });
      await messenger.sendMessage(chatId, `✅ Task complete (${loop.tasksCompleted} done)`);
    } catch (err) {
      loop.tasksFailed++;
      consecutiveFailures++;
      const toolId = task.metadata?.toolId || taskId.slice(0, 8);
      await stateEngine.markQueueTask(chatId, toolId, 'failed', { taskId, error: err.message });
      await messenger.sendMessage(chatId, `❌ Task failed: ${err.message}`);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        await messenger.sendMessage(chatId, `⛔ Loop stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures.`);
        break;
      }
    }

    if (loop.running && loop.tasksCompleted + loop.tasksFailed < maxTasks) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  loop.running = false;
  activeLoops.delete(key);
  await messenger.sendMessage(chatId,
    `🏁 Loop finished — Completed: ${loop.tasksCompleted} | Failed: ${loop.tasksFailed}`
  );
}
