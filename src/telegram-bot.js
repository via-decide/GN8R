/**
 * telegram-bot.js — Long-polling with 409 conflict handling + webhook drain
 * Ported from Simba v2 and extended with sendDocument support.
 */

import { makeTelegramAPI } from './file-exporter.js';
import { CommandRouter } from './command-router.js';
import { StateEngine } from './state-engine.js';
import { loadConfig } from './config.js';

const CONFLICT_RETRY_DELAY_MS = 5000;
const MAX_CONFLICT_RETRIES    = 12;

async function initPolling(token) {
  const api = makeTelegramAPI(token);
  // Remove any webhook so long-polling works
  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: false }),
    });
    console.log('[init] Webhook cleared.');
  } catch (err) { console.warn('[init] deleteWebhook failed (non-fatal):', err.message); }

  // Drain pending updates and get latest offset
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeout: 0, offset: -1, limit: 1 }),
    });
    const data = await res.json();
    if (data.result?.length) {
      const latestId = data.result[data.result.length - 1].update_id;
      console.log(`[init] Fast-forwarded to update_id ${latestId + 1}`);
      return latestId + 1;
    }
  } catch (err) { console.warn('[init] Could not pre-fetch offset (non-fatal):', err.message); }
  return 0;
}

async function getUpdates(token, offset) {
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeout: 25, offset, allowed_updates: ['message', 'callback_query'] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`getUpdates ${res.status}: ${t}`); }
  const data = await res.json();
  if (!data.ok) throw new Error('getUpdates returned ok=false');
  return data.result || [];
}

export async function startTelegramBot() {
  const config = loadConfig();
  const stateEngine = StateEngine.fromConfig(config);
  const telegram = makeTelegramAPI(config.telegramToken);
  const router = new CommandRouter({ config, stateEngine, telegram });

  // Register commands
  try {
    await telegram.setMyCommands([
      { command: 'start',    description: 'Start the bot' },
      { command: 'help',     description: 'Show all commands' },
      { command: 'task',     description: 'Generate a file or run a repo task' },
      { command: 'improve',  description: 'Full pipeline for a GitHub repo' },
      { command: 'status',   description: 'Check current task status' },
      { command: 'history',  description: 'View recent tasks' },
      { command: 'cancel',   description: 'Cancel running task' },
      { command: 'resume',   description: 'Re-run last failed task' },
      { command: 'repos',    description: 'List owner repositories' },
      { command: 'analyze',  description: 'Inspect a GitHub repo' },
      { command: 'registry', description: 'Scan live decide.engine-tools' },
      { command: 'generate', description: 'Generate engine-tool tasks' },
      { command: 'loop',     description: 'Start/stop continuous loop' },
    ]);
    console.log('[bot] Commands registered.');
  } catch (err) { console.warn('[bot] Could not register commands:', err.message); }

  // Validate token
  try {
    const me = await telegram.getMe();
    console.log(`[bot] Connected as @${me.username} (${me.first_name})`);
  } catch (err) { throw new Error(`Failed to connect to Telegram: ${err.message}`); }

  console.log(`[bot] Live push: ${config.allowLivePush} | Live PR: ${config.allowLivePr}`);
  if (config.enforceAdminOnly) console.log(`[bot] Admin-only: ${config.adminChatIds.length} allowed chat(s)`);

  let running = true;
  let conflictRetries = 0;

  process.on('SIGINT',  () => { console.log('\n[SIGINT] Shutting down...'); running = false; });
  process.on('SIGTERM', () => { console.log('\n[SIGTERM] Shutting down...'); running = false; });
  process.on('uncaughtException', err => console.error('[bot] Uncaught:', err.message));
  process.on('unhandledRejection', reason => console.error('[bot] Unhandled rejection:', reason));

  let offset = await initPolling(config.telegramToken);
  console.log(`[bot] Polling from offset ${offset}...`);

  while (running) {
    try {
      const updates = await getUpdates(config.telegramToken, offset);
      conflictRetries = 0;

      for (const update of updates) {
        offset = update.update_id + 1;

        if (update.message?.text) {
          const chatId = update.message.chat.id;
          const userId = update.message.from?.id || chatId;
          const text   = update.message.text;
          console.log(`[msg] ${chatId}: ${text.slice(0, 80)}`);
          router.handleMessage({ chatId, userId, text }).catch(err => {
            console.error(`[bot] handleMessage error:`, err.message);
            telegram.sendMessage(chatId, `❌ Internal error: ${err.message}`).catch(() => {});
          });
        }

        if (update.callback_query?.data) {
          const chatId = update.callback_query.message.chat.id;
          const data   = update.callback_query.data;
          console.log(`[cb] ${chatId}: ${data}`);
          router.handleCallback({ chatId, callbackQueryId: update.callback_query.id, data }).catch(err => {
            console.error(`[bot] handleCallback error:`, err.message);
          });
          telegram.answerCallbackQuery(update.callback_query.id, 'Received').catch(() => {});
        }
      }
    } catch (err) {
      const is409 = err.message.includes('409');
      if (is409) {
        conflictRetries++;
        console.warn(`[poll] 409 Conflict (attempt ${conflictRetries}/${MAX_CONFLICT_RETRIES}) — another instance may be running. Waiting ${CONFLICT_RETRY_DELAY_MS / 1000}s...`);
        if (conflictRetries >= MAX_CONFLICT_RETRIES) {
          console.error('[poll] Too many 409 conflicts. Kill other instances: pkill -f "node src/index.js" then restart.');
          running = false; break;
        }
        await new Promise(r => setTimeout(r, CONFLICT_RETRY_DELAY_MS));
      } else {
        console.error('[poll error]', err.message);
        await new Promise(r => setTimeout(r, config.pollIntervalMs));
      }
    }
  }
  console.log('[bot] Stopped.');
}
