# Product Requirements Document: OpenCode Workflow Kernel

Document status: Draft v0.2  
Prepared on: 2026-04-24  
Working product name: OpenCode Workflow Kernel  
Product type: OpenCode plugin and workflow harness  
Primary customer: Developers and teams using multiple LLMs inside OpenCode

## 1. Executive summary

OpenCode Workflow Kernel is a plugin that enforces a strict, phase-gated development workflow for LLM-assisted coding. It moves a task from brainstorm to product specification, design specification, self-critique, plan, plan critique, atomized execution, verification, final review, commit, and final push or merge.

The core product problem is not that LLMs fail to understand workflows. The core problem is that LLMs are probabilistic actors with access to side-effecting tools. A less capable model may assume, skip, summarize, overwrite, commit early, or treat critique as optional. Therefore, the plugin must act as a workflow governor. It must decide what is allowed, when it is allowed, and what proof is required before advancement.

The product should be designed around one rule:

```text
The LLM may propose work, but only the Workflow Kernel may authorize side effects and phase transitions.
```

## 2. Problem statement

OpenCode supports workflows involving different agents, models, tools, commands, plugins, and permissions. This creates powerful orchestration possibilities, but it also creates a reliability gap when lower-cost or less literal models are used for parts of the workflow.

A weaker model may:

- Begin implementation before a spec is complete.
- Treat brainstorming as planning.
- Treat planning as implementation.
- Rewrite the workflow state to mark itself complete.
- Ignore or soften critique.
- Create vague tasks that cannot be verified.
- Edit files outside the intended task boundary.
- Run broad shell commands that mutate the repository.
- Commit or push before final verification.
- Invent completion evidence.

Prompt instructions alone are not enough to prevent these failures. The workflow needs hard controls at the tool, file, command, state, and git layers.

## 3. Product vision

Create a deterministic workflow law for OpenCode sessions.

The plugin should let teams safely use cheaper models for constrained work while reserving stronger models for judgment-heavy phases. The weaker models should not need to infer the workflow. They should receive one narrow job at a time, and all unauthorized actions should be rejected by the plugin before they can affect the repository.

## 4. Goals

### 4.1 Primary goals

1. Enforce a fixed workflow from brainstorm through finalization.
2. Prevent LLMs from skipping phases or self-advancing without gate approval.
3. Prevent source edits before the execution phase.
4. Prevent edits outside the active task during execution.
5. Require structured artifacts for specification, design, critique, planning, tasks, verification, and final review.
6. Require deterministic validation of artifacts before phase transition.
7. Require verification evidence before task completion.
8. Use isolated git worktrees for implementation work.
9. Block commit and push until all final gates pass.
10. Support model routing so stronger models can be used for critique and final judgment while cheaper models handle constrained work.
11. Persist durable workflow memory so the plugin can resume correctly after the user ends, restarts, or switches sessions.

### 4.2 Secondary goals

1. Make the workflow auditable after completion.
2. Provide clear status and resume behavior backed by authoritative memory.
3. Support configurable team policies.
4. Support direct push, branch push, or pull request finalization modes.
5. Support safe recovery when the workflow encounters blockers.
6. Produce a final report that summarizes decisions, files changed, tests run, risks, and remaining caveats.

## 5. Non-goals

1. The plugin will not guarantee correctness of the generated software by itself.
2. The plugin will not make weak models reason like strong models.
3. The plugin will not bypass repository branch protection or CI policies.
4. The plugin will not permit arbitrary shell access for low-trust agents.
5. The plugin will not treat a model's statement of completion as proof.
6. The plugin will not rely on natural language prompts as the only control mechanism.
7. The plugin will not allow the model to edit trusted state, policy, or plugin source files during a workflow.

## 6. Users and personas

### 6.1 Solo developer

Wants a disciplined assistant that can take a feature idea from initial exploration to implementation without wandering or prematurely changing code.

### 6.2 Engineering team lead

Wants consistent AI-assisted development practices across a team, with clear artifacts, review gates, and auditable task evidence.

### 6.3 Cost-sensitive AI operator

Wants to use cheaper models for repetitive execution while maintaining strong control over workflow boundaries.

### 6.4 Security-conscious maintainer

Wants to prevent uncontrolled shell, git, file, and configuration mutations by LLM agents.

