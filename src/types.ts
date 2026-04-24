import { z } from "zod"

export const VERSION = "0.1.0"

export const phases = [
  "INIT",
  "DISCOVER",
  "BRAINSTORM",
  "SPEC_DRAFT",
  "SPEC_CRITIQUE",
  "SPEC_REVISION",
  "SPEC_FREEZE",
  "PLAN_DRAFT",
  "PLAN_CRITIQUE",
  "PLAN_REVISION",
  "PLAN_FREEZE",
  "TASK_ATOMIZATION",
  "TASK_EXECUTION",
  "TASK_VERIFICATION",
  "INTEGRATION_VERIFICATION",
  "FINAL_REVIEW",
  "COMMIT",
  "PUSH_OR_MERGE",
  "DONE",
  "BLOCKED",
  "MEMORY_CONFLICT",
  "SPEC_AMENDMENT_REQUEST",
  "SPEC_AMENDMENT_CRITIQUE",
  "PLAN_REPAIR",
  "TASK_REPAIR",
  "TASK_REGENERATION",
  "ABORTED",
] as const

export type Phase = (typeof phases)[number]

export const PhaseSchema = z.enum(phases)

export const allowedTransitions: Record<Phase, Phase[]> = {
  INIT: ["DISCOVER", "BLOCKED"],
  DISCOVER: ["BRAINSTORM", "BLOCKED"],
  BRAINSTORM: ["SPEC_DRAFT", "BLOCKED"],
  SPEC_DRAFT: ["SPEC_CRITIQUE", "BLOCKED"],
  SPEC_CRITIQUE: ["SPEC_REVISION", "SPEC_FREEZE", "BLOCKED"],
  SPEC_REVISION: ["SPEC_CRITIQUE", "BLOCKED"],
  SPEC_FREEZE: ["PLAN_DRAFT", "BLOCKED"],
  PLAN_DRAFT: ["PLAN_CRITIQUE", "BLOCKED"],
  PLAN_CRITIQUE: ["PLAN_REVISION", "PLAN_FREEZE", "BLOCKED"],
  PLAN_REVISION: ["PLAN_CRITIQUE", "BLOCKED"],
  PLAN_FREEZE: ["TASK_ATOMIZATION", "BLOCKED"],
  TASK_ATOMIZATION: ["TASK_EXECUTION", "BLOCKED"],
  TASK_EXECUTION: ["TASK_VERIFICATION", "TASK_REPAIR", "BLOCKED"],
  TASK_VERIFICATION: ["TASK_EXECUTION", "INTEGRATION_VERIFICATION", "TASK_REPAIR", "BLOCKED"],
  INTEGRATION_VERIFICATION: ["FINAL_REVIEW", "TASK_REPAIR", "PLAN_REPAIR", "BLOCKED"],
  FINAL_REVIEW: ["COMMIT", "TASK_REPAIR", "PLAN_REPAIR", "SPEC_AMENDMENT_REQUEST", "BLOCKED"],
  COMMIT: ["PUSH_OR_MERGE", "BLOCKED"],
  PUSH_OR_MERGE: ["DONE", "BLOCKED"],
  DONE: [],
  BLOCKED: ["DISCOVER", "BRAINSTORM", "SPEC_DRAFT", "SPEC_REVISION", "PLAN_DRAFT", "PLAN_REVISION", "TASK_EXECUTION", "TASK_REPAIR", "ABORTED"],
  MEMORY_CONFLICT: ["ABORTED", "DISCOVER", "BRAINSTORM", "SPEC_DRAFT", "PLAN_DRAFT", "TASK_EXECUTION", "TASK_REPAIR"],
  SPEC_AMENDMENT_REQUEST: ["SPEC_AMENDMENT_CRITIQUE", "BLOCKED"],
  SPEC_AMENDMENT_CRITIQUE: ["SPEC_REVISION", "PLAN_REPAIR", "BLOCKED"],
  PLAN_REPAIR: ["PLAN_CRITIQUE", "TASK_REGENERATION", "BLOCKED"],
  TASK_REPAIR: ["TASK_EXECUTION", "TASK_VERIFICATION", "BLOCKED"],
  TASK_REGENERATION: ["TASK_ATOMIZATION", "BLOCKED"],
  ABORTED: [],
}

export type FinalizationMode = "branch-push" | "pull-request" | "direct-main"

export type WorkflowStatus = "active" | "blocked" | "done" | "aborted" | "conflict"

export type LoopState = {
  spec_critique: number
  plan_critique: number
  task_repair: number
}

export type GateState = {
  spec_passed: boolean
  plan_passed: boolean
  tasks_passed: boolean
  integration_passed: boolean
  final_review_passed: boolean
}

export type WorkflowRecord = {
  id: string
  version: string
  goal: string
  repoFingerprint: string
  repoRoot: string
  worktreePath: string
  branch: string | null
  baseBranch: string | null
  currentPhase: Phase
  previousPhase: Phase | null
  activeTaskId: string | null
  specLocked: boolean
  planLocked: boolean
  gitPushLocked: boolean
  loops: LoopState
  gates: GateState
  lastEventHash: string
  createdAt: string
  updatedAt: string
  lastResumedAt: string | null
  status: WorkflowStatus
  commitHash: string | null
  finalizationMode: FinalizationMode
}

