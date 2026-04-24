import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import {
  artifactPaths,
  ensureWorkflowDirs,
  taskFilePath,
  validateCritique,
  validateFinalReview,
  validateHeadings,
  validateIntegrationVerification,
  validateMarkdownArtifact,
  validateTaskDefinition,
  validateVerificationFile,
  verificationFilePath,
  writeWorkflowFile,
  requiredHeadings,
} from "./artifacts"
import { fileSha256 } from "./hash"
import {
  changedFiles,
  commitAll,
  createWorktree,
  currentBranch,
  gitStatusShort,
  headCommit,
  isGitRepo,
  remoteUrl,
  repoRoot,
  runCommand,
  runGit,
  pushBranch,
} from "./git"
import { makeRepoFingerprint, makeWorkflowId, MemoryStore } from "./memory"
import { authorizeTool, canWritePath, commandAllowedByTask, type PolicyDecision } from "./policy"
import { matchGlob, normalizePath, relativePath, safeJoin } from "./path-utils"
import { continuationInstruction, phaseContract } from "./prompts"
import {
  allowedTransitions,
  defaultGates,
  defaultLoops,
  type FinalizationMode,
  type KernelConfig,
  type Phase,
  type VerificationResult,
  type WorkflowRecord,
  type WorkflowTask,
} from "./types"

type ToolLikeContext = Pick<ToolContext, "directory" | "worktree" | "sessionID" | "agent">

export class WorkflowKernel {
  readonly memory: MemoryStore

  constructor(
    readonly config: KernelConfig,
    readonly directory: string,
    readonly worktree: string,
  ) {
    this.memory = new MemoryStore(config.memoryPath!)
  }

  rootFromContext(context?: Partial<ToolLikeContext>) {
    return path.resolve(context?.worktree || context?.directory || this.worktree || this.directory)
  }

  async repoIdentity(root: string) {
    const repo = await repoRoot(root)
    const branch = (await isGitRepo(root)) ? await currentBranch(root) : null
    const remote = (await isGitRepo(root)) ? await remoteUrl(root) : ""
    const baseBranch = branch ?? "main"
    return { repoRoot: repo, branch, remoteUrl: remote, baseBranch, repoFingerprint: makeRepoFingerprint({ repoRoot: repo, remoteUrl: remote, baseBranch }) }
  }

  async activeWorkflow(root = this.worktree) {
    const normalized = path.resolve(root)
    const direct = this.memory.findActiveByRoot(normalized)
    if (direct) return direct
    const identity = await this.repoIdentity(normalized)
    return this.memory.findActiveByFingerprint(identity.repoFingerprint)
  }

  activeTask(workflow: WorkflowRecord | null | undefined) {
    if (!workflow?.activeTaskId) return null
    return this.memory.getTask(workflow.id, workflow.activeTaskId)
  }

  async status(root = this.worktree) {
    const workflow = await this.activeWorkflow(root)
    if (!workflow) return { active: false, memory_path: this.memory.path }
    const task = this.activeTask(workflow)
    return {
      active: true,
      memory_path: this.memory.path,
      workflow_id: workflow.id,
      goal: workflow.goal,
      phase: workflow.currentPhase,
      status: workflow.status,
      active_task: task,
      gates: workflow.gates,
      loops: workflow.loops,
      branch: workflow.branch,
      worktree: workflow.worktreePath,
      next_actions: this.nextActions(workflow),
    }
  }

