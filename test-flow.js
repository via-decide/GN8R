/**
 * scripts/test-flow.js — Offline test harness (no real Telegram/GitHub needed)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommandRouter } from '../src/command-router.js';
import { StateEngine } from '../src/state-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const stateEngine = new StateEngine(
  path.join(__dirname, '..', 'artifacts', 'test-state.json')
);

const messages = [];
const telegram = {
  async sendMessage(chatId, text)        { messages.push({ type: 'msg', chatId, text: text.slice(0, 80) }); },
  async sendDocument(chatId, fp, fn, cap){ messages.push({ type: 'doc', chatId, filename: fn }); },
  async sendPreviewCard(chatId, card)    { messages.push({ type: 'preview', chatId, text: card.text?.slice(0, 60), buttons: card.buttons }); },
  async answerCallbackQuery()            {},
  async setMyCommands()                  {},
  async getMe()                          { return { username: 'test_bot', first_name: 'Test' }; },
};

const config = {
  telegramToken: 'test-token',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: 'gemini-1.5-flash',
  geminiMaxTokens: 8192,
  geminiApiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  githubToken: process.env.GITHUB_TOKEN || '',
  githubOwner: process.env.GITHUB_OWNER || 'via-decide',
  githubApiBaseUrl: 'https://api.github.com',
  githubRepoScanLimit: 5,
  engineRepo: 'via-decide/decide.engine-tools',
  engineBaseUrl: 'https://via-decide.github.io/decide.engine-tools',
  allowLivePush: false, allowLivePr: false,
  adminChatIds: [], enforceAdminOnly: false,
  artifactsDir: path.join(__dirname, '..', 'artifacts'),
  maxTaskHistory: 50, taskTimeoutMs: 30000,
  pollIntervalMs: 100,
};

const router = new CommandRouter({ config, stateEngine, telegram });
const chatId = 9999;

console.log('=== Decide Engine Bot — Antigravity Test Harness ===\n');

async function test(label, fn) {
  try { await fn(); console.log(`✅ ${label}`); }
  catch (err) { console.error(`❌ ${label}: ${err.message}`); }
}

await test('/help', async () => { await router.handleMessage({ chatId, text: '/help' }); });
await test('/status (empty)', async () => { await router.handleMessage({ chatId, text: '/status' }); });
await test('/history (empty)', async () => { await router.handleMessage({ chatId, text: '/history' }); });
await test('/cancel (nothing)', async () => { await router.handleMessage({ chatId, text: '/cancel' }); });
await test('/catalog', async () => { await router.handleMessage({ chatId, text: '/catalog' }); });
await test('/queue', async () => { await router.handleMessage({ chatId, text: '/queue' }); });
await test('/loop status', async () => { await router.handleMessage({ chatId, text: '/loop status' }); });
await test('unknown command', async () => { await router.handleMessage({ chatId, text: '/foobar' }); });

if (config.geminiApiKey) {
  await test('/task (file generation)', async () => {
    await router.handleMessage({ chatId, text: '/task create a markdown readme for a Node.js project' });
  });
} else {
  console.log('⏭  /task skipped (GEMINI_API_KEY not set)');
}

console.log(`\n=== ${messages.length} messages captured ===\n`);
for (const m of messages) {
  if (m.type === 'doc')     console.log(`[DOC]     ${m.filename}`);
  else if (m.type === 'preview') console.log(`[PREVIEW] ${m.text}...`);
  else console.log(`[MSG]     ${m.text}`);
}
console.log('\n✅ Test harness complete.');