export type LedgerEvent = {
  sequence: number
  timestamp: string
  workflow_id: string
  event: string
  actor: string
  from_phase: Phase | null
  to_phase: Phase | null
  reason: string
  payload: Record<string, unknown>
  previous_event_hash: string
  event_hash: string
}

export const defaultLoops = (): LoopState => ({
  spec_critique: 0,
  plan_critique: 0,
  task_repair: 0,
})

export const defaultGates = (): GateState => ({
  spec_passed: false,
  plan_passed: false,
  tasks_passed: false,
  integration_passed: false,
  final_review_passed: false,
})

export const CritiqueSchema = z.object({
  phase: z.enum(["SPEC_CRITIQUE", "PLAN_CRITIQUE"]),
  result: z.enum(["pass", "fail"]),
  summary: z.string().min(1),
  blockers: z.array(z.unknown()).default([]),
  major_issues: z.array(z.unknown()).default([]),
  minor_issues: z.array(z.unknown()).default([]),
  scores: z.record(z.string(), z.number().int().min(0).max(2)),
  required_revisions: z.array(z.unknown()).default([]),
})

export const VerificationCommandSchema = z.object({
  type: z.enum(["command", "manual"]).default("command"),
  command: z.string().min(1),
  required: z.boolean().default(true),
})

export const TaskSchema = z.object({
  id: z.string().regex(/^\d{3}[A-Za-z0-9_-]*$|^[A-Za-z0-9_-]+$/),
  title: z.string().min(3),
  status: z.enum(["pending", "active", "blocked", "repairing", "verified", "complete", "skipped"]).default("pending"),
  risk_level: z.enum(["low", "medium", "high"]).default("medium"),
  objective: z.string().min(10),
  allowed_files: z.array(z.string().min(1)).min(1),
  forbidden_files: z.array(z.string().min(1)).default([]),
  dependencies: z.array(z.string()).default([]),
  preconditions: z.array(z.string()).default([]),
  steps: z.array(z.string().min(1)).min(1),
  acceptance: z.array(z.string().min(1)).min(1),
  verification: z.array(VerificationCommandSchema).min(1),
  rollback: z.string().min(1),
})

export type WorkflowTask = z.infer<typeof TaskSchema>

export const VerificationResultSchema = z.object({
  task_id: z.string(),
  result: z.enum(["pass", "fail"]),
  started_at: z.string(),
  completed_at: z.string(),
  commands: z.array(
    z.object({
      command: z.string(),
      exit_code: z.number().int(),
      summary: z.string(),
      stdout_excerpt: z.string().default(""),
      stderr_excerpt: z.string().default(""),
    }),
  ),
  changed_files: z.array(z.string()).default([]),
  unauthorized_changes: z.array(z.string()).default([]),
  acceptance_results: z.array(
    z.object({
      criterion: z.string(),
      result: z.enum(["pass", "fail"]),
      evidence: z.string(),
    }),
  ),
  notes: z.string().default(""),
})

export type VerificationResult = z.infer<typeof VerificationResultSchema>

export const IntegrationVerificationSchema = z.object({
  result: z.enum(["pass", "fail"]),
  commands: z.array(z.unknown()).default([]),
  git_status_summary: z.string(),
  diff_summary: z.string(),
  spec_alignment: z.enum(["pass", "fail"]),
  plan_alignment: z.enum(["pass", "fail"]),
  known_limitations: z.array(z.unknown()).default([]),
  remaining_risks: z.array(z.unknown()).default([]),
})

export const FinalReviewSchema = z.object({
  result: z.enum(["pass", "fail"]),
  reviewer_model: z.string().min(1),
  summary: z.string().min(1),
  spec_alignment: z.object({ result: z.enum(["pass", "fail"]), notes: z.string() }),
  plan_completion: z.object({ result: z.enum(["pass", "fail"]), notes: z.string() }),
  verification_quality: z.object({ result: z.enum(["pass", "fail"]), notes: z.string() }),
  risk_assessment: z.object({ result: z.enum(["pass", "fail"]), remaining_risks: z.array(z.unknown()).default([]) }),
  commit_readiness: z.enum(["ready", "not_ready"]),
})

export type KernelConfig = {
  memoryPath?: string
  worktree: {
    enabled: boolean
    root: string
  }
  maxLoops: {
    specCritique: number
    planCritique: number
    taskRepair: number
  }
  finalization: {
    mode: FinalizationMode
    directMainAllowed: boolean
    performPush: boolean
    requireCleanStatus: boolean
    requireIntegrationVerification: boolean
    requireFinalReview: boolean
  }
  shell: {
    allowRawShellForLowTrust: boolean
    allowedInspectionCommands: string[]
  }
  policy: {
    protectedPaths: string[]
    secretReadDeny: string[]
    allowUnknownTools: boolean
    allowBroadTaskFiles: boolean
  }
  models: {
    brainstorm: string
    specCritique: string
    planCritique: string
    taskExecution: string
    finalReview: string
  }
}

export type PartialKernelConfig = Partial<{
  memoryPath: string
  worktree: Partial<KernelConfig["worktree"]>
  maxLoops: Partial<KernelConfig["maxLoops"]>
  finalization: Partial<KernelConfig["finalization"]>
  shell: Partial<KernelConfig["shell"]>
  policy: Partial<KernelConfig["policy"]>
  models: Partial<KernelConfig["models"]>
}>
