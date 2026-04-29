# ⚡ Decide Engine Bot — Antigravity Edition

Telegram bot powered by **Antigravity (Gemini)** that does two things:

1. **File generation for regular users** — send a plain English task, get a real file back (HTML, Python, Markdown, JSON, CSV, SQL, etc.)
2. **GitHub repo orchestration** — Simba-style pipeline: audit → generate prompts → push branch → open PR

Powered by [via-decide/decide.engine-tools](https://github.com/via-decide/decide.engine-tools) and **Antigravity (Gemini AI)**.

---

## Setup

```bash
git clone <repo>
cd decide-engine-bot
npm install
cp .env.example .env
# Fill in .env then:
npm start
```

**Minimum `.env` to run:**
```
TELEGRAM_BOT_TOKEN=your_token_from_botfather
OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=Zayvora
```

**To enable GitHub features (legacy):**
```
GIT_PROVIDER=github
GITHUB_TOKEN=ghp_your_token
GITHUB_OWNER=your_github_username
SIMBA_ALLOW_LIVE_PUSH=true
SIMBA_ALLOW_LIVE_PR=true
```

**To enable Gitea (recommended):**
```
GIT_PROVIDER=gitea
GITEA_TOKEN=your_gitea_pat
GITEA_OWNER=dharam
GITEA_API_BASE_URL=https://git.daxini.xyz/api/v1
SIMBA_ALLOW_LIVE_PUSH=true
SIMBA_ALLOW_LIVE_PR=true
```

---

## Commands

### File generation (works for all users)

| Command | Description |
|---------|-------------|
| `/task create a landing page for FlowTrack` | HTML file |
| `/task generate a markdown resume template` | .md file |
| `/task write a Python CSV parser` | .py file |
| `/task create a REST API schema for a todo app` | .json file |
| `/task build a color palette generator` | .html file |

### GitHub orchestration (requires GITHUB_TOKEN)

| Command | Description |
|---------|-------------|
| `/repos` | List owner repositories |
| `/analyze owner/repo` | Inspect repo metadata |
| `/improve owner/repo` | Full pipeline with preview card |
| `/task repo: owner/repo\nmode: codex\ntask: what to do` | Structured task |
| `/resume` | Re-run last failed task |
| `/branches owner/repo` | List simba/* branches |
| `/cleanup owner/repo` | Delete stale simba/* branches |

### Engine-tools integration

| Command | Description |
|---------|-------------|
| `/registry` | Scan live decide.engine-tools |
| `/gaps [category]` | Show missing tools vs catalog |
| `/catalog` | Show local tool catalog |
| `/generate [category]` | Generate engine-tool task list |
| `/queue` | Show task queue |
| `/queue clear` | Reset queue |
| `/loop start [dry\|live]` | Start continuous execution loop |
| `/loop stop` | Stop loop after current task |
| `/loop status` | Show loop state |

### Standard ops

| Command | Description |
|---------|-------------|
| `/status` | Active task status |
| `/history` | Recent task history |
| `/logs [n]` | Last n log entries |
| `/cancel` | Cancel running task |
| `/help` | This message |

---

## Git Provider Configuration

Gn8r supports multiple git backends via the `GIT_PROVIDER` env var:

| Value | Behaviour |
|-------|-----------|
| `disabled` (default) | Bot generates files to disk; PUSH/PR stages skip cleanly |
| `gitea` | Self-hosted Gitea at `GITEA_API_BASE_URL` (recommended) |
| `github` | Legacy GitHub — deprecated, kept for migration window |

To activate Gitea:
1. Set `GIT_PROVIDER=gitea`
2. Set `GITEA_TOKEN`, `GITEA_OWNER`, `GITEA_API_BASE_URL`
3. Restart bot

Switching providers requires only env changes — no code edits.

---

## Architecture

```
Telegram (polling)
    │
    ▼
telegram-bot.js
  - webhook drain on startup
  - 409 conflict auto-retry (up to 60s)
  - message + callback_query routing
    │
    ▼
command-router.js
  - admin whitelist check
  - routes all commands
    │
    ├── /task (plain description)
    │      ▼
    │   execution-pipeline.js :: runUserPipeline()
    │     PLAN → GENERATE (Antigravity/Gemini) → ARTIFACT → send file
    │
    ├── /improve, /task (with repo:)
    │      ▼
    │   execution-pipeline.js :: runGitHubPipeline()
    │     PLAN → AUDIT → GENERATE → ARTIFACTS → PUSH → PR
    │
    ├── /loop start
    │      ▼
    │   task-loop.js :: startLoop()
    │     continuous: generateNextTask → runGitHubPipeline → repeat
    │
    └── /registry, /gaps, /generate
           ▼
        engine-bridge.js + task-generator.js
          - fetches live tool manifest
          - discovers missing tools vs catalog
          - builds engine-aware task descriptions

state-engine.js    — file-based state, write lock, corrupt recovery
github.js          — GitHub REST API (repos, branches, commits, PRs)
templates.js       — Codex prompt + repair prompt builders
artifacts.js       — Disk artifact writer + changes.patch generator
file-exporter.js   — Telegram sendMessage (split) + sendDocument
task-parser.js     — YAML/JSON/inline task parser + sanitization
```

---

## Zayvora Integration (Sovereign)

This bot uses **Zayvora** as its sole AI backend:

- **Engine:** Ollama (local), model `Zayvora` (configurable via `OLLAMA_MODEL`)
- **URL:** `http://localhost:11434/api/generate` (configurable)
- **RAG layer:** optional 3-Layer Engineering Reasoning Engine at `RAG_SERVER_URL` (default `http://localhost:8902`)
- **Context window:** 32 768 tokens
- **Output cap:** 16 384 tokens per call (chunked pipeline handles overflow)
- **No external API. No cloud. No fallback.**

---

## Test (no Telegram needed)

```bash
npm run test:flow
```

---

## Key Features

| Feature | Source |
|---------|--------|
| Antigravity (Gemini) AI backend | Core |
| 409 conflict auto-retry | Simba v2 |
| Webhook drain on startup | Simba v2 |
| Inline keyboard callbacks (`/improve`) | Simba v2 |
| File-based state + write lock | Simba v2 |
| `sanitizeTelegram` (zero-width char removal) | Simba v2 |
| `safeJsonParse` + JSON repair | Simba v2 |
| YAML/JSON/inline task parser | Simba v2 |
| Full GitHub API (branches, commits, PRs) | Simba v2 |
| `changes.patch` artifact | Simba v2 |
| Task loop (`/loop start/stop/status`) | Simba v2 |
| Tool catalog + gap discovery | Simba v2 |
| `/catalog`, `/generate`, `/queue`, `/registry`, `/gaps` | Simba v2 |
| `/branches`, `/cleanup`, `/resume`, `/logs` | Simba v2 |
| Admin chat ID whitelist | Simba v2 |
| `sendDocument` (real file upload) | New |
| User-facing `/task` without repo field | New |
| Dual pipeline routing | New |

---

## License

MIT
