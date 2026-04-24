# Workflow Kernel Architecture

Document status: Draft v0.2  
Prepared on: 2026-04-24  
Product: OpenCode Workflow Kernel

## 1. Architecture summary

OpenCode Workflow Kernel is a plugin that implements a controlled workflow perimeter around LLM agents. It uses OpenCode plugin hooks, custom tools, permissions, commands, model-configured agents, and git worktree context to constrain agent behavior.

The model is treated as an untrusted proposer. The kernel is treated as the authority.

```text
User goal
  -> workflow command
  -> trusted workflow memory
  -> recovered or initialized workflow state
  -> phase-specific model instruction
  -> model proposes artifact or action
  -> kernel validates action
  -> tool executes only if authorized
  -> kernel records evidence
  -> kernel decides next phase
```

## 2. Major components

### 2.1 Workflow Kernel

The central controller responsible for:

- Loading trusted state.
- Validating phase transitions.
- Authorizing or denying tool calls.
- Validating artifacts.
- Tracking loop counts.
- Selecting phase instructions.
- Recording audit events.
- Enforcing commit and push rules.

### 2.2 State Manager and Memory Store

Owns authoritative workflow state and durable workflow memory.

Responsibilities:

- Create workflow IDs.
- Store current phase.
- Store artifact hashes.
- Store active task ID.
- Store violation counts.
- Store final gate status.
- Store resume metadata.
- Store worktree and branch identity.
- Prevent direct model mutation.
- Detect tampering.
- Reconstruct state after session restart.

Recommended memory strategy:

```text
Authoritative state:
  External local SQLite store outside model-writable paths.

Human-readable artifacts:
  .workflow/artifacts/
  .workflow/tasks/
  .workflow/verification/

Append-only ledger:
  .workflow/audit/events.jsonl or external event table.

Git checkpoints:
  Tags, notes, or milestone commits when policy allows.
```

The repo-local `.workflow/` directory is visible memory, not authoritative memory. It is useful for human inspection and audit artifacts, but current phase, locks, active task, and finalization status must be owned by the kernel.

### 2.3 Memory Adherence Subsystem

Ensures the workflow can be stopped and resumed without asking the model where it left off.

Responsibilities:

- Discover active workflows for the current repository or worktree.
- Load authoritative state from external local storage.
- Validate repo fingerprint, worktree path, branch, and base commit.
- Validate hashes for frozen artifacts.
- Replay the event ledger when recovery or audit reconstruction is required.
- Reinstall phase permissions after session restart.
- Inject the recovered phase contract into the model context.
- Enter `MEMORY_CONFLICT` when state, artifacts, ledger, or git disagree.

Resume rule:

```text
The plugin tells the model the recovered phase.
The plugin never asks the model to infer the recovered phase.
```

### 2.4 Artifact Validator

Validates required artifacts for each phase.

Responsibilities:

- Check existence.
- Check schema.
- Check required sections.
- Check severity and scoring rules.
- Check frozen artifact hashes.
- Reject vague or incomplete task definitions.

### 2.5 Tool Policy Engine

Evaluates every proposed side-effecting action.

Responsibilities:

- Deny by default.
- Allow only phase-approved tools.
- Enforce file allowlists.
- Enforce command allowlists.
- Block raw shell where configured.
- Block git actions before final gates.
- Log violations.

### 2.6 Workflow-Specific Tools

Custom tools that expose narrow actions to the model.

Recommended tools:

```text
workflow_status
workflow_read_context
workflow_write_artifact
workflow_submit_critique
workflow_request_phase_advance
workflow_create_task
workflow_start_task
workflow_edit_task_file
workflow_run_verification
workflow_finish_task
workflow_request_amendment
workflow_finalize
```

These tools validate state before doing anything.

### 2.7 Agent Router

Selects the configured model and agent contract for the current phase.

Responsibilities:

