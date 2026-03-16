# Project Generation Template

## Project ID: {{PROJECT_ID}}

### Project Name
{{PROJECT_NAME}}

### Description
{{PROJECT_DESCRIPTION}}

---

## Project Structure

```
{{PROJECT_NAME}}/
├── package.json
├── README.md
├── .env.example
├── .gitignore
└── src/
    ├── index.js
    └── ... (project-specific files)
```

---

## Generation Pipeline

### Stage 1: PLAN
Analyze the project description and determine:
- Technology stack
- File structure
- Dependencies required
- Configuration needs

### Stage 2: AUDIT
Validate the plan against:
- Decide Engine tool ecosystem patterns
- Best practices for the chosen technology
- Completeness of the specification

### Stage 3: GENERATE
Generate all project files:
- Entry point (index.js / index.html)
- Configuration files (package.json, .env.example)
- Source code files
- Documentation (README.md)
- Templates and assets

### Stage 4: ARTIFACTS
Build the final artifact:
- Assemble all generated files
- Create directory structure
- Validate file consistency
- Generate ZIP archive if multi-file project

### Stage 5: RETURN
Deliver results to the user:
- Send individual files via Telegram
- Or send ZIP archive for multi-file projects
- Include summary and usage instructions

---

## Engine-Aware Patterns

When generating projects, follow these patterns from `decide.engine-tools`:

### Configuration Pattern
```json
{
  "id": "tool-id",
  "name": "Human Readable Name",
  "description": "What this tool does",
  "category": "category-name",
  "audience": "target-audience",
  "inputs": ["input1", "input2"],
  "outputs": ["output1", "output2"],
  "tags": ["tag1", "tag2"]
}
```

### File Structure Pattern
```
tool-directory/
├── config.json      # Tool metadata
├── index.html       # Entry point (UI)
└── tool.js          # Core logic
```

### Shared Dependencies
- `shared/tool-storage.js` — LocalStorage-backed persistence
- `shared/shared.css` — Common styles and CSS variables
- `shared/engine-utils.js` — Engine-layer utilities
- `shared/engine-models.js` — Data models and templates

---

## Quality Checklist

- [ ] All files are complete and functional
- [ ] No placeholder content remains
- [ ] Dependencies are minimal and necessary
- [ ] Documentation is accurate
- [ ] Error handling is implemented
- [ ] Code follows project conventions

---

## Result

**Status**: {{STATUS}}
**Files Generated**: {{FILE_COUNT}}
**Total Size**: {{TOTAL_SIZE}}
**Generated At**: {{TIMESTAMP}}
