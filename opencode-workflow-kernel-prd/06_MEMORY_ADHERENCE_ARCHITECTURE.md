# Memory Adherence Architecture

Document status: Draft v0.2  
Prepared on: 2026-04-24  
Product: OpenCode Workflow Kernel

## 1. Purpose

The Workflow Kernel must survive interrupted sessions. A user may close OpenCode, switch models, restart the TUI, lose chat history, or resume later. The plugin must still know the current phase, active task, gate status, frozen artifact hashes, and allowed next action.

The model must not be asked to remember. The plugin must remember.

## 2. Design principle

```text
The model may read memory.
The model may propose updates.
The model may never mutate authoritative memory.
Only the Workflow Kernel may mutate authoritative memory.
```

Session memory and chat continuity are useful, but they are not sufficient. The plugin requires durable workflow memory that is independent of a single conversation thread.

## 3. Recommended memory model

Use a hybrid memory model:

```text
Primary authoritative memory:
  external local SQLite store

Human-readable workflow artifacts:
  .workflow/artifacts/
  .workflow/tasks/
  .workflow/verification/

Append-only audit trail:
  .workflow/audit/events.jsonl and/or SQLite event table

Git checkpoints:
  milestone commits, tags, or notes when policy allows
```

This gives the workflow four useful properties:

1. The current phase is controlled by trusted storage.
2. Human-readable artifacts remain easy to inspect.
3. The event ledger explains how the workflow reached its current state.
4. Git can preserve major milestones across machines and branches.

## 4. Memory authorities

### 4.1 Authoritative memory

The authoritative memory store should live outside the model-writable worktree.

Recommended path:

```text
~/.local/share/opencode-workflow-kernel/state.db
```

The exact path should be configurable.

The authoritative store owns:

```text
workflow ID
repo fingerprint
worktree path
branch
base branch
current phase
previous phase
active task
loop counts
gate status
artifact hashes
locks
last event hash
last resume timestamp
finalization status
```

### 4.2 Visible memory

The repo-local `.workflow/` directory is visible memory.

It contains:

```text
.workflow/artifacts/brainstorm.md
.workflow/artifacts/product-spec.md
.workflow/artifacts/design-spec.md
.workflow/artifacts/plan.md
.workflow/tasks/*.json
.workflow/verification/*.json
.workflow/audit/events.jsonl
.workflow/audit/violations.jsonl
.workflow/artifacts/final-report.md
```

Visible memory is not allowed to authorize phase changes by itself.

### 4.3 Git memory

Git memory should be used for milestones, not as the primary state database.

Possible checkpoint events:

```text
spec frozen
plan frozen
task completed
integration verification passed
final review passed
commit created
workflow finalized
```

Recommended default:

```text
Use git checkpoints only when policy allows and the repository is in a safe state.
```

## 5. SQLite data model

Recommended tables:

```text
workflows
workflow_events
artifact_hashes
tasks
verification_results
violations
resume_attempts
```

### 5.1 workflows

```text
id
version
goal
repo_fingerprint
repo_root
worktree_path
branch
base_branch
current_phase
previous_phase
active_task_id
spec_locked
plan_locked
git_push_locked
spec_critique_loops
plan_critique_loops
task_repair_loops
last_event_hash
created_at
updated_at
last_resumed_at
status
```

### 5.2 workflow_events

```text
workflow_id
sequence
timestamp
event_type
actor
from_phase
to_phase
reason
payload_json
previous_event_hash
event_hash
```

### 5.3 artifact_hashes

```text
workflow_id
artifact_key
path
sha256
frozen
created_at
updated_at
```

### 5.4 tasks

```text
workflow_id
task_id
status
risk_level
allowed_files_json
forbidden_files_json
verification_required_json
created_at
updated_at
```

### 5.5 resume_attempts

```text
workflow_id
timestamp
repo_fingerprint
worktree_path
branch
result
conflict_report_path
summary
```

## 6. Resume handshake

Every new session or `/workflow-resume` must run a resume handshake.

Required sequence:

```text
1. Identify repo root and worktree root.
2. Compute repo fingerprint.
3. Search authoritative memory for active workflows matching the repo.
4. Resolve the active workflow ID.
5. Load workflow state.
6. Validate worktree path.
7. Validate branch.
8. Validate current phase.
9. Validate frozen artifact hashes.
10. Validate last ledger hash.
11. Inspect git status.
12. Compare changed files to current phase and active task policy.
13. Reinstall tool, file, and command permissions.
14. Inject the recovered phase contract.
15. Record resume result.
```

