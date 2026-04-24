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

This project is intended for GitHub/local-path distribution, not npm publishing. A working install has two parts:

- the plugin path in `plugin`, which loads the Workflow Kernel tools,
- the `command` entries, which add slash commands such as `/workflow` and `/workflow-status`.

If the plugin path is configured but the `command` block is missing, OpenCode can load the plugin while the workflow slash commands are absent.

### 1. Clone and build the plugin

Clone the repo into a stable location. This example uses the global OpenCode config directory on Windows:

In the Windows commands below, `YOU` is a placeholder for your Windows account folder name. If your home folder is `C:/Users/USERNAME`, use `C:/Users/USERNAME/.config/opencode/plugins/leyline-opencode`.

```powershell
git clone https://github.com/forsonny/leyline-opencode.git C:/Users/YOU/.config/opencode/plugins/leyline-opencode
cd C:/Users/YOU/.config/opencode/plugins/leyline-opencode
bun install
bun run build
```

On macOS/Linux, the same layout would be:

```bash
git clone https://github.com/forsonny/leyline-opencode.git ~/.config/opencode/plugins/leyline-opencode
cd ~/.config/opencode/plugins/leyline-opencode
bun install
bun run build
```

### 2. Add it to OpenCode config

Edit your global OpenCode config:

- Windows: `C:/Users/YOU/.config/opencode/opencode.json`
- macOS/Linux: `~/.config/opencode/opencode.json`

Use this complete minimal config. Replace `YOU` with your Windows account folder name, or replace the whole path with the path where you cloned the repo. In JSON, forward slashes are valid on Windows and avoid backslash escaping mistakes.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "C:/Users/YOU/.config/opencode/plugins/leyline-opencode"
  ],
  "command": {
    "workflow": {
      "description": "Start a Workflow Kernel workflow",
      "template": "Start a governed Workflow Kernel workflow for this goal: $ARGUMENTS\n\nCall workflow_start with the goal, then immediately continue executing the returned next_actions with Workflow Kernel tools until the workflow reaches DONE, BLOCKED, MEMORY_CONFLICT, or ABORTED, a tool returns ok:false, or user input is required. Do not stop after reporting status."
    },
    "workflow-status": {
      "description": "Show Workflow Kernel status",
      "template": "Call workflow_status and summarize the current phase, active task, blockers, and next required action."
    },
    "workflow-resume": {
      "description": "Resume Workflow Kernel state",
      "template": "Call workflow_memory_status. If there is a conflict, call workflow_conflict_report. Otherwise call workflow_read_context, then continue executing the recovered phase contract and next_actions until the workflow reaches DONE, BLOCKED, MEMORY_CONFLICT, or ABORTED, a tool returns ok:false, or user input is required."
    },
    "workflow-memory": {
      "description": "Show Workflow Kernel memory health",
      "template": "Call workflow_memory_status and report memory path, ledger health, and frozen artifact validation."
    },
    "workflow-conflict-report": {
      "description": "Write a Workflow Kernel conflict report",
      "template": "Call workflow_conflict_report and summarize conflicts plus allowed recovery actions."
    },
    "workflow-finalize": {
      "description": "Finalize a Workflow Kernel workflow",
      "template": "Call workflow_finalize. Do not run raw git commit or raw git push. Report the commit hash and finalization status."
    },
    "workflow-abort": {
      "description": "Abort a Workflow Kernel workflow",
      "template": "Call workflow_abort with this reason: $ARGUMENTS"
    }
  }
}
```

If you already have an OpenCode config, merge the `plugin` entry and the full `command` block into your existing file. Do not remove your provider, model, permission, MCP, or other existing settings.

### 3. Restart and verify

Restart OpenCode after changing the config. Then verify that OpenCode resolved both the plugin and the workflow commands:

```bash
opencode debug config
```

In the output, check for:

- `plugin_origins` containing the local `leyline-opencode` path,
- `command.workflow`,
- `command.workflow-status`.

Then open OpenCode and run:

```text
/workflow-status
```

Expected result: the assistant calls `workflow_status` and reports no active workflow yet, or reports the current workflow state.

### 4. Optional project-local config

Instead of putting the plugin in your global config, you can load it from a project's `opencode.json`. Adjust the relative path to wherever you cloned the repo:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:../leyline-opencode"]
}
```

If you use project-local config, also copy or merge the `command` block from `examples/opencode.json`; slash commands are not created by the plugin path alone.

### Common install mistakes

- Missing `command` block: the plugin loads, but `/workflow` and `/workflow-status` do not appear.
- Missing JSON comma between plugin entries.
- Unescaped Windows backslashes. Use `C:/Users/YOU/...` or double every backslash.
- Using `leyline@git+https://...`; this project is `leyline-opencode` and is meant to be loaded from a cloned local path.
- Forgetting `bun run build`; OpenCode loads `dist/index.js`.
- Forgetting to restart OpenCode after changing config.

## Recommended OpenCode Config

Copy `examples/opencode.json` into your project or merge it into your existing `opencode.json` when you want stricter workflow permissions and plugin options.

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

The command asks the model to call `workflow_start`. The kernel creates durable state, writes `.workflow/`, enters `DISCOVER`, and returns continuation guidance plus exact artifact requirements so the model keeps moving through phases until a blocker or required user decision appears.

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
      "file:../leyline-opencode",
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
