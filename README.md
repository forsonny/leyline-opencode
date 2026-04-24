# leyline-opencode

`leyline-opencode` is an OpenCode plugin that implements the OpenCode Workflow Kernel: a deterministic, phase-gated workflow governor for AI-assisted software development.

The plugin treats the model as an untrusted proposer and the kernel as the authority for workflow state, gates, artifacts, task scope, verification, commit, and push.

## What It Enforces

- Fixed workflow phases from discovery through finalization.
- Source edits blocked before `TASK_EXECUTION`.
- Source edits during execution restricted to the active task `allowed_files`.
- Shell commands denied by default unless they are safe inspection commands or task verification commands.
- Structured artifacts for brainstorm, specs, critiques, plan, tasks, verification, final review, and final report.
- External SQLite durable memory outside the repo-local `.workflow/` directory.
- Hash-chained event ledger with a repo-local audit mirror.
- Resume checks that enter `MEMORY_CONFLICT` on state, ledger, artifact, worktree, or branch mismatch.
- Commit and push blocked until final gates pass.

## Install

This project is intended for GitHub/local-path distribution, not npm publishing.

Clone and build the plugin:

```bash
git clone https://github.com/forsonny/leyline-opencode.git
cd leyline-opencode
bun install
bun run build
```

Then load it from your project `opencode.json` as a local path plugin. Adjust the path to wherever you cloned the repo:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:../leyline-opencode"]
}
```

You can also use an absolute path:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:/absolute/path/to/leyline-opencode"]
}
```

OpenCode's documented plugin distribution modes are npm packages and local plugin files. Since this repo is GitHub-only, use the local path mode from a cloned checkout. Local path plugins must export an `id`, which this package does.

## Recommended OpenCode Config

Copy `examples/opencode.json` into your project or merge it into your existing `opencode.json`.

The example config:

- loads the plugin,
- adds slash commands such as `/workflow` and `/workflow-status`,
- asks before raw edits and shell commands,
- denies direct `git commit` and `git push` unless they go through the workflow finalizer.

## Basic Usage

Start a governed workflow:

```text
/workflow Build the requested feature
```

The command asks the model to call `workflow_start`. The kernel creates durable state, writes `.workflow/`, and enters `DISCOVER`.

Inspect status:

```text
/workflow-status
```

Resume after restarting OpenCode:

```text
/workflow-resume
```

Finalize after all gates pass:

```text
/workflow-finalize
```

## Custom Tools

The plugin registers these OpenCode tools:

- `workflow_start`
- `workflow_status`
- `workflow_memory_status`
- `workflow_conflict_report`
- `workflow_read_context`
- `workflow_write_artifact`
- `workflow_request_phase_advance`
- `workflow_create_task`
- `workflow_start_task`
- `workflow_edit_task_file`
- `workflow_run_verification`
- `workflow_finish_task`
- `workflow_abort`
- `workflow_finalize`

Use the workflow tools instead of raw file, shell, or git actions when operating inside a workflow.

## Workflow Phases

```text
INIT -> DISCOVER -> BRAINSTORM -> SPEC_DRAFT -> SPEC_CRITIQUE -> SPEC_FREEZE -> PLAN_DRAFT -> PLAN_CRITIQUE -> PLAN_FREEZE -> TASK_ATOMIZATION -> TASK_EXECUTION -> TASK_VERIFICATION -> INTEGRATION_VERIFICATION -> FINAL_REVIEW -> COMMIT -> PUSH_OR_MERGE -> DONE
```

Revision and recovery phases include `SPEC_REVISION`, `PLAN_REVISION`, `TASK_REPAIR`, `PLAN_REPAIR`, `BLOCKED`, `MEMORY_CONFLICT`, and `ABORTED`.

## Memory Model

The source of truth is an external SQLite database. The default location is:

- Windows: `%LOCALAPPDATA%/opencode-workflow-kernel/state.db`
- macOS/Linux: `~/.local/share/opencode-workflow-kernel/state.db`

Override with:

```text
OPENCODE_WORKFLOW_KERNEL_DB=/path/to/state.db
```

Repo-local `.workflow/` files are human-readable artifacts and audit mirrors. They are not authoritative memory.

## Worktree Behavior

By default, the plugin creates an isolated git worktree under `.worktrees/<workflow-id>` when the current project is a git repository.

After starting a workflow, run OpenCode from the reported worktree path for implementation phases. The kernel records both repo root and worktree path and will detect mismatches on resume.

Disable worktree creation in plugin options:

```json
{
  "plugin": [
    [
      "leyline-opencode",
      {
        "worktree": { "enabled": false }
      }
    ]
  ]
}
```

## Finalization

Default finalization mode is `branch-push`, but `performPush` defaults to `false` for safety. `workflow_finalize` creates the authorized commit after gates pass and stops before pushing unless policy or tool arguments explicitly allow push.

Direct main finalization is denied unless `directMainAllowed` is `true`.

## Security Boundary

This plugin enforces policy inside the OpenCode controlled tool perimeter. It cannot prevent side effects performed outside OpenCode, by another process, or through unrestricted credentials. For high-assurance use, combine it with branch protection, restricted shells, CI checks, and filesystem permissions.

See `docs/security-model.md` for details.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## Package Status

This repository is ready to use from GitHub as a local path OpenCode plugin. It is marked `private` in `package.json` to prevent accidental npm publishing.
