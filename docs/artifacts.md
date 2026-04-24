# Workflow Artifacts

The kernel validates structured artifacts before advancing phases.

## Paths

```text
.workflow/
  artifacts/
    discovery.md
    brainstorm.md
    product-spec.md
    design-spec.md
    spec-critique.json
    plan.md
    plan-critique.json
    final-report.md
  tasks/
    001-task.json
  verification/
    001-verification.json
    integration-verification.json
    final-review.json
  audit/
    events.jsonl
    violations.jsonl
    memory-conflict-report.json
```

## Important Rules

- `.workflow/audit/**` is protected from direct model writes.
- Frozen product spec, design spec, and plan hashes are stored in SQLite.
- If frozen artifact hashes change, resume enters `MEMORY_CONFLICT`.
- Task files with broad `allowed_files` such as `**/*` are rejected unless policy opts in.
- Verification evidence must include commands, exit codes, changed files, unauthorized changes, and acceptance results.

## Task Shape

```json
{
  "id": "001",
  "title": "Add workflow state schema",
  "status": "pending",
  "risk_level": "medium",
  "objective": "Create the persistent workflow state representation.",
  "allowed_files": ["src/state.ts", "src/state.test.ts"],
  "forbidden_files": [".opencode/**", ".workflow/audit/**"],
  "dependencies": [],
  "preconditions": ["spec is frozen", "plan is frozen"],
  "steps": ["Define WorkflowState type"],
  "acceptance": ["Invalid phase names are rejected"],
  "verification": [
    {
      "type": "command",
      "command": "bun test src/state.test.ts",
      "required": true
    }
  ],
  "rollback": "Revert files listed in allowed_files."
}
```
