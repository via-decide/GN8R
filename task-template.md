# Task Execution Template

## Task ID: {{TASK_ID}}

### Description
{{TASK_DESCRIPTION}}

### Output Type
{{OUTPUT_TYPE}}

### Expected Filename
{{OUTPUT_FILENAME}}

---

## Execution Plan

### Steps
{{STEPS}}

### Complexity
{{COMPLEXITY}}

---

## Engine Context

The Decide Engine tool ecosystem (`via-decide/decide.engine-tools`) provides 50+ tools including:
- Code generators (script-generator, code-generator, spec-builder)
- Prompt tools (promptalchemy, prompt-compare, idea-remixer)
- Study tools (student-research, interview-prep)
- Business tools (sales-dashboard, decision-brief)
- Game engines (hex-wars, wings-of-fire-quiz)
- Orchard Engine (player-signup, daily-quest-generator, fruit-yield-engine)

### Tool Integration
When generating content, consider:
1. Reuse patterns from existing engine tools
2. Follow the `config.json + index.html + tool.js` structure
3. Import shared utilities: `shared/tool-storage.js`, `shared/shared.css`

---

## Generation Rules

1. Output ONLY the file content — no markdown fences, no preamble
2. Make it complete and production-ready
3. Use best practices for the target technology
4. Include inline documentation and comments
5. Handle edge cases and errors gracefully

---

## Result

**Status**: {{STATUS}}
**Generated At**: {{TIMESTAMP}}
**File Size**: {{FILE_SIZE}}
