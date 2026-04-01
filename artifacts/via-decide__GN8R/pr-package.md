Branch: simba/upgrade-the-telegram-message-listener-to-support
Title: Upgrade the Telegram message listener to support Multimodal (Vision) ...

## Summary
- Repo orchestration task for via-decide/GN8R
- Goal: Allow the user to send UI sketches, diagrams, or screenshots directly via Telegram, enabling GN8R to autonomously convert physical images into deployed code architecture in real-time.

## Testing Checklist
- [ ] Run unit/integration tests
- [ ] Validate command flow
- [ ] Validate generated artifact files

## Risks
- Prompt quality depends on repository metadata completeness.
- GitHub API limits/token scope can block deep inspection.

## Rollback
- Revert branch and remove generated artifact files if workflow output is invalid.