## 7. Key design principles

### 7.1 Prompts are advisory

Prompts tell the model what to do, but prompts must not be the source of authority.

### 7.2 Tools are constrained

The model must only be able to cause side effects through tools governed by the plugin.

### 7.3 State is trusted

Workflow state must be owned by the plugin, not by the LLM. The model can write proposed artifacts, but it cannot directly mutate the authoritative state machine.

### 7.4 Phase transitions are validated

A phase transition requires a valid artifact, a passing gate, and no policy violations.

### 7.5 Execution is task-scoped

Implementation happens one atomized task at a time. Each task has allowed files, forbidden files, acceptance criteria, verification commands, and rollback notes.

### 7.6 Verification is evidence-based

A task is not complete because the model says it is complete. A task is complete only when required checks run and evidence is recorded.

### 7.7 Git is a final safety boundary

Commit and push are blocked until workflow gates, verification gates, and final review gates pass.

## 8. Product scope

### 8.1 In scope

- OpenCode plugin package.
- Workflow-specific custom tools.
- Phase state machine.
- Artifact generation and validation.
- Critique loops with bounded retries.
- Task atomization.
- Task-scoped file edit enforcement.
- Command allowlist enforcement.
- Git worktree creation and cleanup policy.
- Commit and finalization policy.
- Status, resume, abort, and final report commands.
- Durable memory layer with external local SQLite as the source of truth.
- Append-only event ledger with hash chaining.
- Git checkpoint support for major workflow milestones.
- Model routing configuration.
- Audit log and violation log.

### 8.2 Out of scope for MVP

- Visual dashboard.
- Cross-repository orchestration.
- Parallel task execution.
- Remote sandbox provisioning.
- Full CI provider integration beyond command execution and optional finalization hooks.
- Automatic conflict resolution during merge to main.

## 9. Workflow overview

The required workflow is:

```text
INIT
DISCOVER
BRAINSTORM
SPEC_DRAFT
SPEC_CRITIQUE
SPEC_REVISION
SPEC_FREEZE
PLAN_DRAFT
PLAN_CRITIQUE
PLAN_REVISION
PLAN_FREEZE
TASK_ATOMIZATION
TASK_EXECUTION
TASK_VERIFICATION
INTEGRATION_VERIFICATION
FINAL_REVIEW
COMMIT
PUSH_OR_MERGE
DONE
```

The controller may insert failure or amendment phases when required:

```text
BLOCKED
SPEC_AMENDMENT_REQUEST
SPEC_AMENDMENT_CRITIQUE
PLAN_REPAIR
TASK_REPAIR
ABORTED
```

## 10. Required artifacts

The plugin must create and manage the following artifact layout:

```text
.workflow/
  artifacts/
    brainstorm.md
    product-spec.md
    design-spec.md
    spec-critique.json
    plan.md
    plan-critique.json
    decisions.md
    final-report.md
  tasks/
    001-task.json
    002-task.json
  verification/
    001-verification.json
    002-verification.json
    integration-verification.json
    final-review.json
  audit/
    events.jsonl
    violations.jsonl
```

The authoritative state must not be writable by the model. The recommended design uses external local SQLite as the source of truth, repo-local artifacts for human-readable output, an append-only event ledger for auditability, and git checkpoints for durable milestone recovery.

## 11. Functional requirements

### 11.1 Workflow initialization

The plugin must support a command that starts a new workflow from a user goal.

Acceptance criteria:

- The plugin creates a unique workflow ID.
- The plugin records the user goal.
- The plugin creates or selects a git worktree based on configuration.
- The plugin sets the first phase to `DISCOVER`.
- The plugin writes initial audit events.
- The model cannot change source files during initialization.

### 11.2 Git worktree isolation

The plugin must perform implementation work inside an isolated git worktree.

Acceptance criteria:

- The workflow branch name is deterministic and unique.
- The worktree path is recorded in trusted state.
- The plugin verifies the base branch before creating the worktree.
- The plugin refuses finalization if the worktree is dirty in unexpected ways.
- The plugin can preserve or clean up the worktree based on finalization policy.

### 11.3 Phase enforcement

The plugin must maintain a finite state machine with explicit allowed transitions.

Acceptance criteria:

