import { Database as SQLiteDatabase } from "bun:sqlite"
import { existsSync, mkdirSync, appendFileSync } from "node:fs"
import path from "node:path"
import { readFile } from "node:fs/promises"
import { canonicalJson, fileSha256, sha256 } from "./hash"
import {
  defaultGates,
  defaultLoops,
  PhaseSchema,
  type FinalizationMode,
  type GateState,
  type LedgerEvent,
  type LoopState,
  type Phase,
  type WorkflowRecord,
  type WorkflowStatus,
  type WorkflowTask,
  VERSION,
} from "./types"
import { ensureWorkflowDirs } from "./artifacts"
import { normalizePath } from "./path-utils"

type WorkflowRow = {
  id: string
  version: string
  goal: string
  repo_fingerprint: string
  repo_root: string
  worktree_path: string
  branch: string | null
  base_branch: string | null
  current_phase: string
  previous_phase: string | null
  active_task_id: string | null
  spec_locked: number
  plan_locked: number
  git_push_locked: number
  loops_json: string
  gates_json: string
  last_event_hash: string
  created_at: string
  updated_at: string
  last_resumed_at: string | null
  status: WorkflowStatus
  commit_hash: string | null
  finalization_mode: FinalizationMode
}

type ArtifactRow = {
  workflow_id: string
  artifact_key: string
  path: string
  sha256: string
  frozen: number
  created_at: string
  updated_at: string
}

type TaskRow = {
  workflow_id: string
  task_id: string
  status: string
  task_json: string
  allowed_files_json: string
  forbidden_files_json: string
  verification_required_json: string
  created_at: string
  updated_at: string
}

export type ResumeCheck = { ok: true } | { ok: false; conflicts: Array<Record<string, unknown>> }

export class MemoryStore {
  readonly db: SQLiteDatabase
  readonly path: string

  constructor(file: string) {
    this.path = file
    mkdirSync(path.dirname(file), { recursive: true })
    this.db = new SQLiteDatabase(file)
    this.db.exec("PRAGMA journal_mode = WAL")
    this.migrate()
  }

  close() {
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    } catch {
      // Ignore checkpoint failures during shutdown.
    }
    this.db.close()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        goal TEXT NOT NULL,
        repo_fingerprint TEXT NOT NULL,
        repo_root TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        branch TEXT,
        base_branch TEXT,
        current_phase TEXT NOT NULL,
        previous_phase TEXT,
        active_task_id TEXT,
        spec_locked INTEGER NOT NULL,
        plan_locked INTEGER NOT NULL,
        git_push_locked INTEGER NOT NULL,
        loops_json TEXT NOT NULL,
        gates_json TEXT NOT NULL,
        last_event_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_resumed_at TEXT,
        status TEXT NOT NULL,
        commit_hash TEXT,
        finalization_mode TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_events (
        workflow_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        from_phase TEXT,
        to_phase TEXT,
        reason TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        previous_event_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL,
        PRIMARY KEY (workflow_id, sequence)
      );