  nextActions(workflow: WorkflowRecord) {
    switch (workflow.currentPhase) {
      case "DISCOVER":
        return ["Complete .workflow/artifacts/discovery.md with workflow_write_artifact", "Call workflow_request_phase_advance with target_phase BRAINSTORM"]
      case "BRAINSTORM":
        return ["Complete .workflow/artifacts/brainstorm.md with workflow_write_artifact", "Call workflow_request_phase_advance with target_phase SPEC_DRAFT"]
      case "SPEC_DRAFT":
        return ["Write product-spec.md and design-spec.md with workflow_write_artifact", "Call workflow_request_phase_advance with target_phase SPEC_CRITIQUE"]
      case "SPEC_CRITIQUE":
        return ["Write spec-critique.json with workflow_write_artifact", "Call workflow_request_phase_advance with target_phase SPEC_FREEZE if pass or SPEC_REVISION if fail"]
      case "SPEC_REVISION":
        return ["Revise product-spec.md and design-spec.md with workflow_write_artifact", "Call workflow_request_phase_advance with target_phase SPEC_CRITIQUE"]
      case "SPEC_FREEZE":
        return ["Call workflow_request_phase_advance with target_phase PLAN_DRAFT"]
      case "PLAN_DRAFT":
        return ["Write plan.md with workflow_write_artifact", "Call workflow_request_phase_advance with target_phase PLAN_CRITIQUE"]
      case "PLAN_CRITIQUE":
        return ["Write plan-critique.json with workflow_write_artifact", "Call workflow_request_phase_advance with target_phase PLAN_FREEZE if pass or PLAN_REVISION if fail"]
      case "PLAN_REVISION":
        return ["Revise plan.md with workflow_write_artifact", "Call workflow_request_phase_advance with target_phase PLAN_CRITIQUE"]
      case "PLAN_FREEZE":
        return ["Call workflow_request_phase_advance with target_phase TASK_ATOMIZATION"]
      case "TASK_ATOMIZATION":
        return ["Create task JSON files with workflow_create_task", "Call workflow_start_task to activate the first pending task and enter TASK_EXECUTION"]
      case "TASK_EXECUTION":
        return workflow.activeTaskId ? ["Implement only the active task allowed_files", "Call workflow_run_verification"] : ["Call workflow_start_task to activate the next pending task"]
      case "TASK_VERIFICATION":
        return ["Call workflow_finish_task after verification passes"]
      case "INTEGRATION_VERIFICATION":
        return ["Run whole-workflow verification and write .workflow/verification/integration-verification.json", "Call workflow_request_phase_advance with target_phase FINAL_REVIEW"]
      case "FINAL_REVIEW":
        return ["Write final-review.json and final-report.md with workflow_write_artifact", "Call workflow_finalize"]
      case "COMMIT":
        return ["Call workflow_finalize to create the authorized commit"]
      case "PUSH_OR_MERGE":
        return ["Call workflow_finalize to complete push or merge according to policy"]
      case "DONE":
        return ["Workflow is complete"]
      case "BLOCKED":
      case "MEMORY_CONFLICT":
      case "ABORTED":
        return ["Stop and report the required recovery action to the user"]
      default:
        return [`Allowed next phases: ${allowedTransitions[workflow.currentPhase].join(", ") || "none"}`]
    }
  }

  workflowProgress(workflow: WorkflowRecord) {
    return {
      phase: workflow.currentPhase,
      next_actions: this.nextActions(workflow),
      continue_instruction: continuationInstruction,
      phase_contract: phaseContract(workflow),
    }
  }

  async startWorkflow(args: { goal: string; base_branch?: string; finalization_mode?: FinalizationMode; create_worktree?: boolean }, context?: Partial<ToolLikeContext>) {
    const startRoot = this.rootFromContext(context)
    const existing = await this.activeWorkflow(startRoot)
    if (existing && existing.status !== "done" && existing.status !== "aborted") {
      return { ok: false, reason: `Active workflow already exists: ${existing.id}`, status: await this.status(startRoot) }
    }

    const repo = await repoRoot(startRoot)
    const git = await isGitRepo(startRoot)
    const branchAtStart = git ? await currentBranch(startRoot) : null
    const baseBranch = args.base_branch ?? branchAtStart ?? "main"
    const id = makeWorkflowId()
    const branch = git ? `workflow/${id}` : null
    const finalizationMode = args.finalization_mode ?? this.config.finalization.mode
    const shouldCreateWorktree = git && this.config.worktree.enabled && args.create_worktree !== false
    const worktreePath = shouldCreateWorktree ? path.resolve(repo, this.config.worktree.root, id) : repo
    const remote = git ? await remoteUrl(startRoot) : ""
    const repoFingerprint = makeRepoFingerprint({ repoRoot: repo, remoteUrl: remote, baseBranch })

    if (shouldCreateWorktree && branch) {
      const result = await createWorktree({ repoRoot: repo, branch, baseBranch, worktreePath })
      if (result.exitCode !== 0) {
        return { ok: false, reason: "Failed to create git worktree", command: result.command, stderr: result.stderr, stdout: result.stdout }
      }
    }

    await ensureWorkflowDirs(worktreePath)
    const workflow = this.memory.createWorkflow({
      id,
      goal: args.goal,
      repoFingerprint,
      repoRoot: repo,
      worktreePath,
      branch,
      baseBranch: git ? baseBranch : null,
      currentPhase: "DISCOVER",
      previousPhase: "INIT",
      activeTaskId: null,
      specLocked: false,
      planLocked: false,
      gitPushLocked: true,
      loops: defaultLoops(),
      gates: defaultGates(),
      finalizationMode,
    })
    this.memory.appendEvent({ workflowId: workflow.id, event: "WORKFLOW_CREATED", actor: "workflow-kernel", fromPhase: "INIT", toPhase: "DISCOVER", reason: "Workflow initialized", payload: { goal: args.goal, worktree_created: shouldCreateWorktree }, mirrorRoot: worktreePath })
    await writeWorkflowFile(worktreePath, artifactPaths.discovery, discoveryTemplate(args.goal))
    return {
      ok: true,
      workflow_id: workflow.id,
      worktree: workflow.worktreePath,
      branch: workflow.branch,
      note: shouldCreateWorktree ? "OpenCode should be run from this worktree path for implementation phases." : "Workflow is using the current worktree.",
      ...this.workflowProgress(workflow),
    }
  }