- Each phase has one or more allowed next phases.
- Invalid transitions are rejected.
- The model cannot directly change the authoritative phase.
- Phase transition attempts are logged.
- Rejected transitions include a machine-readable reason.

### 11.4 Tool enforcement

The plugin must enforce tool access by phase.

Acceptance criteria:

- Tools are denied by default.
- Read-only phases cannot use source mutation tools.
- Planning and critique phases cannot execute arbitrary shell commands.
- Execution phases can only mutate files allowed by the active task.
- Finalization tools are unavailable until final gates pass.
- All denied tool attempts are logged.

### 11.5 Artifact enforcement

Each phase must produce the required artifact in the required shape.

Acceptance criteria:

- Missing required artifacts block phase advancement.
- Invalid artifact schemas block phase advancement.
- Artifacts must include required fields for their phase.
- Artifact hashes are recorded in audit state.
- Frozen artifacts cannot be changed without an amendment flow.

### 11.6 Spec critique loop

The product and design specs must pass a self-critique loop before freezing.

Acceptance criteria:

- Critique output uses machine-readable severity levels.
- Any blocker prevents spec freeze.
- Required rubric items must meet minimum scores.
- The loop has a configurable maximum retry count.
- If the loop limit is reached, the workflow enters `BLOCKED` or requires human approval.

### 11.7 Planning critique loop

The implementation plan must pass a planning critique loop before task atomization.

Acceptance criteria:

- Planning critique validates sequencing, scope, dependencies, task size, rollback, and verification.
- Any blocker prevents plan freeze.
- The loop has a configurable maximum retry count.
- The controller records plan version hashes.

### 11.8 Task atomization

The plugin must convert the frozen plan into atomized task files.

Acceptance criteria:

- Each task is a JSON object with required fields.
- Each task has a clear objective.
- Each task has allowed files and forbidden files.
- Each task has acceptance criteria.
- Each task has verification commands or manual verification criteria.
- Each task has rollback guidance.
- Tasks with broad, vague, or multi-feature objectives are rejected.

### 11.9 Task execution

The plugin must execute one active task at a time.

Acceptance criteria:

- Only one task can be active.
- Source edits are restricted to active task allowlists.
- Commands are restricted to active task verification and safe inspection commands.
- The model cannot mark a task complete without verification evidence.
- If unauthorized files are changed, task verification fails.

### 11.10 Verification

The plugin must run or require verification for each task and for the integrated change set.

Acceptance criteria:

- Verification commands and outputs are recorded.
- Failed verification blocks task completion.
- Integration verification is required after all tasks pass.
- Verification logs include command, exit code, timestamp, and summary.
- Manual verification entries require an explicit reason and reviewer identity if configured.

### 11.11 Final review

The plugin must perform final review before commit.

Acceptance criteria:

- Final review checks spec alignment, plan completion, task evidence, changed files, and remaining risks.
- Final review emits pass or fail.
- Failures return the workflow to a repair phase.
- Passing final review enables commit but not necessarily push.

### 11.12 Commit and finalization

The plugin must support controlled finalization.

Acceptance criteria:

- Commit is blocked until final review passes.
- Push or merge is blocked until commit exists and finalization policy allows it.
- Direct push to main is supported only when explicitly configured.
- Safer default is pushing a workflow branch for review.
- The plugin writes a final report before completion.

### 11.13 Status and resume

The plugin must support status and resume commands.

Acceptance criteria:

- Status reports current phase, active task, blockers, last violation, and next required action.
- Resume reloads trusted state and validates artifact hashes.
- Resume refuses to proceed if trusted state and artifact hashes conflict.

### 11.14 Memory adherence

The plugin must maintain durable workflow memory that survives OpenCode session closure, model switching, TUI restart, and user interruption.

Acceptance criteria:

- Authoritative workflow state is stored in an external local SQLite database or equivalent trusted local store outside model-writable paths.
- Repo-local workflow artifacts remain human-readable but are not the source of authority for current phase, active task, or gate status.
- Every state transition is recorded in an append-only event ledger.
- Ledger events include sequence number, timestamp, actor, event type, previous hash, current event hash, and relevant artifact hashes.
- Major workflow milestones create git checkpoints or commit-level markers when policy allows.
- On startup, the plugin identifies the active workflow, loads trusted state, validates artifact hashes, validates worktree and branch, reinstalls phase permissions, and injects the recovered phase contract.
- If memory and repository artifacts disagree, the plugin enters `MEMORY_CONFLICT` instead of continuing.

