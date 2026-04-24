import { artifactPaths, requiredHeadings } from "./artifacts"
import type { Phase, WorkflowRecord } from "./types"

const universal = `You are operating inside OpenCode Workflow Kernel.

The Workflow Kernel controls memory, phase, tools, files, commands, verification, commit, and push.
You do not control workflow state or workflow memory.
You do not decide when a phase is complete.
You may only produce the required output for the current phase.
Unauthorized tool calls will be rejected.

Do not skip phases.
Do not implement unless the current phase is TASK_EXECUTION.
Do not edit source files unless the active task explicitly allows them.
Do not commit.
Do not push.
Do not modify workflow policy, trusted state, workflow memory, plugin files, OpenCode config, or git internals.`

export const continuationInstruction = `Continuation mode:
When the active user request is to start, resume, or continue a workflow, keep executing the current phase contract and any returned next_actions immediately.
Treat next_actions as instructions to perform, not status text to report.
If a workflow tool returns ok:false with recovery_actions, perform those recovery actions once and retry the blocked step.
Stop only when the workflow reaches DONE, ABORTED, BLOCKED, MEMORY_CONFLICT, a workflow tool returns ok:false without recovery_actions, the same recovery fails again, policy denies an action, or user input is required.`

function headingsRequirement(path: string, headings: string[]) {
  return `Artifact requirements for ${path}:
Use these headings exactly, each on its own line:
${headings.map((heading) => `- ${heading}`).join("\n")}`
}

function critiqueRequirement(path: string, phase: "SPEC_CRITIQUE" | "PLAN_CRITIQUE") {
  return `Artifact requirements for ${path}:
Write a JSON object with these fields:
- phase: "${phase}"
- result: "pass" or "fail"
- summary: non-empty string
- blockers: array
- major_issues: array
- minor_issues: array
- scores: object whose values are integers from 0 to 2
- required_revisions: array
Gate pass requires result "pass", no blockers, every score at least 1, and total score at least 10.`
}

function taskRequirement() {
  return `Task artifact requirements for .workflow/tasks/*.json:
Create tasks only with workflow_create_task. Each task must include id, title, status, risk_level, objective, allowed_files, forbidden_files, dependencies, preconditions, steps, acceptance, verification, and rollback. Keep allowed_files narrow.`
}

function integrationRequirement() {
  return `Artifact requirements for ${artifactPaths.integrationVerification}:
Write a JSON object with result, commands, git_status_summary, diff_summary, spec_alignment, plan_alignment, known_limitations, and remaining_risks. Gate pass requires result, spec_alignment, and plan_alignment to be "pass".`
}

function finalReviewRequirement() {
  return `${headingsRequirement(artifactPaths.finalReport, requiredHeadings.finalReport)}

Artifact requirements for ${artifactPaths.finalReview}:
Write a JSON object with result, reviewer_model, summary, spec_alignment, plan_completion, verification_quality, risk_assessment, and commit_readiness. Gate pass requires result "pass", commit_readiness "ready", and each subsection result "pass".`
}

export function phaseRequirement(phase: Phase) {
  switch (phase) {
    case "DISCOVER":
      return headingsRequirement(artifactPaths.discovery, requiredHeadings.discovery)
    case "BRAINSTORM":
      return headingsRequirement(artifactPaths.brainstorm, requiredHeadings.brainstorm)
    case "SPEC_DRAFT":
    case "SPEC_REVISION":
      return `${headingsRequirement(artifactPaths.productSpec, requiredHeadings.productSpec)}

${headingsRequirement(artifactPaths.designSpec, requiredHeadings.designSpec)}`
    case "SPEC_CRITIQUE":
      return critiqueRequirement(artifactPaths.specCritique, "SPEC_CRITIQUE")
    case "PLAN_DRAFT":
    case "PLAN_REVISION":
      return headingsRequirement(artifactPaths.plan, requiredHeadings.plan)
    case "PLAN_CRITIQUE":
      return critiqueRequirement(artifactPaths.planCritique, "PLAN_CRITIQUE")
    case "TASK_ATOMIZATION":
    case "TASK_REGENERATION":
      return taskRequirement()
    case "INTEGRATION_VERIFICATION":
      return integrationRequirement()
    case "FINAL_REVIEW":
      return finalReviewRequirement()
    default:
      return "No artifact schema is required for this phase. Follow the phase contract."
  }
}

