import type { KernelConfig, Phase, WorkflowRecord, WorkflowTask } from "./types"
import { allowedArtifactWrites } from "./artifacts"
import { matchGlob, matchesAny, normalizePath, relativePath } from "./path-utils"

export type PolicyDecision = { decision: "allow"; reason: string } | { decision: "deny"; reason: string; metadata?: Record<string, unknown> }

export type ToolRequest = {
  tool: string
  args: Record<string, unknown>
  root: string
  workflow: WorkflowRecord
  activeTask?: WorkflowTask | null
  config: KernelConfig
}

const mutationTools = new Set(["edit", "write", "apply_patch"])
const workflowTools = new Set([
  "workflow_start",
  "workflow_status",
  "workflow_memory_status",
  "workflow_conflict_report",
  "workflow_read_context",
  "workflow_write_artifact",
  "workflow_request_phase_advance",
  "workflow_create_task",
  "workflow_start_task",
  "workflow_edit_task_file",
  "workflow_run_verification",
  "workflow_finish_task",
  "workflow_abort",
  "workflow_finalize",
])

const defaultReadTools = new Set(["read", "grep", "glob", "lsp", "question", "todowrite", "webfetch", "websearch"])

export function protectedPathReason(relative: string, config: KernelConfig) {
  const normalized = normalizePath(relative)
  const hit = config.policy.protectedPaths.find((glob) => matchGlob(glob, normalized))
  return hit ? `Path is protected by policy pattern ${hit}` : undefined
}

export function canWritePath(phase: Phase, relative: string, activeTask: WorkflowTask | null | undefined, config: KernelConfig): PolicyDecision {
  const normalized = normalizePath(relative)
  const protectedReason = protectedPathReason(normalized, config)
  if (protectedReason) return { decision: "deny", reason: protectedReason }

  if (allowedArtifactWrites(phase).some((glob) => matchGlob(glob, normalized))) {
    return { decision: "allow", reason: `${phase} may write ${normalized}` }
  }

  if (phase !== "TASK_EXECUTION") {
    return { decision: "deny", reason: `Source edits are not allowed during ${phase}` }
  }

  if (!activeTask) return { decision: "deny", reason: "TASK_EXECUTION requires an active task" }
  if (activeTask.forbidden_files.some((glob) => matchGlob(glob, normalized))) {
    return { decision: "deny", reason: `Path ${normalized} is forbidden by active task` }
  }
  if (!activeTask.allowed_files.some((glob) => matchGlob(glob, normalized))) {
    return { decision: "deny", reason: `Path ${normalized} is outside active task allowed_files` }
  }
  return { decision: "allow", reason: `Path ${normalized} is inside active task allowed_files` }
}

export function extractMutationPaths(tool: string, args: Record<string, unknown>) {
  if (tool === "edit" || tool === "write") {
    const filePath = args.filePath
    return typeof filePath === "string" ? [filePath] : []
  }
  if (tool === "apply_patch") {
    const patchText = args.patchText
    if (typeof patchText !== "string") return []
    const paths: string[] = []
    for (const line of patchText.split(/\r?\n/)) {
      const match = line.match(/^\*\*\* (?:Add File|Update File|Delete File|Move to):\s+(.+)$/)
      if (match?.[1]) paths.push(match[1].trim())
    }
    return paths
  }
  return []
}

export function classifyCommand(command: string, config: KernelConfig): "dangerous" | "inspection" | "unknown" {
  const normalized = command.trim().replace(/\s+/g, " ")
  const lower = normalized.toLowerCase()
  const dangerousPrefixes = [
    "git commit",
    "git push",
    "git reset",
    "git checkout",
    "git clean",
    "rm ",
    "rm -",
    "del ",
    "erase ",
    "remove-item",
    "chmod ",
    "chown ",
    "npm install",
    "npm i ",
    "pnpm install",
    "yarn add",
    "bun add",
  ]
  if (dangerousPrefixes.some((prefix) => lower === prefix.trim() || lower.startsWith(prefix))) return "dangerous"
  if (matchesAny(config.shell.allowedInspectionCommands, normalized)) return "inspection"
  return "unknown"
}

export function commandAllowedByTask(command: string, activeTask: WorkflowTask | null | undefined) {
  if (!activeTask) return false
  return activeTask.verification.some((entry) => entry.command === command)
}

export function canRunCommand(phase: Phase, command: string, activeTask: WorkflowTask | null | undefined, config: KernelConfig): PolicyDecision {
  const classification = classifyCommand(command, config)
  if (classification === "dangerous") return { decision: "deny", reason: `Command is dangerous during workflow: ${command}` }
  if (classification === "inspection") return { decision: "allow", reason: "Inspection command is allowed" }
  if (["TASK_VERIFICATION", "INTEGRATION_VERIFICATION", "FINAL_REVIEW"].includes(phase) && commandAllowedByTask(command, activeTask)) {
    return { decision: "allow", reason: "Command is active task verification" }
  }
  if (config.shell.allowRawShellForLowTrust) return { decision: "allow", reason: "Raw shell allowed by policy" }
  return { decision: "deny", reason: `Command is not allowed during ${phase}: ${command}` }
}

export function authorizeTool(request: ToolRequest): PolicyDecision {
  const { tool, args, root, workflow, activeTask, config } = request
  const phase = workflow.currentPhase

  if (workflowTools.has(tool)) return { decision: "allow", reason: "Workflow tool performs its own validation" }

  if (tool === "read") {
    const filePath = args.filePath
    if (typeof filePath === "string") {
      const relative = relativePath(root, filePath)
      if (matchesAny(config.policy.secretReadDeny, relative)) return { decision: "deny", reason: `Read blocked by secret policy for ${relative}` }
    }
    return { decision: "allow", reason: "Read-only tool is allowed" }
  }

  if (defaultReadTools.has(tool)) return { decision: "allow", reason: "Read-only or coordination tool is allowed" }

  if (mutationTools.has(tool)) {
    const paths = extractMutationPaths(tool, args)
    if (!paths.length) return { decision: "deny", reason: `${tool} did not include a path the kernel can validate` }
    for (const file of paths) {
      const decision = canWritePath(phase, relativePath(root, file), activeTask, config)
      if (decision.decision === "deny") return decision
    }
    return { decision: "allow", reason: "All mutation paths passed workflow policy" }
  }

  if (tool === "bash") {
    const command = args.command
    if (typeof command !== "string") return { decision: "deny", reason: "Bash command is missing" }
    return canRunCommand(phase, command, activeTask, config)
  }

  if (config.policy.allowUnknownTools) return { decision: "allow", reason: "Unknown tools allowed by policy" }
  return { decision: "deny", reason: `Unknown tool denied by workflow policy: ${tool}` }
}
