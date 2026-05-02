Repair mode for repository via-decide/gn8r.

TARGET
Validate and repair only the files touched by the previous implementation.

TASK
Implement UI + File Pipeline Detection engine for Alchemist to detect backend/UI mismatch (EPUB + unsupported MIME not rendering)

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
# AGENTS This repository supports deterministic content generation. Rules: - Do not hallucinate APIs - Use existing generation pipeline - Prefer templates over freeform generation - Outputs must be copy-paste ready Primary agent: - content_generator Capabilities: - generate short posts - generat
- package.json snippet:
{ "name": "gn8r", "version": "2.0.0", "description": "Telegram bot — Zayvora-powered file generation + GitHub orchestration via Decide Engine", "type": "module", "main": "src/index.js", "scripts": { "start": "node src/index.js", "dev": "node --watch src/index.js", "check": "n