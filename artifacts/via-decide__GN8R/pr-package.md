Branch: simba/overhaul-the-core-code-generation-pipeline-to-co
Title: Overhaul the core code generation pipeline to completely bypass the C...

## Summary
- Repo orchestration task for via-decide/GN8R
- Goal: Transform GN8R from a simple relay bot into a direct, long-context autonomous software engineer that takes a Telegram message, synthesizes entire multi-file architectures via Gemini, and ships the PR directly to the repo.

## Testing Checklist
- [ ] Run unit/integration tests
- [ ] Validate command flow
- [ ] Validate generated artifact files

## Risks
- Prompt quality depends on repository metadata completeness.
- GitHub API limits/token scope can block deep inspection.

## Rollback
- Revert branch and remove generated artifact files if workflow output is invalid.