- Route critique to stronger models.
- Route constrained task execution to cheaper models when policy allows.
- Prevent a model from changing its own model class or permissions.
- Record model selection in audit events.

### 2.8 Git Worktree Manager

Creates and manages isolated git worktrees.

Responsibilities:

- Validate base branch.
- Create workflow branch.
- Create worktree path.
- Run final status checks.
- Commit controlled changes.
- Push or merge according to policy.

### 2.9 Audit Logger

Records a full event stream.

Responsibilities:

- Phase changes.
- Tool approvals.
- Tool denials.
- Artifact validation results.
- Verification command results.
- Resume decisions.
- Memory conflicts.
- Git actions.
- Finalization decisions.

## 3. Trust boundaries

### 3.1 Trusted

- Plugin source code.
- Tool policy engine.
- State manager.
- Validators.
- Git finalizer.
- Team policy configuration.

### 3.2 Semi-trusted

- Model-generated artifacts.
- Model-generated critiques.
- Model-generated task JSON.
- Model-generated summaries.

### 3.3 Untrusted

- Model tool calls.
- Model shell commands.
- Model file edits.
- Model claims of completion.
- Model requests to advance phase.

## 4. Enforcement strategy

### 4.1 Deny by default

Every tool, file path, command, and phase transition is denied unless explicitly allowed by current phase policy.

### 4.2 Phase owns capability

Capabilities depend on the current phase.

Example:

| Phase | Read repo | Write workflow artifacts | Edit source | Run tests | Commit | Push |
|---|---:|---:|---:|---:|---:|---:|
| Discover | Yes | Yes | No | No | No | No |
| Brainstorm | Yes | Yes | No | No | No | No |
| Spec draft | Yes | Yes | No | No | No | No |
| Spec critique | Yes | Yes | No | No | No | No |
| Plan draft | Yes | Yes | No | No | No | No |
| Task atomization | Yes | Yes | No | No | No | No |
| Task execution | Yes | Limited | Task allowlist only | Limited | No | No |
| Task verification | Yes | Verification only | No | Yes | No | No |
| Final review | Yes | Final report only | No | Yes | No | No |
| Commit | Yes | Final report only | No | Optional | Yes | No |
| Push or merge | Yes | Final report only | No | Optional | No | Policy gated |

### 4.3 File path policy

The controller must classify paths.

```text
Trusted protected paths:
  .opencode/**
  opencode.json
  package manager credentials
  plugin source files
  policy files
  trusted workflow state
  .git/**
  external workflow memory store

Workflow artifact paths:
  .workflow/artifacts/**
  .workflow/tasks/**
  .workflow/verification/**

Source paths:
  project source files controlled by active task allowlist
```

Protected paths are never editable by model actions during a workflow.

### 4.4 Command policy

Commands must be classified.

```text
Always denied by default:
  rm -rf
  chmod/chown on protected paths
  git push before finalization
  git commit before finalization
  git reset on protected state
  commands that write to protected config
  package install commands unless explicitly allowed

Inspection commands:
  git status
  git diff
  grep-like search
  test discovery

Verification commands:
  configured test, lint, typecheck, build commands
```

Low-trust agents should not receive raw shell. They should receive `workflow_run_verification` and other narrow wrappers.

## 5. OpenCode integration points

### 5.1 Plugin hooks

The plugin should use hook events to intercept actions and track progress.

Relevant hooks and events:

```text
tool.execute.before
  Authorize or deny tool calls before execution.

tool.execute.after
  Record command results and tool outcomes.

file.edited
  Record touched files and check allowlists.

todo.updated
  Sync visible task progress when useful.

session.idle
  Attempt validation and next-phase prompt injection.

tui.command.execute
  Intercept workflow commands.

tui.prompt.append
  Add phase-specific instruction context.

permission.asked and permission.replied
  Audit approval events.
```

### 5.2 Custom tools

Custom tools should expose safe workflow operations. They may also shadow or replace built-in tools where needed to impose restrictions.