The model should see a concise recovery message:

```text
Recovered workflow: wf_20260424_abc123
Current phase: PLAN_CRITIQUE
Allowed output: .workflow/artifacts/plan-critique.json
Source edits: denied
Commit: denied
Push: denied
```

## 7. Memory conflict mode

The workflow enters `MEMORY_CONFLICT` when trusted memory, visible artifacts, event ledger, or git state disagree.

Conflict examples:

```text
trusted memory missing
repo fingerprint mismatch
wrong branch
missing worktree
frozen artifact hash mismatch
ledger hash mismatch
unexpected source edits
active task missing
verification evidence missing
commit exists without final review
```

Allowed actions in `MEMORY_CONFLICT`:

```text
read workflow status
inspect git status
inspect workflow artifacts
write conflict report
request restore
request abort
request human override
```

Denied actions in `MEMORY_CONFLICT`:

```text
source edits
phase advancement
task completion
spec freeze
plan freeze
commit
push
trusted memory mutation by model
```

## 8. Conflict report

Conflict reports should be machine-readable.

Path:

```text
.workflow/audit/memory-conflict-report.json
```

Example:

```json
{
  "result": "conflict",
  "workflow_id": "wf_20260424_abc123",
  "detected_at": "2026-04-24T12:35:00-04:00",
  "conflicts": [
    {
      "type": "frozen_artifact_hash_mismatch",
      "path": ".workflow/artifacts/design-spec.md",
      "expected_sha256": "sha256...",
      "actual_sha256": "sha256...",
      "severity": "blocker"
    }
  ],
  "allowed_recovery_actions": [
    "restore_artifact",
    "abort_workflow",
    "human_override"
  ],
  "recommended_action": "restore_artifact"
}
```

## 9. Recovery actions

### 9.1 Restore artifact

Use when a frozen artifact changed unexpectedly.

Requirements:

```text
restore from checkpoint or trusted snapshot
verify restored hash
record restore event
resume original phase
```

### 9.2 Controlled repair

Use when the repository changed in a way that may be legitimate but is outside the active task boundary.

Requirements:

```text
human or strong-model review
explicit repair phase
new artifact hashes where appropriate
new verification evidence
ledger event
```

### 9.3 Human override

Use only when configured.

Requirements:

```text
named approver if available
reason
scope of override
new trusted state event
final report disclosure
```

### 9.4 Abort

Use when safe recovery is not possible.

Requirements:

```text
preserve artifacts
preserve ledger
record reason
block future workflow actions unless explicitly resumed or restarted
```

## 10. Memory protection policy

Protected locations:

```text
external SQLite memory store
.workflow/audit/events.jsonl
.workflow/audit/violations.jsonl
.workflow/audit/memory-conflict-report.json after creation
.workflow/checkpoints/**
.opencode/**
opencode.json
plugin source files
.git/**
```

The model must not directly edit these paths.

The plugin may allow workflow tools to append events or write reports, but only after controller validation.

## 11. Event hash strategy

Each event hash should be computed from canonical event content.

Input fields:

```text
workflow_id
sequence
timestamp
event_type
actor
from_phase
to_phase
reason
payload_json
previous_event_hash
```

The event hash protects against silent mutation of prior workflow history.

Resume must validate:

```text
latest event hash in SQLite
latest event hash in ledger
sequence continuity
phase transition legality
artifact hash consistency
```

## 12. Startup behavior

At plugin startup:

```text
1. Do not trust chat history.
2. Do not trust model claims.
3. Load memory.
4. Validate memory.
5. Reconstruct current phase.
6. Reapply permissions.
7. Present current allowed action.
```

The model-facing instruction should be explicit:

```text
The controller recovered the workflow from durable memory.
Continue only from the current phase shown below.
Do not infer prior state from conversation history.
```

## 13. Acceptance criteria

The memory system is acceptable when:

```text
A workflow resumes at the correct phase after OpenCode restart.
A workflow resumes at the correct active task after task execution interruption.
A frozen artifact hash mismatch enters MEMORY_CONFLICT.
A ledger hash mismatch enters MEMORY_CONFLICT.
A model cannot edit authoritative memory.
A model cannot mark memory as complete through artifacts alone.
A final report can be reconstructed from memory and artifacts.
```

## 14. MVP recommendation

For MVP, implement:

```text
external local SQLite workflow table
event ledger table
repo-local event mirror
artifact hash table
resume command
memory status command
memory conflict mode
basic git checkpoint metadata
```

Do not start with server-backed memory. Add that later if multi-machine or team-level governance becomes required.
