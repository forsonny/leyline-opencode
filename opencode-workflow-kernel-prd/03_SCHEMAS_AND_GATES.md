# Schemas and Gates

Document status: Draft v0.2  
Prepared on: 2026-04-24  
Product: OpenCode Workflow Kernel

## 1. Purpose

This document defines the structured artifacts and validation gates that the Workflow Kernel uses to prevent LLMs from skipping phases, inventing completion, or producing vague work products.

Every phase must produce an artifact. Every artifact must validate. Every transition must pass a gate.

## 2. Validation philosophy

The model may write prose, but the controller needs structured proof. Therefore, high-risk phase outputs should use JSON or Markdown plus a machine-readable summary block.

Recommended policy:

```text
Brainstorm: Markdown with required headings
Product spec: Markdown with required headings
Design spec: Markdown with required headings
Critique: JSON
Plan: Markdown with task outline table
Plan critique: JSON
Tasks: JSON
Verification: JSON
Final review: JSON plus final report Markdown
```

## 3. Brainstorm artifact

Path:

```text
.workflow/artifacts/brainstorm.md
```

Required headings:

```text
# Brainstorm
## User Goal
## Repository Context
## Candidate Approaches
## Recommended Direction
## Risks
## Non-Goals
## Questions
```

Gate:

- User goal is restated.
- Repository context is included.
- At least two candidate approaches are considered unless the issue is obviously constrained.
- Recommended direction is justified.
- Risks are listed.
- Non-goals are listed.
- Open questions are either answered, deferred, or marked as blockers.

## 4. Product spec artifact

Path:

```text
.workflow/artifacts/product-spec.md
```

Required headings:

```text
# Product Specification
## Problem
## Users
## Goals
## Non-Goals
## User Stories
## Functional Requirements
## Acceptance Criteria
## Edge Cases
## Risks
## Open Questions
```

Gate:

- Problem is clear.
- Goals are bounded.
- Non-goals are explicit.
- Functional requirements are numbered.
- Acceptance criteria are pass or fail statements.
- Open questions do not contain unresolved blockers.

## 5. Design spec artifact

Path:

```text
.workflow/artifacts/design-spec.md
```

Required headings:

```text
# Design Specification
## Overview
## Current System Assumptions
## Proposed Architecture
## Affected Files or Modules
## Data Structures
## Control Flow
## Error Handling
## Security and Privacy Considerations
## Testing Strategy
## Rollback Strategy
## Design Alternatives Considered
```

Gate:

- Architecture is tied to the product spec.
- Affected files or modules are identified when possible.
- Error handling is described.
- Security and privacy considerations are considered.
- Testing strategy is specific.
- Rollback strategy is present.

## 6. Spec critique schema

Path:

```text
.workflow/artifacts/spec-critique.json
```

Schema:

```json
{
  "phase": "SPEC_CRITIQUE",
  "result": "pass",
  "summary": "string",
  "blockers": [
    {
      "id": "B1",
      "area": "acceptance_criteria",
      "problem": "string",
      "required_fix": "string"
    }
  ],
  "major_issues": [
    {
      "id": "M1",
      "area": "scope",
      "problem": "string",
      "recommended_fix": "string"
    }
  ],
  "minor_issues": [
    {
      "id": "m1",
      "area": "wording",
      "problem": "string",
      "recommended_fix": "string"
    }
  ],
  "scores": {
    "problem_clarity": 2,
    "scope_control": 2,
    "acceptance_testability": 2,
    "design_feasibility": 2,
    "risk_coverage": 2,
    "verification_readiness": 2
  },
  "required_revisions": ["string"]
}
```

Allowed values:

```text
result: pass, fail
score values: 0, 1, 2
```

Gate:

- `result` must be `pass`.
- `blockers` must be empty.
- Every score must be at least 1.
- Total score must be at least 10 out of 12.
- Required revisions must be empty or marked complete.

If gate fails:

```text
SPEC_CRITIQUE -> SPEC_REVISION
```

If loop count exceeds max:

```text
SPEC_CRITIQUE -> BLOCKED
```

## 7. Plan artifact

Path:

```text
.workflow/artifacts/plan.md
```

Required headings:

```text
# Implementation Plan
## Summary
## Preconditions
## Task Sequence
## Dependencies
## Verification Strategy
## Rollback Strategy
## Risks
## Out of Scope
```

Task sequence table columns:

```text
Task ID
Title
Objective
Files or Modules
Dependencies
Verification
Risk Level
```

Gate:

- Task sequence is ordered.
- Dependencies are explicit.
- Verification strategy is present.
- Rollback strategy is present.
- No task is vague enough to mean "implement everything."

## 8. Plan critique schema

Path:

```text
.workflow/artifacts/plan-critique.json
```

Schema:

```json
{
  "phase": "PLAN_CRITIQUE",
  "result": "pass",
  "summary": "string",
  "blockers": [],
  "major_issues": [],
  "minor_issues": [],
  "scores": {
    "task_atomicity": 2,
    "sequencing": 2,
    "dependency_clarity": 2,
    "verification_quality": 2,
    "rollback_quality": 2,
    "risk_control": 2
  },
  "required_revisions": []
}
```