Recommended wrappers:

```text
workflow_bash
  Restricted shell wrapper. Only allowed commands execute.

workflow_edit
  Restricted edit wrapper. Only active task files can be changed.

workflow_write_artifact
  Artifact writer. Only current phase artifacts can be written.

workflow_git
  Git wrapper. Only approved git actions can execute in valid finalization phases.
```

### 5.3 Commands

Commands should provide human-facing entry points.

```text
/workflow <goal>
  Start a new governed workflow.

/workflow-status
  Show current state, blockers, task, and next action.

/workflow-resume
  Resume from trusted memory, validate artifacts, and reinstall phase permissions.

/workflow-memory
  Show trusted memory summary, ledger health, and active workflow identity.

/workflow-conflict-report
  Explain memory, artifact, ledger, or git mismatches.

/workflow-abort <reason>
  Abort while preserving artifacts and audit logs.

/workflow-amend <reason>
  Start a spec or plan amendment flow.

/workflow-finalize
  Run final checks and finalization policy.
```

### 5.4 Agents

The plugin should define or assume phase-specific agents.

```text
workflow-orchestrator
  Primary controller-facing agent. No direct source edits.

wf-brainstormer
  Creates brainstorm artifact.

wf-spec-writer
  Writes product and design specs.

wf-spec-critic
  Produces structured critique.

wf-planner
  Produces implementation plan.

wf-plan-critic
  Produces structured plan critique.

wf-task-maker
  Produces task JSON.

wf-coder
  Executes active task only.

wf-verifier
  Runs verification and interprets results.

wf-final-reviewer
  Performs final alignment review.
```

Agent prompts are guidance. Tool policy remains the enforcement authority.

## 6. Finite state machine

### 6.1 State object

Example trusted state:

```json
{
  "workflow_id": "wf-20260424-001",
  "goal": "Build the requested feature",
  "phase": "SPEC_DRAFT",
  "branch": "workflow/wf-20260424-001",
  "worktree": ".worktrees/wf-20260424-001",
  "base_branch": "main",
  "active_task_id": null,
  "frozen": {
    "spec": false,
    "plan": false
  },
  "loops": {
    "spec_critique": 0,
    "plan_critique": 0
  },
  "gates": {
    "spec_passed": false,
    "plan_passed": false,
    "tasks_passed": false,
    "integration_passed": false,
    "final_review_passed": false
  },
  "artifact_hashes": {},
  "last_event_id": 42,
  "memory": {
    "authority": "external_sqlite",
    "ledger_hash": "sha256...",
    "repo_fingerprint": "sha256...",
    "last_resumed_at": "2026-04-24T12:00:00-04:00"
  }
}
```

### 6.2 Allowed transitions

| Current phase | Allowed next phases |
|---|---|
| INIT | DISCOVER, BLOCKED |
| DISCOVER | BRAINSTORM, BLOCKED |
| BRAINSTORM | SPEC_DRAFT, BLOCKED |
| SPEC_DRAFT | SPEC_CRITIQUE, BLOCKED |
| SPEC_CRITIQUE | SPEC_REVISION, SPEC_FREEZE, BLOCKED |
| SPEC_REVISION | SPEC_CRITIQUE, BLOCKED |
| SPEC_FREEZE | PLAN_DRAFT, BLOCKED |
| PLAN_DRAFT | PLAN_CRITIQUE, BLOCKED |
| PLAN_CRITIQUE | PLAN_REVISION, PLAN_FREEZE, BLOCKED |
| PLAN_REVISION | PLAN_CRITIQUE, BLOCKED |
| PLAN_FREEZE | TASK_ATOMIZATION, BLOCKED |
| TASK_ATOMIZATION | TASK_EXECUTION, BLOCKED |
| TASK_EXECUTION | TASK_VERIFICATION, TASK_REPAIR, BLOCKED |
| TASK_VERIFICATION | TASK_EXECUTION, INTEGRATION_VERIFICATION, TASK_REPAIR, BLOCKED |
| INTEGRATION_VERIFICATION | FINAL_REVIEW, TASK_REPAIR, PLAN_REPAIR, BLOCKED |
| FINAL_REVIEW | COMMIT, TASK_REPAIR, PLAN_REPAIR, SPEC_AMENDMENT_REQUEST, BLOCKED |
| COMMIT | PUSH_OR_MERGE, BLOCKED |
| PUSH_OR_MERGE | DONE, BLOCKED |
| BLOCKED | Previous safe phase, ABORTED |
| MEMORY_CONFLICT | RESTORE, ABORTED, human approved repair phase |

