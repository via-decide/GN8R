Branch: simba/upgrade-the-telegram-notification-system-into-an
Title: Upgrade the Telegram notification system into an interactive PR Contr...

## Summary
- Repo orchestration task for via-decide/GN8R
- Goal: Complete the autonomous developer loop by allowing the user to review, merge, or iterate on AI-generated code directly within the Telegram UI, eliminating the need to ever visit the GitHub website for routine updates.

## Testing Checklist
- [ ] Run unit/integration tests
- [ ] Validate command flow
- [ ] Validate generated artifact files

## Risks
- Prompt quality depends on repository metadata completeness.
- GitHub API limits/token scope can block deep inspection.

## Rollback
- Revert branch and remove generated artifact files if workflow output is invalid.