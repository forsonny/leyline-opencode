# Security Model

`leyline-opencode` is a workflow governor, not a sandbox.

## Trusted

- Plugin source code.
- SQLite workflow memory.
- Policy configuration.
- Gate validators.
- Workflow tools.
- Git finalization wrapper.

## Semi-Trusted

- Model-authored Markdown artifacts.
- Model-authored critique JSON.
- Model-authored task JSON.
- Model summaries and recommendations.

## Untrusted

- Model tool calls.
- Raw shell commands.
- File edits.
- Git actions.
- Claims of completion.
- Attempts to mutate workflow state.

## Protected Paths

Default protected paths include:

```text
.opencode/**
opencode.json
opencode.jsonc
.git/**
.workflow/audit/**
.workflow/checkpoints/**
**/.env
**/.env.*
```

## Known Limitations

- The plugin cannot stop actions outside OpenCode.
- If users grant broad raw shell permissions, file-level guarantees are weakened.
- Local SQLite memory can be deleted or damaged by external processes.
- Direct pushing depends on repository credentials and branch protection.
- Artifact validators prove structure and evidence, not full software correctness.

## Recommended Hardening

- Keep OpenCode `edit` and `bash` permissions at `ask` or stricter.
- Deny raw `git commit` and `git push` in project config.
- Use branch protection and CI for final review.
- Run OpenCode inside the workflow worktree after `workflow_start` creates it.
- Keep the external SQLite database outside the model-writable repository.
