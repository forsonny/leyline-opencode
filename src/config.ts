import os from "node:os"
import path from "node:path"
import type { KernelConfig, PartialKernelConfig } from "./types"

function dataDir() {
  if (process.env.OPENCODE_WORKFLOW_KERNEL_HOME) return process.env.OPENCODE_WORKFLOW_KERNEL_HOME
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? os.homedir(), "opencode-workflow-kernel")
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "opencode-workflow-kernel")
}

export function defaultMemoryPath() {
  return process.env.OPENCODE_WORKFLOW_KERNEL_DB ?? path.join(dataDir(), "state.db")
}

export const defaultConfig = (): KernelConfig => ({
  memoryPath: defaultMemoryPath(),
  worktree: {
    enabled: true,
    root: ".worktrees",
  },
  maxLoops: {
    specCritique: 3,
    planCritique: 3,
    taskRepair: 2,
  },
  finalization: {
    mode: "branch-push",
    directMainAllowed: false,
    performPush: false,
    requireCleanStatus: true,
    requireIntegrationVerification: true,
    requireFinalReview: true,
  },
  shell: {
    allowRawShellForLowTrust: false,
    allowedInspectionCommands: [
      "git status*",
      "git diff*",
      "git log*",
      "git branch*",
      "git rev-parse*",
      "git remote*",
      "pwd",
      "ls*",
      "dir*",
      "rg*",
      "grep*",
    ],
  },
  policy: {
    protectedPaths: [
      ".opencode/**",
      "opencode.json",
      "opencode.jsonc",
      ".git/**",
      ".workflow/audit/**",
      ".workflow/checkpoints/**",
      "**/.env",
      "**/.env.*",
    ],
    secretReadDeny: ["*.env", "*.env.*", "**/*.env", "**/*.env.*", "**/credentials.json", "**/*secret*"],
    allowUnknownTools: false,
    allowBroadTaskFiles: false,
  },
  models: {
    brainstorm: "medium",
    specCritique: "strong",
    planCritique: "strong",
    taskExecution: "cheap",
    finalReview: "strong",
  },
})

export function mergeConfig(input: unknown): KernelConfig {
  const base = defaultConfig()
  const next = (input && typeof input === "object" ? input : {}) as PartialKernelConfig
  return {
    ...base,
    ...next,
    worktree: { ...base.worktree, ...(next.worktree ?? {}) },
    maxLoops: { ...base.maxLoops, ...(next.maxLoops ?? {}) },
    finalization: { ...base.finalization, ...(next.finalization ?? {}) },
    shell: { ...base.shell, ...(next.shell ?? {}) },
    policy: { ...base.policy, ...(next.policy ?? {}) },
    models: { ...base.models, ...(next.models ?? {}) },
  }
}
