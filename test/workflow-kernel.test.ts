import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { validateTaskDefinition } from "../src/artifacts"
import { defaultConfig } from "../src/config"
import { WorkflowKernel } from "../src/kernel"
import { makeRepoFingerprint, MemoryStore } from "../src/memory"
import { canWritePath, extractMutationPaths } from "../src/policy"
import { matchGlob } from "../src/path-utils"
import { defaultGates, defaultLoops, type WorkflowRecord, type WorkflowTask, VERSION } from "../src/types"

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) await removeWithRetry(dir)
  }
})

async function removeWithRetry(dir: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === 19) throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "leyline-opencode-test-"))
  tempDirs.push(dir)
  return dir
}

function sampleTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: "001",
    title: "Add a focused file",
    status: "pending",
    risk_level: "medium",
    objective: "Create one focused implementation file for the active task.",
    allowed_files: ["src/state.ts", "src/state.test.ts"],
    forbidden_files: [".opencode/**", ".workflow/audit/**"],
    dependencies: [],
    preconditions: ["spec is frozen", "plan is frozen"],
    steps: ["Create the state module"],
    acceptance: ["The state module exists"],
    verification: [{ type: "command", command: "bun test src/state.test.ts", required: true }],
    rollback: "Revert files listed in allowed_files.",
    ...overrides,
  }
}

function workflowRecord(root: string, phase = "SPEC_DRAFT" as const): WorkflowRecord {
  return {
    id: "wf_test",
    version: VERSION,
    goal: "test workflow",
    repoFingerprint: makeRepoFingerprint({ repoRoot: root, remoteUrl: "", baseBranch: "main" }),
    repoRoot: root,
    worktreePath: root,
    branch: null,
    baseBranch: null,
    currentPhase: phase,
    previousPhase: "BRAINSTORM",
    activeTaskId: null,
    specLocked: false,
    planLocked: false,
    gitPushLocked: true,
    loops: defaultLoops(),
    gates: defaultGates(),
    lastEventHash: "GENESIS",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastResumedAt: null,
    status: "active",
    commitHash: null,
    finalizationMode: "branch-push",
  }
}

describe("path and task validation", () => {
  test("matches workflow glob patterns", () => {
    expect(matchGlob(".workflow/tasks/*.json", ".workflow/tasks/001-task.json")).toBe(true)
    expect(matchGlob(".workflow/tasks/*.json", ".workflow/tasks/nested/001-task.json")).toBe(false)
    expect(matchGlob("src/**", "src/a/b.ts")).toBe(true)
  })

  test("rejects broad task allowlists by default", () => {
    const config = defaultConfig()
    const result = validateTaskDefinition(sampleTask({ allowed_files: ["**/*"] }), config)
    expect(result.ok).toBe(false)
  })
})

describe("policy", () => {
  test("denies source edits during spec phase and allows phase artifacts", async () => {
    const root = await tempDir()
    const config = defaultConfig()
    const source = canWritePath("SPEC_DRAFT", "src/app.ts", null, config)
    expect(source.decision).toBe("deny")
    const artifact = canWritePath("SPEC_DRAFT", ".workflow/artifacts/product-spec.md", null, config)
    expect(artifact.decision).toBe("allow")
  })

  test("allows active task files and denies files outside allowlist", () => {
    const config = defaultConfig()
    const task = sampleTask()
    expect(canWritePath("TASK_EXECUTION", "src/state.ts", task, config).decision).toBe("allow")
    expect(canWritePath("TASK_EXECUTION", "src/other.ts", task, config).decision).toBe("deny")
  })

  test("extracts apply_patch mutation paths", () => {
    const paths = extractMutationPaths("apply_patch", {
      patchText: "*** Begin Patch\n*** Add File: src/a.ts\n+hi\n*** Update File: src/b.ts\n@@\n-old\n+new\n*** End Patch",
    })
    expect(paths).toEqual(["src/a.ts", "src/b.ts"])
  })
})

describe("memory", () => {
  test("validates hash-chained ledger and detects workflow hash mismatch", async () => {
    const root = await tempDir()
    const dbPath = path.join(root, "state.db")
    const memory = new MemoryStore(dbPath)
    const base = workflowRecord(root)
    const { version: _version, lastEventHash: _lastEventHash, createdAt: _createdAt, updatedAt: _updatedAt, lastResumedAt: _lastResumedAt, status: _status, commitHash: _commitHash, ...createInput } = base
    const record = memory.createWorkflow(createInput)
    memory.appendEvent({ workflowId: record.id, event: "TEST", actor: "test", fromPhase: "INIT", toPhase: "DISCOVER", reason: "test event", mirrorRoot: root })
    const current = memory.getWorkflow(record.id)!
    expect(memory.validateLedger(current).ok).toBe(true)
    const tampered = memory.updateWorkflow(record.id, { lastEventHash: "bad-hash" })
    expect(memory.validateLedger(tampered).ok).toBe(false)
    memory.close()
  })
})

describe("kernel workflow", () => {
  test("starts a workflow, advances discovery, and blocks premature source edit", async () => {
    const root = await tempDir()
    const config = defaultConfig()
    config.memoryPath = path.join(root, "kernel.db")
    config.worktree.enabled = false
    const kernel = new WorkflowKernel(config, root, root)

    const started = await kernel.startWorkflow({ goal: "Build a test feature", create_worktree: false }, { directory: root, worktree: root, sessionID: "s", agent: "test" })
    expect(started.ok).toBe(true)

    const advanced = await kernel.requestPhaseAdvance({ target_phase: "BRAINSTORM" }, { directory: root, worktree: root, sessionID: "s", agent: "test" })
    expect(advanced.ok).toBe(true)

    const denied = await kernel.authorizeBuiltInTool({ tool: "write", args: { filePath: path.join(root, "src", "app.ts") }, root })
    expect(denied.decision).toBe("deny")
    kernel.memory.close()
  })
})
