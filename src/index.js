import { startTelegramBot } from './telegram-bot.js';

console.log('');
console.log('  ⚡ Decide Engine Bot — Antigravity Edition');
console.log('  ─────────────────────────────────────────');
console.log('  Powered by Antigravity (Gemini) + Decide Engine');
console.log('  Repo: via-decide/decide.engine-tools');
console.log('');

startTelegramBot().catch(err => {
  console.error('Fatal startup error:', err.message);
  process.exit(1);
});