const contracts: Record<Phase, string> = {
  INIT: "Current phase: INIT. Start or recover the workflow through workflow_start or workflow_status only.",
  DISCOVER: "Current phase: DISCOVER. Inspect repository context and write .workflow/artifacts/discovery.md with the required Discovery headings. Do not edit source files.",
  BRAINSTORM: "Current phase: BRAINSTORM. Write .workflow/artifacts/brainstorm.md with candidate approaches, recommendation, risks, non-goals, and questions. Do not plan or implement.",
  SPEC_DRAFT: "Current phase: SPEC_DRAFT. Write .workflow/artifacts/product-spec.md and .workflow/artifacts/design-spec.md. Do not create tasks or edit source files.",
  SPEC_CRITIQUE: "Current phase: SPEC_CRITIQUE. Write .workflow/artifacts/spec-critique.json using the required critique schema. Do not edit specs or source files.",
  SPEC_REVISION: "Current phase: SPEC_REVISION. Revise only the product and design specs to address critique findings.",
  SPEC_FREEZE: "Current phase: SPEC_FREEZE. The controller is freezing spec artifacts. Request advancement to PLAN_DRAFT after the freeze is recorded.",
  PLAN_DRAFT: "Current phase: PLAN_DRAFT. Write .workflow/artifacts/plan.md from frozen specs. Do not create task JSON or edit source files.",
  PLAN_CRITIQUE: "Current phase: PLAN_CRITIQUE. Write .workflow/artifacts/plan-critique.json using the required critique schema. Do not edit the plan.",
  PLAN_REVISION: "Current phase: PLAN_REVISION. Revise only .workflow/artifacts/plan.md to address plan critique findings.",
  PLAN_FREEZE: "Current phase: PLAN_FREEZE. The controller is freezing the plan. Request advancement to TASK_ATOMIZATION after the freeze is recorded.",
  TASK_ATOMIZATION: "Current phase: TASK_ATOMIZATION. Create bounded .workflow/tasks/*.json files. Do not implement tasks.",
  TASK_EXECUTION: "Current phase: TASK_EXECUTION. Implement only the active task and only files listed in active task allowed_files.",
  TASK_VERIFICATION: "Current phase: TASK_VERIFICATION. Run approved verification and record .workflow/verification/<task-id>-verification.json. Do not edit source files.",
  INTEGRATION_VERIFICATION: "Current phase: INTEGRATION_VERIFICATION. Verify the whole completed task set and write .workflow/verification/integration-verification.json.",
  FINAL_REVIEW: "Current phase: FINAL_REVIEW. Review spec alignment, plan completion, verification quality, changed files, and risks. Write final-review.json and final-report.md.",
  COMMIT: "Current phase: COMMIT. Request workflow_finalize to create the authorized commit. Do not run raw git commit.",
  PUSH_OR_MERGE: "Current phase: PUSH_OR_MERGE. Request finalization according to policy. Do not override direct-main safety policy.",
  DONE: "Current phase: DONE. Workflow is complete. Do not mutate workflow state.",
  BLOCKED: "Current phase: BLOCKED. Explain the blocker and required recovery action. Do not edit source files.",
  MEMORY_CONFLICT: "Current phase: MEMORY_CONFLICT. Inspect and report the conflict only. Do not edit source, advance phase, commit, or push.",
  SPEC_AMENDMENT_REQUEST: "Current phase: SPEC_AMENDMENT_REQUEST. Record why frozen specs need amendment. Do not silently edit frozen specs.",
  SPEC_AMENDMENT_CRITIQUE: "Current phase: SPEC_AMENDMENT_CRITIQUE. Critique the amendment request and identify required controlled changes.",
  PLAN_REPAIR: "Current phase: PLAN_REPAIR. Repair the plan under controller authorization only.",
  TASK_REPAIR: "Current phase: TASK_REPAIR. Repair only the active failed task under controller authorization.",
  TASK_REGENERATION: "Current phase: TASK_REGENERATION. Regenerate affected task JSON after approved plan or spec changes.",
  ABORTED: "Current phase: ABORTED. Workflow is aborted. No workflow actions are allowed except starting a new workflow.",
}

export function phaseContract(workflow: WorkflowRecord) {
  return `${universal}

Recovered workflow: ${workflow.id}
Current phase: ${workflow.currentPhase}
Active task: ${workflow.activeTaskId ?? "none"}
Worktree: ${workflow.worktreePath}
Commit: denied unless current phase is COMMIT and final gates pass.
Push: denied unless current phase is PUSH_OR_MERGE and finalization policy allows it.

${continuationInstruction}

${phaseRequirement(workflow.currentPhase)}

${contracts[workflow.currentPhase]}`
}
