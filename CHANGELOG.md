# Changelog

## 0.1.4 - 2026-04-24

- Added continuation guidance to workflow tool responses and phase contracts so started or resumed workflows keep executing returned next actions until a blocker, terminal state, failed tool call, or required user input.
- Updated `/workflow` and `/workflow-resume` command templates to avoid stopping after status reporting.

## 0.1.3 - 2026-04-24

- Fixed migration of existing Workflow Kernel state databases that were missing newer workflow columns.
- Made Windows test cleanup more tolerant of transient SQLite file locks.

## 0.1.2 - 2026-04-24

- Clarified the full local-path install flow, including slash-command configuration, Windows account-name placeholders, and verification steps.

## 0.1.1 - 2026-04-24

- Updated documentation and example config for GitHub/local-path distribution.
- Marked package private to prevent accidental npm publishing.

## 0.1.0 - 2026-04-24

- Initial OpenCode Workflow Kernel plugin implementation.
- Added phase-gated workflow state machine, SQLite-backed durable memory, artifact validators, custom tools, hook enforcement, worktree helpers, and documentation.