## 7. Memory architecture

### 7.1 Source of truth

The recommended source of truth is an external local SQLite database stored outside the model-writable worktree, for example:

```text
~/.local/share/opencode-workflow-kernel/state.db
```

The database owns:

```text
workflow ID
repo fingerprint
worktree path
branch
current phase
active task
loop counts
gate status
artifact hashes
locks
last event hash
resume metadata
```

### 7.2 Visible workflow memory

The repository contains human-readable workflow output:

```text
.workflow/artifacts/**
.workflow/tasks/**
.workflow/verification/**
.workflow/audit/events.jsonl
.workflow/audit/violations.jsonl
```

These files explain the workflow, but they do not authorize state transitions by themselves.

### 7.3 Append-only ledger

Every controller decision creates a ledger event. Events are ordered and hash chained.

Ledger events include:

```text
sequence number
timestamp
workflow ID
event type
actor
phase before and after
artifact hashes
previous event hash
current event hash
```

### 7.4 Resume handshake

On startup or `/workflow-resume`, the kernel must:

```text
1. Identify the repository and worktree.
2. Find active workflow records for that repo fingerprint.
3. Load authoritative memory.
4. Validate worktree path and branch.
5. Validate frozen artifact hashes.
6. Validate last ledger hash.
7. Check git status against active task policy.
8. Reinstall phase permissions.
9. Inject the recovered phase contract.
10. Refuse unrelated actions until recovery passes.
```

### 7.5 Conflict mode

If memory cannot be reconciled, the workflow enters `MEMORY_CONFLICT`.

Allowed in conflict mode:

```text
read status
inspect git status
inspect artifacts
produce conflict report
request restore
request abort
request human override
```

Denied in conflict mode:

```text
source edits
phase advancement
task completion
commit
push
state mutation by model
```

## 8. Phase behavior

### 8.1 Discover

Purpose: inspect repository shape and constraints without changing source files.

Allowed writes:

- `.workflow/artifacts/discovery.md`

Blocked:

- Source edits.
- Arbitrary shell mutation.
- Git commit or push.

### 8.2 Brainstorm

Purpose: generate solution directions, risks, options, and scope boundaries.

Allowed writes:

- `.workflow/artifacts/brainstorm.md`

Gate:

- Must include at least three solution options unless the problem is trivially constrained.
- Must include risks and non-goals.

### 8.3 Spec draft

Purpose: produce product spec and design spec.

Allowed writes:

- `.workflow/artifacts/product-spec.md`
- `.workflow/artifacts/design-spec.md`

Gate:

- Must include testable acceptance criteria.
- Must include target files or modules if known.
- Must include non-goals.

### 8.4 Spec critique and revision

Purpose: attack the spec until blockers are removed.

Allowed writes:

- `.workflow/artifacts/spec-critique.json`
- Revised spec files during revision only.

Gate:

- Blocker count equals zero.
- Required scores meet threshold.
- Loop count has not exceeded max.

### 8.5 Plan draft and critique

Purpose: produce and validate implementation plan.

Allowed writes:

- `.workflow/artifacts/plan.md`
- `.workflow/artifacts/plan-critique.json`

Gate:

