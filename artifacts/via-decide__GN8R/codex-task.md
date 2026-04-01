You are working in repository via-decide/GN8R on branch main.

MISSION
Upgrade the Telegram notification system into an interactive PR Controller ('Commander').
Upgrade the GN8R synthesis pipeline with 'Synapse'-a repo-aware context fetching engine.

CONSTRAINTS
The Octokit fetch must handle base64 decoding correctly since GitHub API returns file contents in base64. If a file is not found (404), gracefully ignore it and assume the user wants to create a brand new file. The pre-flight LLM call must be exceptionally fast to not delay the UX.
Upgrade the Telegram message listener to support Multimodal (Audio) payloads for native voice-to-code generation.

CONSTRAINTS
Zero NPM dependencies. Must handle GitHub merge conflicts gracefully by alerting the user in Telegram if a merge is blocked. The 'Tweak' logic must correctly identify the open PR branch to push new commits to the same branch instead of creating a new one.

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
not found


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