      CREATE TABLE IF NOT EXISTS artifact_hashes (
        workflow_id TEXT NOT NULL,
        artifact_key TEXT NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        frozen INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workflow_id, artifact_key)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        workflow_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        task_json TEXT NOT NULL,
        allowed_files_json TEXT NOT NULL,
        forbidden_files_json TEXT NOT NULL,
        verification_required_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workflow_id, task_id)
      );

      CREATE TABLE IF NOT EXISTS verification_results (
        workflow_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        result TEXT NOT NULL,
        verification_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workflow_id, task_id)
      );

      CREATE TABLE IF NOT EXISTS violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id TEXT,
        timestamp TEXT NOT NULL,
        phase TEXT,
        tool TEXT,
        path TEXT,
        command TEXT,
        reason TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resume_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id TEXT,
        timestamp TEXT NOT NULL,
        repo_fingerprint TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        branch TEXT,
        result TEXT NOT NULL,
        conflict_report_path TEXT,
        summary TEXT NOT NULL
      );
    `)
  }

  createWorkflow(input: Omit<WorkflowRecord, "version" | "lastEventHash" | "createdAt" | "updatedAt" | "lastResumedAt" | "status" | "commitHash">) {
    const now = new Date().toISOString()
    const record: WorkflowRecord = {
      ...input,
      version: VERSION,
      lastEventHash: "GENESIS",
      createdAt: now,
      updatedAt: now,
      lastResumedAt: null,
      status: "active",
      commitHash: null,
    }
    this.saveWorkflow(record)
    return record
  }

  saveWorkflow(record: WorkflowRecord) {
    const row = this.toRow({ ...record, updatedAt: new Date().toISOString() })
    this.db
      .prepare(`
        INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          version=excluded.version,
          goal=excluded.goal,
          repo_fingerprint=excluded.repo_fingerprint,
          repo_root=excluded.repo_root,
          worktree_path=excluded.worktree_path,
          branch=excluded.branch,
          base_branch=excluded.base_branch,
          current_phase=excluded.current_phase,
          previous_phase=excluded.previous_phase,
          active_task_id=excluded.active_task_id,
          spec_locked=excluded.spec_locked,
          plan_locked=excluded.plan_locked,
          git_push_locked=excluded.git_push_locked,
          loops_json=excluded.loops_json,
          gates_json=excluded.gates_json,
          last_event_hash=excluded.last_event_hash,
          updated_at=excluded.updated_at,
          last_resumed_at=excluded.last_resumed_at,
          status=excluded.status,
          commit_hash=excluded.commit_hash,
          finalization_mode=excluded.finalization_mode
      `)
      .run(
        row.id,
        row.version,
        row.goal,
        row.repo_fingerprint,
        row.repo_root,
        row.worktree_path,
        row.branch,
        row.base_branch,
        row.current_phase,
        row.previous_phase,
        row.active_task_id,
        row.spec_locked,
        row.plan_locked,
        row.git_push_locked,
        row.loops_json,
        row.gates_json,
        row.last_event_hash,
        row.created_at,
        row.updated_at,
        row.last_resumed_at,
        row.status,
        row.commit_hash,
        row.finalization_mode,
      )
  }

  updateWorkflow(id: string, patch: Partial<WorkflowRecord>) {
    const current = this.getWorkflow(id)
    if (!current) throw new Error(`Workflow not found: ${id}`)
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
    this.saveWorkflow(next)
    return next
  }

  getWorkflow(id: string) {
    const row = this.db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as WorkflowRow | null
    return row ? this.fromRow(row) : null
  }

  findActiveByFingerprint(repoFingerprint: string) {
    const row = this.db
      .prepare("SELECT * FROM workflows WHERE repo_fingerprint = ? AND status IN ('active','blocked','conflict') ORDER BY updated_at DESC LIMIT 1")
      .get(repoFingerprint) as WorkflowRow | null
    return row ? this.fromRow(row) : null
  }

  findActiveByRoot(root: string) {
    const normalized = path.resolve(root)
    const row = this.db
      .prepare("SELECT * FROM workflows WHERE (repo_root = ? OR worktree_path = ?) AND status IN ('active','blocked','conflict') ORDER BY updated_at DESC LIMIT 1")
      .get(normalized, normalized) as WorkflowRow | null
    return row ? this.fromRow(row) : null
  }

  appendEvent(input: {
    workflowId: string
    event: string
    actor: string
    fromPhase: Phase | null
    toPhase: Phase | null
    reason: string
    payload?: Record<string, unknown>
    mirrorRoot?: string
  }) {
    const workflow = this.getWorkflow(input.workflowId)
    if (!workflow) throw new Error(`Workflow not found: ${input.workflowId}`)
    const sequenceRow = this.db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM workflow_events WHERE workflow_id = ?").get(input.workflowId) as { next: number }
    const timestamp = new Date().toISOString()
    const previous = workflow.lastEventHash || "GENESIS"
    const eventBody = {
      sequence: sequenceRow.next,
      timestamp,
      workflow_id: input.workflowId,
      event: input.event,
      actor: input.actor,
      from_phase: input.fromPhase,
      to_phase: input.toPhase,
      reason: input.reason,
      payload: input.payload ?? {},
      previous_event_hash: previous,
    }
    const eventHash = sha256(canonicalJson(eventBody))
    const row: LedgerEvent = { ...eventBody, event_hash: eventHash }
    this.db
      .prepare("INSERT INTO workflow_events VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(row.workflow_id, row.sequence, row.timestamp, row.event, row.actor, row.from_phase, row.to_phase, row.reason, JSON.stringify(row.payload), row.previous_event_hash, row.event_hash)
    this.updateWorkflow(input.workflowId, { lastEventHash: eventHash })
    if (input.mirrorRoot) this.appendMirrorEvent(input.mirrorRoot, row)
    return row
  }

  appendMirrorEvent(root: string, event: LedgerEvent) {
    mkdirSync(path.join(root, ".workflow", "audit"), { recursive: true })
    appendFileSync(path.join(root, ".workflow", "audit", "events.jsonl"), JSON.stringify(event) + "\n", "utf8")
  }

  logViolation(input: { workflow?: WorkflowRecord | null; phase?: Phase | null; tool?: string; path?: string; command?: string; reason: string; payload?: unknown; mirrorRoot?: string }) {
    const timestamp = new Date().toISOString()
    this.db
      .prepare("INSERT INTO violations (workflow_id,timestamp,phase,tool,path,command,reason,payload_json) VALUES (?,?,?,?,?,?,?,?)")
      .run(input.workflow?.id ?? null, timestamp, input.phase ?? input.workflow?.currentPhase ?? null, input.tool ?? null, input.path ?? null, input.command ?? null, input.reason, JSON.stringify(input.payload ?? {}))
    if (input.mirrorRoot) {
      mkdirSync(path.join(input.mirrorRoot, ".workflow", "audit"), { recursive: true })
      appendFileSync(
        path.join(input.mirrorRoot, ".workflow", "audit", "violations.jsonl"),
        JSON.stringify({ timestamp, workflow_id: input.workflow?.id ?? null, phase: input.phase ?? input.workflow?.currentPhase ?? null, tool: input.tool, path: input.path, command: input.command, reason: input.reason, payload: input.payload ?? {} }) + "\n",
        "utf8",
      )
    }
  }

  recordArtifact(input: { workflowId: string; artifactKey: string; path: string; sha256: string; frozen: boolean }) {
    const now = new Date().toISOString()
    this.db
      .prepare(`
        INSERT INTO artifact_hashes VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(workflow_id, artifact_key) DO UPDATE SET path=excluded.path, sha256=excluded.sha256, frozen=excluded.frozen, updated_at=excluded.updated_at
      `)
      .run(input.workflowId, input.artifactKey, normalizePath(input.path), input.sha256, input.frozen ? 1 : 0, now, now)
  }

  listArtifacts(workflowId: string) {
    return this.db.prepare("SELECT * FROM artifact_hashes WHERE workflow_id = ?").all(workflowId) as ArtifactRow[]
  }

  async validateFrozenArtifacts(workflow: WorkflowRecord): Promise<ResumeCheck> {
    const conflicts: Array<Record<string, unknown>> = []
    for (const artifact of this.listArtifacts(workflow.id)) {
      if (!artifact.frozen) continue
      const file = path.join(workflow.worktreePath, artifact.path)
      if (!existsSync(file)) {
        conflicts.push({ type: "artifact_missing", path: artifact.path, expected_sha256: artifact.sha256, severity: "blocker" })
        continue
      }
      const actual = await fileSha256(file)
      if (actual !== artifact.sha256) {
        conflicts.push({ type: "artifact_hash_mismatch", path: artifact.path, expected_sha256: artifact.sha256, actual_sha256: actual, severity: "blocker" })
      }
    }
    return conflicts.length ? { ok: false, conflicts } : { ok: true }
  }

  validateLedger(workflow: WorkflowRecord): ResumeCheck {
    const rows = this.db.prepare("SELECT * FROM workflow_events WHERE workflow_id = ? ORDER BY sequence ASC").all(workflow.id) as Array<{
      sequence: number
      timestamp: string
      workflow_id: string
      event_type: string
      actor: string
      from_phase: string | null
      to_phase: string | null
      reason: string
      payload_json: string
      previous_event_hash: string
      event_hash: string
    }>
    let expectedPrevious = "GENESIS"
    const conflicts: Array<Record<string, unknown>> = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (row.sequence !== i + 1) conflicts.push({ type: "ledger_sequence_gap", expected: i + 1, actual: row.sequence, severity: "blocker" })
      if (row.previous_event_hash !== expectedPrevious) conflicts.push({ type: "ledger_previous_hash_mismatch", sequence: row.sequence, expected: expectedPrevious, actual: row.previous_event_hash, severity: "blocker" })
      const body = {
        sequence: row.sequence,
        timestamp: row.timestamp,
        workflow_id: row.workflow_id,
        event: row.event_type,
        actor: row.actor,
        from_phase: row.from_phase,
        to_phase: row.to_phase,
        reason: row.reason,
        payload: JSON.parse(row.payload_json),
        previous_event_hash: row.previous_event_hash,
      }
      const actual = sha256(canonicalJson(body))
      if (actual !== row.event_hash) conflicts.push({ type: "ledger_event_hash_mismatch", sequence: row.sequence, expected: row.event_hash, actual, severity: "blocker" })
      expectedPrevious = row.event_hash
    }
    if (workflow.lastEventHash !== expectedPrevious) conflicts.push({ type: "workflow_last_hash_mismatch", expected: expectedPrevious, actual: workflow.lastEventHash, severity: "blocker" })
    return conflicts.length ? { ok: false, conflicts } : { ok: true }
  }

  async resumeCheck(workflow: WorkflowRecord, current: { repoFingerprint: string; worktreePath: string; branch: string | null }) {
    const conflicts: Array<Record<string, unknown>> = []
    if (workflow.repoFingerprint !== current.repoFingerprint) conflicts.push({ type: "repo_fingerprint_mismatch", expected: workflow.repoFingerprint, actual: current.repoFingerprint, severity: "blocker" })
    if (path.resolve(workflow.worktreePath) !== path.resolve(current.worktreePath)) conflicts.push({ type: "worktree_path_mismatch", expected: workflow.worktreePath, actual: current.worktreePath, severity: "blocker" })
    if (workflow.branch && current.branch && workflow.branch !== current.branch) conflicts.push({ type: "branch_mismatch", expected: workflow.branch, actual: current.branch, severity: "blocker" })
    const ledger = this.validateLedger(workflow)
    if (!ledger.ok) conflicts.push(...ledger.conflicts)
    const artifacts = await this.validateFrozenArtifacts(workflow)
    if (!artifacts.ok) conflicts.push(...artifacts.conflicts)
    const result: ResumeCheck = conflicts.length ? { ok: false, conflicts } : { ok: true }
    this.db
      .prepare("INSERT INTO resume_attempts (workflow_id,timestamp,repo_fingerprint,worktree_path,branch,result,conflict_report_path,summary) VALUES (?,?,?,?,?,?,?,?)")
      .run(workflow.id, new Date().toISOString(), current.repoFingerprint, current.worktreePath, current.branch, result.ok ? "pass" : "conflict", null, result.ok ? "Resume checks passed" : `${conflicts.length} conflicts detected`)
    if (!result.ok) this.updateWorkflow(workflow.id, { currentPhase: "MEMORY_CONFLICT", status: "conflict" })
    else this.updateWorkflow(workflow.id, { lastResumedAt: new Date().toISOString() })
    return result
  }

  saveTask(workflowId: string, task: WorkflowTask) {
    const now = new Date().toISOString()
    this.db
      .prepare(`
        INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(workflow_id, task_id) DO UPDATE SET status=excluded.status, task_json=excluded.task_json, allowed_files_json=excluded.allowed_files_json, forbidden_files_json=excluded.forbidden_files_json, verification_required_json=excluded.verification_required_json, updated_at=excluded.updated_at
      `)
      .run(workflowId, task.id, task.status, JSON.stringify(task, null, 2), JSON.stringify(task.allowed_files), JSON.stringify(task.forbidden_files), JSON.stringify(task.verification), now, now)
  }

  getTask(workflowId: string, taskId: string) {
    const row = this.db.prepare("SELECT * FROM tasks WHERE workflow_id = ? AND task_id = ?").get(workflowId, taskId) as TaskRow | null
    return row ? (JSON.parse(row.task_json) as WorkflowTask) : null
  }

  listTasks(workflowId: string) {
    const rows = this.db.prepare("SELECT * FROM tasks WHERE workflow_id = ? ORDER BY task_id ASC").all(workflowId) as TaskRow[]
    return rows.map((row) => JSON.parse(row.task_json) as WorkflowTask)
  }

  updateTaskStatus(workflowId: string, taskId: string, status: WorkflowTask["status"]) {
    const task = this.getTask(workflowId, taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    task.status = status
    this.saveTask(workflowId, task)
    return task
  }

  saveVerification(workflowId: string, taskId: string, result: string, verification: unknown) {
    this.db
      .prepare("INSERT INTO verification_results VALUES (?,?,?,?,?) ON CONFLICT(workflow_id, task_id) DO UPDATE SET result=excluded.result, verification_json=excluded.verification_json, created_at=excluded.created_at")
      .run(workflowId, taskId, result, JSON.stringify(verification, null, 2), new Date().toISOString())
  }

  async readMirrorEvents(root: string) {
    const file = path.join(root, ".workflow", "audit", "events.jsonl")
    if (!existsSync(file)) return []
    const text = await readFile(file, "utf8")
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) as LedgerEvent[]
  }

  async initVisibleMemory(root: string) {
    await ensureWorkflowDirs(root)
  }

  private toRow(record: WorkflowRecord): WorkflowRow {
    return {
      id: record.id,
      version: record.version,
      goal: record.goal,
      repo_fingerprint: record.repoFingerprint,
      repo_root: path.resolve(record.repoRoot),
      worktree_path: path.resolve(record.worktreePath),
      branch: record.branch,
      base_branch: record.baseBranch,
      current_phase: record.currentPhase,
      previous_phase: record.previousPhase,
      active_task_id: record.activeTaskId,
      spec_locked: record.specLocked ? 1 : 0,
      plan_locked: record.planLocked ? 1 : 0,
      git_push_locked: record.gitPushLocked ? 1 : 0,
      loops_json: JSON.stringify(record.loops),
      gates_json: JSON.stringify(record.gates),
      last_event_hash: record.lastEventHash,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      last_resumed_at: record.lastResumedAt,
      status: record.status,
      commit_hash: record.commitHash,
      finalization_mode: record.finalizationMode,
    }
  }

  private fromRow(row: WorkflowRow): WorkflowRecord {
    return {
      id: row.id,
      version: row.version,
      goal: row.goal,
      repoFingerprint: row.repo_fingerprint,
      repoRoot: path.resolve(row.repo_root),
      worktreePath: path.resolve(row.worktree_path),
      branch: row.branch,
      baseBranch: row.base_branch,
      currentPhase: PhaseSchema.parse(row.current_phase),
      previousPhase: row.previous_phase ? PhaseSchema.parse(row.previous_phase) : null,
      activeTaskId: row.active_task_id,
      specLocked: Boolean(row.spec_locked),
      planLocked: Boolean(row.plan_locked),
      gitPushLocked: Boolean(row.git_push_locked),
      loops: parseJson(row.loops_json, defaultLoops()),
      gates: parseJson(row.gates_json, defaultGates()),
      lastEventHash: row.last_event_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastResumedAt: row.last_resumed_at,
      status: row.status,
      commitHash: row.commit_hash,
      finalizationMode: row.finalization_mode,
    }
  }
}

function parseJson<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T
  } catch {
    return fallback
  }
}

export function makeWorkflowId(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "_")
  const random = Math.random().toString(36).slice(2, 8)
  return `wf_${stamp}_${random}`
}

export function makeRepoFingerprint(input: { repoRoot: string; remoteUrl: string; baseBranch: string | null }) {
  return sha256(`${path.resolve(input.repoRoot)}\n${input.remoteUrl}\n${input.baseBranch ?? ""}`)
}