- Plan is sequenced.
- Tasks are decomposable.
- Verification is defined.
- Dependencies are explicit.

### 8.6 Task atomization

Purpose: produce task JSON files.

Allowed writes:

- `.workflow/tasks/*.json`

Gate:

- Every task has required fields.
- Every task has verification.
- Every task has bounded allowed files.

### 8.7 Execution and verification

Purpose: implement active task and verify result.

Allowed writes:

- Source files in active task allowlist.
- Verification artifact for active task.

Gate:

- Required verification passes.
- Git diff matches task boundaries.
- No unauthorized files changed.

### 8.8 Final review and finalization

Purpose: prove complete workflow alignment and land the change.

Gate:

- All tasks pass.
- Integration verification passes.
- Final review passes.
- Git status is expected.
- Commit policy passes.
- Push or merge policy passes.

## 9. Git worktree workflow

### 9.1 Initialization

```text
1. Verify repository exists.
2. Verify base branch policy.
3. Create workflow branch.
4. Create worktree path.
5. Start OpenCode workflow in worktree context.
```

### 9.2 Finalization modes

```text
branch-push
  Commit workflow branch and push it for review.

pull-request
  Commit workflow branch, push it, and create or instruct creation of a PR.

direct-main
  Merge or push directly to main only when explicit policy allows it.
```

Recommended default: branch-push or pull-request. Direct push to main should require explicit opt-in.

## 10. Policy configuration

Example policy:

```json
{
  "workflowKernel": {
    "defaultDecision": "deny",
    "maxLoops": {
      "specCritique": 3,
      "planCritique": 3,
      "taskRepair": 2
    },
    "finalization": {
      "mode": "branch-push",
      "directMainAllowed": false,
      "requireCleanStatus": true,
      "requireIntegrationVerification": true,
      "requireFinalReview": true
    },
    "models": {
      "brainstorm": "medium",
      "specCritique": "strong",
      "planCritique": "strong",
      "taskExecution": "cheap",
      "finalReview": "strong"
    },
    "shell": {
      "allowRawShellForLowTrust": false,
      "allowedInspectionCommands": [
        "git status",
        "git diff",
        "git diff --stat"
      ]
    },
    "memory": {
      "authority": "external_sqlite",
      "ledger": "append_only_hash_chain",
      "gitCheckpoints": true,
      "enterConflictModeOnMismatch": true
    }
  }
}
```

## 11. Runtime decision examples

### 11.1 Source edit during planning

Input:

```text
Tool: edit
Path: src/app.ts
Current phase: PLAN_DRAFT
```

Decision:

```json
{
  "decision": "deny",
  "reason": "Source edits are not allowed during PLAN_DRAFT"
}
```

### 11.2 Allowed artifact write

Input:

```text
Tool: workflow_write_artifact
Path: .workflow/artifacts/plan.md
Current phase: PLAN_DRAFT
```

Decision:

```json
{
  "decision": "allow",
  "reason": "PLAN_DRAFT may write plan artifact"
}
```

### 11.3 Active task file edit

Input:

```text
Tool: workflow_edit
Path: src/state.ts
Current phase: TASK_EXECUTION
Active task allowed files: src/state.ts, src/state.test.ts
```

Decision:

```json
{
  "decision": "allow",
  "reason": "Path is inside active task allowlist"
}
```

### 11.4 Premature git push

Input:

```text
Tool: workflow_git
Command: git push origin main
Current phase: TASK_EXECUTION
```

Decision:

```json
{
  "decision": "deny",
  "reason": "Push is unavailable before finalization"
}
```

## 12. Design caveat

No plugin can guarantee non-escape if the model has uncontrolled access to a shell, writable plugin files, writable configuration, credentials, or an external process that bypasses the plugin. The product guarantee applies inside the controlled tool perimeter. For high-assurance use, the plugin must be paired with environment controls such as read-only trusted directories, restricted shell wrappers, branch protection, and CI verification.