Gate:

- `result` must be `pass`.
- `blockers` must be empty.
- Every score must be at least 1.
- Total score must be at least 10 out of 12.
- No task lacks verification.

## 9. Task schema

Path pattern:

```text
.workflow/tasks/001-task.json
```

Schema:

```json
{
  "id": "001",
  "title": "Add workflow state schema",
  "status": "pending",
  "risk_level": "medium",
  "objective": "Create the persistent workflow state representation.",
  "allowed_files": [
    "src/state.ts",
    "src/state.test.ts"
  ],
  "forbidden_files": [
    ".opencode/**",
    ".workflow/state/**"
  ],
  "dependencies": [],
  "preconditions": [
    "spec is frozen",
    "plan is frozen"
  ],
  "steps": [
    "Define WorkflowState type",
    "Define Phase enum",
    "Add state validation helper"
  ],
  "acceptance": [
    "Invalid phase names are rejected",
    "Valid workflow state can be parsed and validated"
  ],
  "verification": [
    {
      "type": "command",
      "command": "bun test src/state.test.ts",
      "required": true
    },
    {
      "type": "command",
      "command": "bun run typecheck",
      "required": true
    }
  ],
  "rollback": "Revert files listed in allowed_files."
}
```

Allowed task status values:

```text
pending
active
blocked
repairing
verified
complete
skipped
```

Gate:

- ID is unique and ordered.
- Title is specific.
- Objective is one bounded outcome.
- Allowed files are present and not overly broad.
- Forbidden files include trusted control paths.
- Acceptance criteria are pass or fail.
- Verification is present.
- Rollback is present.

Rejection examples:

```text
Invalid objective: Implement the plugin.
Invalid allowed_files: **/*
Invalid verification: Check that it works.
```

## 10. Verification schema

Path pattern:

```text
.workflow/verification/001-verification.json
```

Schema:

```json
{
  "task_id": "001",
  "result": "pass",
  "started_at": "2026-04-24T10:00:00-04:00",
  "completed_at": "2026-04-24T10:02:15-04:00",
  "commands": [
    {
      "command": "bun test src/state.test.ts",
      "exit_code": 0,
      "summary": "All state tests passed.",
      "stdout_excerpt": "string",
      "stderr_excerpt": "string"
    }
  ],
  "changed_files": [
    "src/state.ts",
    "src/state.test.ts"
  ],
  "unauthorized_changes": [],
  "acceptance_results": [
    {
      "criterion": "Invalid phase names are rejected",
      "result": "pass",
      "evidence": "Unit test covers invalid phase names."
    }
  ],
  "notes": "string"
}
```

Gate:

- Result must be `pass`.
- Required command exit codes must be zero.
- Unauthorized changes must be empty.
- Every acceptance criterion must have evidence.
- Changed files must be within allowed files unless policy grants exception.

## 11. Integration verification schema

Path:

```text
.workflow/verification/integration-verification.json
```

Schema:

```json
{
  "result": "pass",
  "commands": [],
  "git_status_summary": "clean except expected workflow artifacts",
  "diff_summary": "string",
  "spec_alignment": "pass",
  "plan_alignment": "pass",
  "known_limitations": [],
  "remaining_risks": []
}
```

Gate:

- Result must be `pass`.
- Required commands pass.
- Changed files match completed tasks.
- No unexpected protected files changed.
- Remaining risks are acceptable or explicitly approved.

## 12. Final review schema

Path:

```text
.workflow/verification/final-review.json
```

Schema:

```json
{
  "result": "pass",
  "reviewer_model": "configured-strong-model",
  "summary": "string",
  "spec_alignment": {
    "result": "pass",
    "notes": "string"
  },
  "plan_completion": {
    "result": "pass",
    "notes": "string"
  },
  "verification_quality": {
    "result": "pass",
    "notes": "string"
  },
  "risk_assessment": {
    "result": "pass",
    "remaining_risks": []
  },
  "commit_readiness": "ready"
}
```

Gate:

- Result must be `pass`.
- All subsections must pass.
- Commit readiness must be `ready`.

## 13. Final report artifact

Path:

```text
.workflow/artifacts/final-report.md
```

Required headings:

```text
# Final Report
## User Goal
## Final Outcome
## Spec Summary
## Plan Summary
## Tasks Completed
## Files Changed
## Verification Performed
## Risks and Caveats
## Commit Information
## Finalization Mode
```

Gate:

- Includes all completed tasks.
- Includes verification summary.
- Includes finalization mode.
- Includes commit hash after commit.
- Includes push or merge result when applicable.

## 14. Gate summary