### 11.15 Memory conflict recovery

The plugin must detect and safely handle mismatches between trusted state, artifacts, event ledger, and git state.

Acceptance criteria:

- Artifact hash mismatch after freeze triggers `MEMORY_CONFLICT`.
- Missing trusted state triggers a recovery report and prevents uncontrolled continuation.
- Wrong branch or missing worktree triggers `MEMORY_CONFLICT`.
- Unexpected source edits outside the active task trigger `MEMORY_CONFLICT` or task repair, based on policy.
- In `MEMORY_CONFLICT`, the model can inspect status and produce a conflict report, but cannot edit source, advance phase, commit, or push.
- Human override, restore, abort, or controlled repair is audited.

### 11.16 Abort

The plugin must support a controlled abort.

Acceptance criteria:

- Abort preserves artifacts and audit logs.
- Abort records the reason.
- Abort does not delete the worktree unless configured.
- Abort prevents further workflow actions without explicit resume or restart.

## 12. Nonfunctional requirements

### 12.1 Reliability

- The plugin should fail closed.
- Missing policy means deny.
- Unknown phase means block.
- Unknown tool means deny.
- Missing artifact means block.

### 12.2 Security

- Low-trust models must not receive raw shell by default.
- The model must not be able to edit plugin code, OpenCode config, trusted state, git hooks, credentials, or policy files.
- The plugin must protect secret-bearing files from read access when configured.
- The plugin must log all denied action attempts.

### 12.3 Auditability

- All phase changes must be logged.
- All tool denials must be logged.
- All verification results must be logged.
- All artifact hashes must be logged.
- Memory restore and resume decisions must be logged.
- Memory conflicts and human overrides must be logged.
- Final report must be reproducible from audit artifacts.

### 12.4 Usability

- The user should be able to start with one command.
- The user should be able to inspect current status at any time.
- Blocking errors should be specific and actionable.
- The workflow should not require the user to understand the internal state machine.

### 12.5 Portability

- The plugin should support project-level installation and global installation.
- The plugin should use TypeScript for maintainability.
- The plugin should avoid hard dependency on a specific LLM provider.

## 13. Permissions and trust model

The product must assume three trust levels.

### 13.1 Trusted controller

The plugin code, trusted state manager, validators, policy files, and finalization logic.

### 13.2 Semi-trusted model output

Artifacts proposed by models, including specs, plans, critiques, and task JSON.

### 13.3 Untrusted side-effect attempts

Tool calls, shell commands, file edits, git actions, and state mutation attempts from models.

All side-effect attempts require controller authorization.

## 14. Model routing requirements

The plugin must support model routing by phase.

Suggested defaults:

| Phase | Recommended model class | Rationale |
|---|---|---|
| Brainstorm | Medium | Creative exploration with low side-effect risk |
| Spec draft | Medium | Structured writing with validation |
| Spec critique | Strong | Judgment-heavy and risk-sensitive |
| Spec revision | Medium | Bounded revision |
| Plan draft | Medium or strong | Depends on project complexity |
| Plan critique | Strong | Sequencing and risk judgment |
| Task atomization | Medium | Structured decomposition |
| Task execution | Cheap or medium | Narrow scope and hard allowlists |
| Verification interpretation | Medium or strong | Depends on failure complexity |
| Final review | Strong | Highest judgment requirement |

The controller must remain model-independent. No model may override policy.

## 15. User stories

### 15.1 Start a governed workflow

As a developer, I want to start a workflow from a natural language goal so that OpenCode can move through brainstorm, design, planning, and execution without skipping required gates.

Acceptance criteria:

- User can run a single workflow command with a goal.
- The plugin creates the workflow state and artifacts.
- The first model-visible task is discover or brainstorm, not implementation.

### 15.2 Use weaker models safely

As a cost-sensitive user, I want cheaper models to execute constrained tasks so that I can reduce cost without letting them alter the workflow.

Acceptance criteria:

- Cheaper models can only work on one active task.
- The plugin rejects out-of-scope edits.
- Completion requires verification evidence.

