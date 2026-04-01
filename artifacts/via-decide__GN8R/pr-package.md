Branch: simba/upgrade-the-telegram-message-listener-to-support
Title: Upgrade the Telegram message listener to support Multimodal (Audio) p...

## Summary
- Repo orchestration task for via-decide/GN8R
- Goal: Allow the user to send Telegram Voice Notes directly to the bot, enabling GN8R to autonomously convert spoken architectural instructions into deployed code in real-time.

## Testing Checklist
- [ ] Run unit/integration tests
- [ ] Validate command flow
- [ ] Validate generated artifact files

## Risks
- Prompt quality depends on repository metadata completeness.
- GitHub API limits/token scope can block deep inspection.

## Rollback
- Revert branch and remove generated artifact files if workflow output is invalid.