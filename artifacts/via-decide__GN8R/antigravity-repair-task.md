Repair mode for repository via-decide/GN8R.

TARGET
Validate and repair only the files touched by the previous implementation.

TASK
Upgrade the Telegram notification system into an interactive PR Controller ('Commander').
Upgrade the GN8R synthesis pipeline with 'Synapse'-a repo-aware context fetching engine.
Upgrade the Telegram message listener to support Multimodal (Audio) payloads for native voice-to-code generation.

RULES
1. Audit touched files first and identify regressions.
2. Preserve architecture and naming conventions.
3. Make minimal repairs only; do not expand scope.
4. Re-run checks and provide concise root-cause notes.
5. Return complete contents for changed files only.

SOP: REPAIR PROTOCOL (MANDATORY)
1. Strict Fix Only: Do not use repair mode to expand scope or add features.
2. Regression Check: Audit why previous attempt failed before proposing a fix.
3. Minimal Footprint: Only return contents for the actual repaired files.

REPO CONTEXT
- README snippet:
# ⚡ Decide Engine Bot — Antigravity Edition Telegram bot powered by **Antigravity (Gemini)** that does two things: 1. **File generation for regular users** — send a plain English task, get a real file back (HTML, Python, Markdown, JSON, CSV, SQL, etc.) 2. **GitHub repo orchestration** — Simba-styl
- AGENTS snippet:
not found
- package.json snippet:
{ "name": "gn8r", "version": "2.0.0", "description": "Telegram bot — Antigravity-powered file generation + GitHub orchestration via Decide Engine", "type": "module", "main": "src/index.js", "scripts": { "start": "node src/index.js", "dev": "node --watch src/index.js", "check"