### 15.3 Freeze a spec before implementation

As a maintainer, I want the product and design specs frozen before implementation so that code changes are measured against a stable target.

Acceptance criteria:

- Implementation tools are unavailable before spec and plan freeze.
- Frozen artifacts cannot be silently edited.
- Amendments require a controlled workflow.

### 15.4 Prevent premature commit

As a team lead, I want commit and push blocked until all gates pass so that unfinished or unverified work cannot land.

Acceptance criteria:

- Commit before final review is denied.
- Push before final verification is denied.
- Direct push to main requires explicit configuration.

## 16. Success metrics

### 16.1 Product metrics

- Percentage of workflows completed without unauthorized action attempts.
- Percentage of workflows that produce all required artifacts.
- Percentage of tasks with verification evidence.
- Reduction in manual intervention compared to unguided LLM workflows.
- Number of blocked unauthorized actions per workflow.

### 16.2 Quality metrics

- Task verification pass rate.
- Final review pass rate.
- Rate of post-finalization defects caused by missed requirements.
- Rate of spec amendment during execution.

### 16.3 Cost metrics

- Percentage of execution tasks completed by lower-cost models.
- Cost per completed workflow.
- Strong-model usage concentrated in critique and final review phases.

## 17. Failure modes

| Failure mode | Expected behavior |
|---|---|
| Model tries to edit source during spec phase | Reject tool call and log violation |
| Model writes invalid task JSON | Reject task atomization and request repair |
| Model tries to edit file outside task allowlist | Reject edit and mark task as policy-violating |
| Model tries to run arbitrary shell | Reject unless command is allowed by policy |
| Verification fails | Keep task active or move to repair |
| Artifact hash changes after freeze | Enter memory conflict or blocked state |
| Git status has unexpected files | Block finalization |
| Direct push policy is not enabled | Push branch or stop before push |

## 18. Risks and mitigations

### 18.1 Raw shell bypass

Risk: If low-trust agents can run arbitrary shell, they can bypass file edit restrictions.

Mitigation: Deny raw shell by default. Replace shell access with workflow-specific wrappers and command allowlists.

### 18.2 State tampering

Risk: A model may edit state files to mark itself complete.

Mitigation: Store authoritative state outside model-writable paths or protect it through a plugin-owned state manager with hash validation.

### 18.3 Prompt drift

Risk: A model may ignore phase instructions.

Mitigation: Prompts are reinforced by tool enforcement. Ignoring the prompt does not grant capability.

### 18.4 Critique collapse

Risk: A weak critic may produce vague praise instead of useful critique.

Mitigation: Use structured rubrics, severity levels, minimum scores, and strong model routing for critique.

### 18.5 Infinite loops

Risk: The workflow may endlessly revise spec or plan.

Mitigation: Set max loop counts and move to blocked or human review after the cap.

### 18.6 False verification

Risk: A model may claim tests passed without running them.

Mitigation: The plugin records command execution output, exit code, and timestamps through controlled verification tools.

## 19. Open questions

1. Should direct push to main ever be a default option, or only an explicitly unsafe mode?
2. Should the plugin create pull requests directly, or stop after pushing the workflow branch?
3. Should artifact validators be strict JSON schemas, Markdown section validators, or both?
4. What SQLite schema and migration strategy should be used for the trusted local memory store?
5. Should the plugin support multiple concurrent workflows per repository?
6. Should a human approval gate be required after spec freeze for high-risk repos?
7. Should model routing be static by phase or dynamic based on task risk scoring?

## 20. MVP definition

The MVP is complete when the plugin can:

1. Start a workflow from a command.
2. Create a trusted workflow state in the external local memory store.
3. Record append-only memory events and recover from session restart.
4. Enforce the phase machine.
5. Produce and validate required spec and plan artifacts.
6. Run bounded critique loops.
7. Generate task JSON files.
8. Restrict source edits to active task allowlists.
9. Require verification evidence for each task.
10. Run final integration verification.
11. Block commit and push until final gates pass.
12. Produce a final report.

## 21. Final product statement

OpenCode Workflow Kernel is not a smarter prompt. It is a deterministic workflow governor for LLM-driven development. It lets models contribute work while preventing them from owning authority. The controller owns phase, policy, state, verification, and git finalization.
