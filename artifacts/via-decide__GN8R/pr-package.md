Branch: simba/upgrade-the-gn8r-synthesis-pipeline-with-synapse
Title: Upgrade the GN8R synthesis pipeline with 'Synapse'-a repo-aware conte...

## Summary
- Repo orchestration task for via-decide/GN8R
- Goal: Transform GN8R into a context-aware codebase editor that automatically reads the user's live files before generating code, ensuring edits are perfectly integrated into the existing architecture rather than hallucinated from scratch.

## Testing Checklist
- [ ] Run unit/integration tests
- [ ] Validate command flow
- [ ] Validate generated artifact files

## Risks
- Prompt quality depends on repository metadata completeness.
- GitHub API limits/token scope can block deep inspection.

## Rollback
- Revert branch and remove generated artifact files if workflow output is invalid.