  async writeArtifact(args: { path: string; content: string; artifact_key?: string }, context?: Partial<ToolLikeContext>) {
    const workflow = await this.requireWorkflow(context)
    const decision = canWritePath(workflow.currentPhase, args.path, this.activeTask(workflow), this.config)
    if (decision.decision === "deny") return { ok: false, reason: decision.reason }
    const written = await writeWorkflowFile(workflow.worktreePath, args.path, args.content)
    this.memory.recordArtifact({ workflowId: workflow.id, artifactKey: args.artifact_key ?? normalizePath(args.path), path: written.path, sha256: written.sha256, frozen: false })
    this.memory.appendEvent({ workflowId: workflow.id, event: "ARTIFACT_WRITTEN", actor: context?.agent ?? "model", fromPhase: workflow.currentPhase, toPhase: workflow.currentPhase, reason: `Artifact written: ${written.path}`, payload: written, mirrorRoot: workflow.worktreePath })
    return { ok: true, ...written, ...this.workflowProgress(workflow) }
  }

  async readContext(context?: Partial<ToolLikeContext>) {
    const workflow = await this.requireWorkflow(context)
    return {
      workflow,
      active_task: this.activeTask(workflow),
      phase_contract: phaseContract(workflow),
      next_actions: this.nextActions(workflow),
      continue_instruction: continuationInstruction,
      artifacts: this.memory.listArtifacts(workflow.id),
      tasks: this.memory.listTasks(workflow.id),
    }
  }

  async requestPhaseAdvance(args: { target_phase?: Phase; reason?: string }, context?: Partial<ToolLikeContext>) {
    const workflow = await this.requireWorkflow(context)
    const target = args.target_phase ?? allowedTransitions[workflow.currentPhase][0]
    if (!target) return { ok: false, reason: `No automatic next phase from ${workflow.currentPhase}` }
    if (!allowedTransitions[workflow.currentPhase].includes(target)) {
      return { ok: false, reason: `Invalid transition ${workflow.currentPhase} -> ${target}` }
    }
    const gate = await this.validateTransitionGate(workflow, target)
    if (!gate.ok) {
      this.memory.appendEvent({ workflowId: workflow.id, event: "PHASE_ADVANCE_DENIED", actor: context?.agent ?? "model", fromPhase: workflow.currentPhase, toPhase: target, reason: gate.reason, payload: gate, mirrorRoot: workflow.worktreePath })
      return gate
    }
    const patch = gate.patch ?? {}
    const nextStatus = target === "BLOCKED" ? "blocked" : target === "MEMORY_CONFLICT" ? "conflict" : target === "DONE" ? "done" : workflow.status
    const next = this.memory.updateWorkflow(workflow.id, { ...patch, previousPhase: workflow.currentPhase, currentPhase: target, status: nextStatus })
    this.memory.appendEvent({ workflowId: workflow.id, event: "PHASE_ADVANCED", actor: "workflow-kernel", fromPhase: workflow.currentPhase, toPhase: target, reason: args.reason ?? gate.reason, payload: { patch }, mirrorRoot: workflow.worktreePath })
    return { ok: true, workflow_id: next.id, from_phase: workflow.currentPhase, to_phase: target, gates: next.gates, locks: { spec_locked: next.specLocked, plan_locked: next.planLocked }, ...this.workflowProgress(next) }
  }

