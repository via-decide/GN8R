You are working in repository via-decide/gn8r on branch main.

MISSION
Implement UI + File Pipeline Detection engine for Alchemist to detect backend/UI mismatch (EPUB + unsupported MIME not rendering)

CONSTRAINTS
Preserve existing code; prefer additive changes.

PROCESS (MANDATORY)
1. Read README.md and AGENTS.md before editing.
2. Audit architecture before coding. Summarize current behavior.
3. Preserve unrelated working code. Prefer additive modular changes.
4. Implement the smallest safe change set for the stated goal.
5. Run validation commands and fix discovered issues.
6. Self-review for regressions, missing env wiring, and docs drift.
7. Return complete final file contents for every modified or created file.

REPO AUDIT CONTEXT
- Description: 
- Primary language: JavaScript
- README snippet:
# ⚡ Decide Engine Bot — Antigravity Edition Telegram bot powered by **Antigravity (Gemini)** that does two things: 1. **File generation for regular users** — send a plain English task, get a real file back (HTML, Python, Markdown, JSON, CSV, SQL, etc.) 2. **GitHub repo orchestration** — Simba-styl

- AGENTS snippet:
# AGENTS This repository supports deterministic content generation. Rules: - Do not hallucinate APIs - Use existing generation pipeline - Prefer templates over freeform generation - Outputs must be copy-paste ready Primary agent: - content_generator Capabilities: - generate short posts - generat


SOP: PRE-MODIFICATION PROTOCOL (MANDATORY)
1. Adherence to Instructions: No deviations without explicit user approval.
2. Mandatory Clarification: Immediately ask if instructions are ambiguous or incomplete.
3. Proposal First: Always propose optimizations or fixes before implementing them.
4. Scope Discipline: Do not add unrequested features or modify unrelated code.
5. Vulnerability Check: Immediately flag and explain security risks.

OUTPUT REQUIREMENTS
- Include: implementation summary, checks run, risks, rollback notes.
- Generate branch + PR package.
- Keep prompts deterministic and preservation-first.