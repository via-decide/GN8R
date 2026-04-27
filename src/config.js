import 'dotenv/config';

const REQUIRED = ['TELEGRAM_BOT_TOKEN'];

export function loadConfig() {
  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  const adminChatIds = (process.env.SIMBA_ADMIN_CHAT_IDS || '')
    .split(',').map(id => id.trim()).filter(Boolean);

  return {
    // Telegram
    telegramToken:    process.env.TELEGRAM_BOT_TOKEN,
    pollIntervalMs:   Number(process.env.TELEGRAM_POLL_INTERVAL_MS || 3000),

    // GitHub
    githubToken:      process.env.GITHUB_TOKEN || '',
    githubOwner:      process.env.GITHUB_OWNER || 'via-decide',
    githubApiBaseUrl: process.env.GITHUB_API_BASE_URL || 'https://api.github.com',
    githubRepoScanLimit: Number(process.env.GITHUB_REPO_SCAN_LIMIT || 30),

    // Decide Engine
    engineRepo:       process.env.DECIDE_ENGINE_REPO || 'via-decide/decide.engine-tools',
    engineBaseUrl:    process.env.DECIDE_ENGINE_BASE_URL || 'https://via-decide.github.io/decide.engine-tools',

    // Feature flags
    allowLivePush:    process.env.SIMBA_ALLOW_LIVE_PUSH === 'true',
    allowLivePr:      process.env.SIMBA_ALLOW_LIVE_PR === 'true',

    // Security
    adminChatIds,
    enforceAdminOnly: process.env.SIMBA_ENFORCE_ADMIN_ONLY === 'true',

    // Storage
    artifactsDir:     process.env.ARTIFACTS_DIR || 'artifacts',
    maxTaskHistory:   Number(process.env.SIMBA_MAX_TASK_HISTORY || 50),
    taskTimeoutMs:    Number(process.env.SIMBA_TASK_TIMEOUT_MS || 120_000),

    // Local Brain (Zayvora)
    useLocalBrain:    true,
    ollamaUrl:        process.env.OLLAMA_URL || 'http://localhost:11434/api/generate',
    ollamaModel:      process.env.OLLAMA_MODEL || 'Zayvora',
    numCtx:           Number(process.env.OLLAMA_NUM_CTX || 32768),
    numPredict:       Number(process.env.OLLAMA_NUM_PREDICT || 16384),
  };
}