  async createTask(args: { task: unknown }, context?: Partial<ToolLikeContext>) {
    const workflow = await this.requireWorkflow(context)
    if (workflow.currentPhase !== "TASK_ATOMIZATION" && workflow.currentPhase !== "TASK_REGENERATION") {
      return { ok: false, reason: `Tasks can only be created during TASK_ATOMIZATION or TASK_REGENERATION, not ${workflow.currentPhase}` }
    }
    const parsed = validateTaskDefinition(args.task, this.config)
    if (!parsed.ok) return parsed
    const file = taskFilePath(parsed.task.id)
    await writeWorkflowFile(workflow.worktreePath, file, JSON.stringify(parsed.task, null, 2))
    this.memory.saveTask(workflow.id, parsed.task)
    this.memory.appendEvent({ workflowId: workflow.id, event: "TASK_CREATED", actor: context?.agent ?? "model", fromPhase: workflow.currentPhase, toPhase: workflow.currentPhase, reason: `Task created: ${parsed.task.id}`, payload: { task_id: parsed.task.id, file }, mirrorRoot: workflow.worktreePath })
    return { ok: true, task_id: parsed.task.id, path: file, ...this.workflowProgress(workflow) }
  }

  async startTask(args: { task_id?: string }, context?: Partial<ToolLikeContext>) {
    const workflow = await this.requireWorkflow(context)
    if (!["TASK_EXECUTION", "TASK_ATOMIZATION", "TASK_REPAIR"].includes(workflow.currentPhase)) {
      return { ok: false, reason: `Cannot start a task during ${workflow.currentPhase}` }
    }
    const tasks = this.memory.listTasks(workflow.id)
    const task = args.task_id ? this.memory.getTask(workflow.id, args.task_id) : tasks.find((item) => item.status === "pending" || item.status === "repairing")
    if (!task) return { ok: false, reason: "No matching pending task found" }
    this.memory.updateTaskStatus(workflow.id, task.id, "active")
    const next = this.memory.updateWorkflow(workflow.id, { activeTaskId: task.id, previousPhase: workflow.currentPhase, currentPhase: "TASK_EXECUTION" })
    this.memory.appendEvent({ workflowId: workflow.id, event: "TASK_STARTED", actor: "workflow-kernel", fromPhase: workflow.currentPhase, toPhase: "TASK_EXECUTION", reason: `Task ${task.id} started`, payload: { task_id: task.id }, mirrorRoot: workflow.worktreePath })
    return { ok: true, workflow_id: next.id, active_task: this.memory.getTask(workflow.id, task.id), ...this.workflowProgress(next) }
  }

