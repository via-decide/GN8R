Branch: simba/implement-ui-file-pipeline-detection-engine-for-
Title: Implement UI + File Pipeline Detection engine for Alchemist to detect...

## Summary
- Repo orchestration task for via-decide/gn8r
- Goal: Implement UI + File Pipeline Detection engine for Alchemist to detect backend/UI mismatch (EPUB + unsupported MIME not rendering)

## Testing Checklist
- [ ] Run unit/integration tests
- [ ] Validate command flow
- [ ] Validate generated artifact files

## Risks
- Prompt quality depends on repository metadata completeness.
- GitHub API limits/token scope can block deep inspection.

## Rollback
- Revert branch and remove generated artifact files if workflow output is invalid.