| Gate | Required proof | Blocks until |
|---|---|---|
| Brainstorm complete | Required headings present | Brainstorm artifact valid |
| Spec freeze | Spec critique passes | Blockers removed |
| Plan freeze | Plan critique passes | Plan validated |
| Task start | Valid task JSON | Dependencies complete |
| Task complete | Verification JSON passes | Commands and acceptance pass |
| Integration complete | Integration verification passes | Full change set verified |
| Commit enabled | Final review passes | Commit readiness ready |
| Push enabled | Finalization policy passes | Commit exists and policy allows |

## 15. Severity definitions

```text
BLOCKER
  Must be fixed before phase can advance.

MAJOR
  Should be fixed before phase can advance unless explicitly waived by policy.

MINOR
  Does not block by default.

NOTE
  Informational only.
```

## 16. Loop control

Default loop limits:

```json
{
  "specCritiqueMaxLoops": 3,
  "planCritiqueMaxLoops": 3,
  "taskRepairMaxLoops": 2
}
```

Behavior:

- Loop within limit: revise and re-critique.
- Loop exceeded: enter blocked state.
- Human override: optional and audited.

## 17. Amendment flow

Execution may discover that the frozen spec or plan is wrong. The model must not silently mutate frozen artifacts.

Required amendment phases:

```text
SPEC_AMENDMENT_REQUEST
SPEC_AMENDMENT_CRITIQUE
PLAN_REPAIR
TASK_REGENERATION
```

Amendment gate:

- Amendment reason is recorded.
- Changed spec or plan sections are identified.
- Strong model or human review approves the amendment.
- Affected tasks are regenerated or repaired.
- Artifact hashes are updated by the trusted state manager.


## 18. Memory state schema

The authoritative memory record should live in the external local memory store. The following schema describes the canonical shape even if the storage layer is SQLite.

```json
{
  "version": "1.0.0",
  "workflow_id": "wf_20260424_abc123",
  "authority": "external_sqlite",
  "repo_fingerprint": {
    "remote_url_hash": "sha256...",
    "repo_root_hash": "sha256...",
    "base_branch": "main"
  },
  "worktree": {
    "path": "/repo/.worktrees/wf_20260424_abc123",
    "branch": "workflow/wf_20260424_abc123"
  },
  "phase": {
    "current": "PLAN_CRITIQUE",
    "previous": "PLAN_DRAFT",
    "entered_at": "2026-04-24T12:00:00-04:00"
  },
  "active_task": null,
  "loops": {
    "spec_critique": 2,
    "plan_critique": 1,
    "task_repair": 0
  },
  "gates": {
    "spec_passed": true,
    "plan_passed": false,
    "tasks_passed": false,
    "integration_passed": false,
    "final_review_passed": false
  },
  "frozen_artifacts": {
    "product_spec": {
      "path": ".workflow/artifacts/product-spec.md",
      "sha256": "sha256..."
    },
    "design_spec": {
      "path": ".workflow/artifacts/design-spec.md",
      "sha256": "sha256..."
    }
  },
  "locks": {
    "spec_locked": true,
    "plan_locked": false,
    "git_push_locked": true
  },
  "last_event_hash": "sha256..."
}
```

Gate:

- Workflow ID is present and unique.
- Repo fingerprint matches the current repository.
- Worktree path exists unless recovery mode is active.
- Current phase is valid.
- Active task is valid for execution and verification phases.
- Frozen artifact hashes match disk content.
- Lock values match phase and gate state.

## 19. Memory event ledger schema

Path or storage:

```text
.workflow/audit/events.jsonl
external memory event table
```

Each event must be append-only and hash chained.

```json
{
  "sequence": 17,
  "timestamp": "2026-04-24T12:31:00-04:00",
  "workflow_id": "wf_20260424_abc123",
  "event": "PHASE_ADVANCED",
  "actor": "workflow-kernel",
  "from_phase": "SPEC_CRITIQUE",
  "to_phase": "SPEC_REVISION",
  "reason": "Critique found blockers",
  "artifact_hashes": {
    "spec_critique": "sha256..."
  },
  "previous_event_hash": "sha256...",
  "event_hash": "sha256..."
}
```

Gate:

- Sequence numbers are contiguous.
- Previous hash matches the prior event.
- Event hash validates.
- Event type is recognized.
- Phase transition events match the finite state machine.

## 20. Resume gate

Resume can continue only when:

```text
trusted memory exists
repo fingerprint matches
worktree and branch match
current phase is valid
frozen artifact hashes match
ledger hash validates
git status is compatible with current phase and active task
phase permissions have been reinstalled
```

If any required check fails:

```text
enter MEMORY_CONFLICT
```

## 21. Memory conflict report schema

Path:

```text
.workflow/audit/memory-conflict-report.json
```

Schema:

```json
{
  "result": "conflict",
  "detected_at": "2026-04-24T12:35:00-04:00",
  "workflow_id": "wf_20260424_abc123",
  "conflicts": [
    {
      "type": "artifact_hash_mismatch",
      "expected": "sha256...",
      "actual": "sha256...",
      "path": ".workflow/artifacts/plan.md",
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

Gate:

- Conflict type is specific.
- Expected and actual values are recorded when applicable.
- Recovery actions are limited by policy.
- Human override requires an audit event.