  async editTaskFile(args: { path: string; content: string }, context?: Partial<ToolLikeContext>) {
    const workflow = await this.requireWorkflow(context)
    const activeTask = this.activeTask(workflow)
    const decision = canWritePath(workflow.currentPhase, args.path, activeTask, this.config)
    if (decision.decision === "deny") return { ok: false, reason: decision.reason }
    const target = safeJoin(workflow.worktreePath, args.path)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, args.content, "utf8")
    this.memory.appendEvent({ workflowId: workflow.id, event: "TASK_FILE_EDITED", actor: context?.agent ?? "model", fromPhase: workflow.currentPhase, toPhase: workflow.currentPhase, reason: `Task file edited: ${args.path}`, payload: { path: normalizePath(args.path), task_id: activeTask?.id }, mirrorRoot: workflow.worktreePath })
    return { ok: true, path: normalizePath(args.path) }
  }

  async runVerification(args: { task_id?: string; command?: string }, context?: Partial<ToolLikeContext>) {
    let workflow = await this.requireWorkflow(context)
    if (workflow.currentPhase === "TASK_EXECUTION") {
      await this.requestPhaseAdvance({ target_phase: "TASK_VERIFICATION", reason: "Verification requested" }, context)
      workflow = await this.requireWorkflow(context)
    }
    if (workflow.currentPhase !== "TASK_VERIFICATION") return { ok: false, reason: `Task verification cannot run during ${workflow.currentPhase}` }
    const taskId = args.task_id ?? workflow.activeTaskId
    if (!taskId) return { ok: false, reason: "No active task for verification" }
    const task = this.memory.getTask(workflow.id, taskId)
    if (!task) return { ok: false, reason: `Task not found: ${taskId}` }
    const commands = args.command ? [{ command: args.command, required: true }] : task.verification
    if (args.command && !commandAllowedByTask(args.command, task)) return { ok: false, reason: `Command is not listed in task verification: ${args.command}` }
    const started = new Date().toISOString()
    const results = []
    for (const item of commands) {
      const result = await runCommand(item.command, workflow.worktreePath)
      results.push({
        command: item.command,
        exit_code: result.exitCode,
        summary: result.exitCode === 0 ? "Command passed" : "Command failed",
        stdout_excerpt: excerpt(result.stdout),
        stderr_excerpt: excerpt(result.stderr),
      })
      if (item.required !== false && result.exitCode !== 0) break
    }
    const files = await changedFiles(workflow.worktreePath).catch(() => [])
    const unauthorized = files.filter((file) => !file.startsWith(".workflow/") && !task.allowed_files.some((glob) => matchGlob(glob, file)))
    const pass = results.every((result) => result.exit_code === 0) && unauthorized.length === 0
    const verification: VerificationResult = {
      task_id: task.id,
      result: pass ? "pass" : "fail",
      started_at: started,
      completed_at: new Date().toISOString(),
      commands: results,
      changed_files: files,
      unauthorized_changes: unauthorized,
      acceptance_results: task.acceptance.map((criterion) => ({ criterion, result: pass ? "pass" : "fail", evidence: pass ? "Required verification commands passed." : "Verification failed or unauthorized changes were detected." })),
      notes: "Generated by workflow_run_verification.",
    }
    const file = verificationFilePath(task.id)
    await writeWorkflowFile(workflow.worktreePath, file, JSON.stringify(verification, null, 2))
    this.memory.saveVerification(workflow.id, task.id, verification.result, verification)
    this.memory.appendEvent({ workflowId: workflow.id, event: "TASK_VERIFICATION_RECORDED", actor: "workflow-kernel", fromPhase: workflow.currentPhase, toPhase: workflow.currentPhase, reason: `Verification ${verification.result} for task ${task.id}`, payload: { task_id: task.id, result: verification.result }, mirrorRoot: workflow.worktreePath })
    return { ok: pass, verification_path: file, verification, ...this.workflowProgress(workflow) }
  }

  async finishTask(args: { task_id?: string }, context?: Partial<ToolLikeContext>) {
    const workflow = await this.requireWorkflow(context)
    if (workflow.currentPhase !== "TASK_VERIFICATION") return { ok: false, reason: `Tasks can only be finished during TASK_VERIFICATION, not ${workflow.currentPhase}` }
    const taskId = args.task_id ?? workflow.activeTaskId
    if (!taskId) return { ok: false, reason: "No active task to finish" }
    const validation = await validateVerificationFile(workflow.worktreePath, verificationFilePath(taskId))
    if (!validation.ok) return validation
    this.memory.updateTaskStatus(workflow.id, taskId, "complete")
    const tasks = this.memory.listTasks(workflow.id)
    const remaining = tasks.filter((task) => !["complete", "skipped"].includes(task.status))
    const nextPhase: Phase = remaining.length ? "TASK_EXECUTION" : "INTEGRATION_VERIFICATION"
    const next = this.memory.updateWorkflow(workflow.id, { activeTaskId: null, previousPhase: workflow.currentPhase, currentPhase: nextPhase, gates: { ...workflow.gates, tasks_passed: remaining.length === 0 } })
    this.memory.appendEvent({ workflowId: workflow.id, event: "TASK_FINISHED", actor: "workflow-kernel", fromPhase: workflow.currentPhase, toPhase: nextPhase, reason: `Task ${taskId} complete`, payload: { task_id: taskId, remaining: remaining.length }, mirrorRoot: workflow.worktreePath })
    return { ok: true, task_id: taskId, remaining_tasks: remaining.map((task) => task.id), ...this.workflowProgress(next) }
  }

  async finalize(args: { commit_message?: string; mode?: FinalizationMode; perform_push?: boolean }, context?: Partial<ToolLikeContext>) {
    let workflow = await this.requireWorkflow(context)
    if (workflow.currentPhase === "FINAL_REVIEW") {
      const review = await validateFinalReview(workflow.worktreePath)
      if (!review.ok) return review
      workflow = this.memory.updateWorkflow(workflow.id, { previousPhase: "FINAL_REVIEW", currentPhase: "COMMIT", gates: { ...workflow.gates, final_review_passed: true } })
      this.memory.appendEvent({ workflowId: workflow.id, event: "PHASE_ADVANCED", actor: "workflow-kernel", fromPhase: "FINAL_REVIEW", toPhase: "COMMIT", reason: "Final review passed", mirrorRoot: workflow.worktreePath })
    }
    if (workflow.currentPhase !== "COMMIT" && workflow.currentPhase !== "PUSH_OR_MERGE") return { ok: false, reason: `Finalize cannot run during ${workflow.currentPhase}` }
    if (this.config.finalization.requireIntegrationVerification && !workflow.gates.integration_passed) return { ok: false, reason: "Integration verification has not passed" }
    if (this.config.finalization.requireFinalReview && !workflow.gates.final_review_passed) return { ok: false, reason: "Final review has not passed" }

    const git = await isGitRepo(workflow.worktreePath)
    if (!git) return { ok: false, reason: "Cannot finalize commit because workflow worktree is not a git repository" }
    let commitHash = workflow.commitHash
    if (!commitHash) {
      const status = await gitStatusShort(workflow.worktreePath)
      if (!status) {
        commitHash = await headCommit(workflow.worktreePath)
      } else {
        const commit = await commitAll({ cwd: workflow.worktreePath, message: args.commit_message ?? defaultCommitMessage(workflow) })
        if (commit.exitCode !== 0) return { ok: false, reason: "Git commit failed", command: commit.command, stdout: commit.stdout, stderr: commit.stderr }
        commitHash = await headCommit(workflow.worktreePath)
      }
      workflow = this.memory.updateWorkflow(workflow.id, { commitHash, previousPhase: workflow.currentPhase, currentPhase: "PUSH_OR_MERGE" })
      this.memory.appendEvent({ workflowId: workflow.id, event: "COMMIT_CREATED", actor: "workflow-kernel", fromPhase: "COMMIT", toPhase: "PUSH_OR_MERGE", reason: "Authorized commit created", payload: { commit_hash: commitHash }, mirrorRoot: workflow.worktreePath })
    }

    const mode = args.mode ?? workflow.finalizationMode
    if (mode === "direct-main" && !this.config.finalization.directMainAllowed) return { ok: false, reason: "direct-main finalization is disabled by policy" }
    const performPush = args.perform_push ?? this.config.finalization.performPush
    if (!performPush) return { ok: true, commit_hash: commitHash, finalization_mode: mode, note: "Push/merge not performed because performPush is false.", ...this.workflowProgress(workflow) }
    if (!workflow.branch) return { ok: false, reason: "Cannot push because workflow branch is unknown" }
    const push = await pushBranch({ cwd: workflow.worktreePath, branch: workflow.branch })
    if (push.exitCode !== 0) return { ok: false, reason: "Git push failed", command: push.command, stdout: push.stdout, stderr: push.stderr }
    const done = this.memory.updateWorkflow(workflow.id, { previousPhase: workflow.currentPhase, currentPhase: "DONE", status: "done", gitPushLocked: false })
    this.memory.appendEvent({ workflowId: workflow.id, event: "WORKFLOW_FINALIZED", actor: "workflow-kernel", fromPhase: "PUSH_OR_MERGE", toPhase: "DONE", reason: `Finalization mode ${mode} completed`, payload: { mode, commit_hash: commitHash }, mirrorRoot: workflow.worktreePath })
    return { ok: true, commit_hash: commitHash, finalization_mode: mode, push: { stdout: push.stdout, stderr: push.stderr }, ...this.workflowProgress(done) }
  }

  async abort(args: { reason: string }, context?: Partial<ToolLikeContext>) {
    const workflow = await this.requireWorkflow(context)
    const next = this.memory.updateWorkflow(workflow.id, { previousPhase: workflow.currentPhase, currentPhase: "ABORTED", status: "aborted" })
    this.memory.appendEvent({ workflowId: workflow.id, event: "WORKFLOW_ABORTED", actor: "workflow-kernel", fromPhase: workflow.currentPhase, toPhase: "ABORTED", reason: args.reason, mirrorRoot: workflow.worktreePath })
    return { ok: true, workflow_id: next.id, phase: next.currentPhase, reason: args.reason }
  }

  async conflictReport(context?: Partial<ToolLikeContext>) {
    const root = this.rootFromContext(context)
    const workflow = await this.requireWorkflow(context)
    const identity = await this.repoIdentity(root)
    const check = await this.memory.resumeCheck(workflow, { repoFingerprint: identity.repoFingerprint, worktreePath: root, branch: identity.branch })
    if (check.ok) return { ok: true, result: "no_conflict" }
    const report = {
      result: "conflict",
      detected_at: new Date().toISOString(),
      workflow_id: workflow.id,
      conflicts: check.conflicts,
      allowed_recovery_actions: ["restore_artifact", "abort_workflow", "human_override"],
      recommended_action: "inspect_conflicts",
    }
    const file = ".workflow/audit/memory-conflict-report.json"
    await writeWorkflowFile(workflow.worktreePath, file, JSON.stringify(report, null, 2))
    this.memory.appendEvent({ workflowId: workflow.id, event: "MEMORY_CONFLICT_DETECTED", actor: "workflow-kernel", fromPhase: workflow.currentPhase, toPhase: "MEMORY_CONFLICT", reason: `${check.conflicts.length} conflicts detected`, payload: report, mirrorRoot: workflow.worktreePath })
    return { ok: false, path: file, report }
  }

  async memoryStatus(context?: Partial<ToolLikeContext>) {
    const workflow = await this.activeWorkflow(this.rootFromContext(context))
    if (!workflow) return { active: false, memory_path: this.memory.path }
    return {
      active: true,
      memory_path: this.memory.path,
      workflow,
      ledger: this.memory.validateLedger(workflow),
      frozen_artifacts: await this.memory.validateFrozenArtifacts(workflow),
    }
  }

  async authorizeBuiltInTool(input: { tool: string; args: Record<string, unknown>; sessionID?: string; root?: string }) {
    const root = input.root ?? this.worktree
    const workflow = await this.activeWorkflow(root)
    if (!workflow) return { decision: "allow", reason: "No active workflow" } satisfies PolicyDecision
    const decision = authorizeTool({ tool: input.tool, args: input.args, root, workflow, activeTask: this.activeTask(workflow), config: this.config })
    if (decision.decision === "deny") {
      this.memory.logViolation({ workflow, tool: input.tool, command: typeof input.args.command === "string" ? input.args.command : undefined, reason: decision.reason, payload: input.args, mirrorRoot: workflow.worktreePath })
    }
    return decision
  }

  async systemPrompt(root = this.worktree) {
    const workflow = await this.activeWorkflow(root)
    return workflow ? phaseContract(workflow) : undefined
  }

  async requireWorkflow(context?: Partial<ToolLikeContext>) {
    const workflow = await this.activeWorkflow(this.rootFromContext(context))
    if (!workflow) throw new Error("No active Workflow Kernel workflow found. Start one with workflow_start.")
    return workflow
  }

  private async validateTransitionGate(workflow: WorkflowRecord, target: Phase): Promise<{ ok: true; reason: string; patch?: Partial<WorkflowRecord> } | { ok: false; reason: string; details?: unknown }> {
    const root = workflow.worktreePath
    switch (`${workflow.currentPhase}->${target}`) {
      case "DISCOVER->BRAINSTORM": {
        const result = await validateMarkdownArtifact(root, "discovery")
        return result.ok ? { ok: true, reason: "Discovery artifact is valid" } : result
      }
      case "BRAINSTORM->SPEC_DRAFT": {
        const result = await validateMarkdownArtifact(root, "brainstorm")
        return result.ok ? { ok: true, reason: "Brainstorm artifact is valid" } : result
      }
      case "SPEC_DRAFT->SPEC_CRITIQUE": {
        const product = await validateMarkdownArtifact(root, "productSpec")
        if (!product.ok) return product
        const design = await validateMarkdownArtifact(root, "designSpec")
        return design.ok ? { ok: true, reason: "Spec artifacts are valid" } : design
      }
      case "SPEC_CRITIQUE->SPEC_FREEZE": {
        const critique = await validateCritique(root, artifactPaths.specCritique)
        if (!critique.ok) return critique
        await this.freezeArtifact(workflow, "product_spec", artifactPaths.productSpec)
        await this.freezeArtifact(workflow, "design_spec", artifactPaths.designSpec)
        return { ok: true, reason: "Spec critique passed", patch: { specLocked: true, gates: { ...workflow.gates, spec_passed: true } } }
      }
      case "SPEC_CRITIQUE->SPEC_REVISION": {
        const loops = { ...workflow.loops, spec_critique: workflow.loops.spec_critique + 1 }
        if (loops.spec_critique > this.config.maxLoops.specCritique) return { ok: false, reason: "Spec critique loop cap exceeded" }
        return { ok: true, reason: "Spec critique requires revision", patch: { loops } }
      }
      case "SPEC_REVISION->SPEC_CRITIQUE": {
        const product = await validateMarkdownArtifact(root, "productSpec")
        if (!product.ok) return product
        const design = await validateMarkdownArtifact(root, "designSpec")
        return design.ok ? { ok: true, reason: "Revised specs are valid" } : design
      }
      case "SPEC_FREEZE->PLAN_DRAFT":
        return workflow.specLocked ? { ok: true, reason: "Specs are frozen" } : { ok: false, reason: "Specs are not frozen" }
      case "PLAN_DRAFT->PLAN_CRITIQUE": {
        const result = await validateMarkdownArtifact(root, "plan")
        return result.ok ? { ok: true, reason: "Plan artifact is valid" } : result
      }
      case "PLAN_CRITIQUE->PLAN_FREEZE": {
        const critique = await validateCritique(root, artifactPaths.planCritique)
        if (!critique.ok) return critique
        await this.freezeArtifact(workflow, "plan", artifactPaths.plan)
        return { ok: true, reason: "Plan critique passed", patch: { planLocked: true, gates: { ...workflow.gates, plan_passed: true } } }
      }
      case "PLAN_CRITIQUE->PLAN_REVISION": {
        const loops = { ...workflow.loops, plan_critique: workflow.loops.plan_critique + 1 }
        if (loops.plan_critique > this.config.maxLoops.planCritique) return { ok: false, reason: "Plan critique loop cap exceeded" }
        return { ok: true, reason: "Plan critique requires revision", patch: { loops } }
      }
      case "PLAN_REVISION->PLAN_CRITIQUE": {
        const result = await validateMarkdownArtifact(root, "plan")
        return result.ok ? { ok: true, reason: "Revised plan is valid" } : result
      }
      case "PLAN_FREEZE->TASK_ATOMIZATION":
        return workflow.planLocked ? { ok: true, reason: "Plan is frozen" } : { ok: false, reason: "Plan is not frozen" }
      case "TASK_ATOMIZATION->TASK_EXECUTION": {
        const tasks = this.memory.listTasks(workflow.id)
        if (!tasks.length) return { ok: false, reason: "No task files have been created" }
        return { ok: true, reason: "Tasks are available" }
      }
      case "TASK_EXECUTION->TASK_VERIFICATION":
        return workflow.activeTaskId ? { ok: true, reason: "Active task is ready for verification" } : { ok: false, reason: "No active task" }
      case "INTEGRATION_VERIFICATION->FINAL_REVIEW": {
        const result = await validateIntegrationVerification(root)
        return result.ok ? { ok: true, reason: "Integration verification passed", patch: { gates: { ...workflow.gates, integration_passed: true } } } : result
      }
      case "FINAL_REVIEW->COMMIT": {
        const result = await validateFinalReview(root)
        return result.ok ? { ok: true, reason: "Final review passed", patch: { gates: { ...workflow.gates, final_review_passed: true } } } : result
      }
      case "COMMIT->PUSH_OR_MERGE":
        return workflow.commitHash ? { ok: true, reason: "Commit exists" } : { ok: false, reason: "No commit hash recorded" }
      case "PUSH_OR_MERGE->DONE":
        return workflow.commitHash ? { ok: true, reason: "Finalization can complete", patch: { status: "done", gitPushLocked: false } } : { ok: false, reason: "No commit hash recorded" }
      default:
        return { ok: true, reason: "Transition allowed by finite state machine" }
    }
  }

  private async freezeArtifact(workflow: WorkflowRecord, artifactKey: string, relative: string) {
    const file = safeJoin(workflow.worktreePath, relative)
    const hash = await fileSha256(file)
    this.memory.recordArtifact({ workflowId: workflow.id, artifactKey, path: relative, sha256: hash, frozen: true })
  }
}

function discoveryTemplate(goal: string) {
  return `# Discovery
## User Goal
${goal}

## Repository Structure
To be filled by the model.

## Relevant Files or Modules
To be filled by the model.

## Existing Patterns
To be filled by the model.

## Constraints
To be filled by the model.

## Risks
To be filled by the model.

## Unknowns
To be filled by the model.
`
}

function excerpt(input: string, limit = 4000) {
  return input.length > limit ? input.slice(0, limit) : input
}

function defaultCommitMessage(workflow: WorkflowRecord) {
  return `Complete workflow ${workflow.id}`
}
