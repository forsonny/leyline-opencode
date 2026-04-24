import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import {
  CritiqueSchema,
  FinalReviewSchema,
  IntegrationVerificationSchema,
  type Phase,
  TaskSchema,
  type VerificationResult,
  VerificationResultSchema,
  type WorkflowTask,
} from "./types"
import { fileSha256 } from "./hash"
import { isBroadGlob, normalizePath, safeJoin } from "./path-utils"
import type { KernelConfig } from "./types"

export const artifactPaths = {
  discovery: ".workflow/artifacts/discovery.md",
  brainstorm: ".workflow/artifacts/brainstorm.md",
  productSpec: ".workflow/artifacts/product-spec.md",
  designSpec: ".workflow/artifacts/design-spec.md",
  specCritique: ".workflow/artifacts/spec-critique.json",
  plan: ".workflow/artifacts/plan.md",
  planCritique: ".workflow/artifacts/plan-critique.json",
  finalReport: ".workflow/artifacts/final-report.md",
  integrationVerification: ".workflow/verification/integration-verification.json",
  finalReview: ".workflow/verification/final-review.json",
} as const

export const requiredHeadings: Record<string, string[]> = {
  discovery: ["# Discovery", "## User Goal", "## Repository Structure", "## Relevant Files or Modules", "## Existing Patterns", "## Constraints", "## Risks", "## Unknowns"],
  brainstorm: ["# Brainstorm", "## User Goal", "## Repository Context", "## Candidate Approaches", "## Recommended Direction", "## Risks", "## Non-Goals", "## Questions"],
  productSpec: ["# Product Specification", "## Problem", "## Users", "## Goals", "## Non-Goals", "## User Stories", "## Functional Requirements", "## Acceptance Criteria", "## Edge Cases", "## Risks", "## Open Questions"],
  designSpec: ["# Design Specification", "## Overview", "## Current System Assumptions", "## Proposed Architecture", "## Affected Files or Modules", "## Data Structures", "## Control Flow", "## Error Handling", "## Security and Privacy Considerations", "## Testing Strategy", "## Rollback Strategy", "## Design Alternatives Considered"],
  plan: ["# Implementation Plan", "## Summary", "## Preconditions", "## Task Sequence", "## Dependencies", "## Verification Strategy", "## Rollback Strategy", "## Risks", "## Out of Scope"],
  finalReport: ["# Final Report", "## User Goal", "## Final Outcome", "## Spec Summary", "## Plan Summary", "## Tasks Completed", "## Files Changed", "## Verification Performed", "## Risks and Caveats", "## Commit Information", "## Finalization Mode"],
}

export type ValidationResult = { ok: true; warnings?: string[] } | { ok: false; reason: string; details?: unknown }

export function allowedArtifactWrites(phase: Phase) {
  switch (phase) {
    case "DISCOVER":
      return [artifactPaths.discovery]
    case "BRAINSTORM":
      return [artifactPaths.brainstorm]
    case "SPEC_DRAFT":
      return [artifactPaths.productSpec, artifactPaths.designSpec]
    case "SPEC_CRITIQUE":
      return [artifactPaths.specCritique]
    case "SPEC_REVISION":
      return [artifactPaths.productSpec, artifactPaths.designSpec]
    case "PLAN_DRAFT":
      return [artifactPaths.plan]
    case "PLAN_CRITIQUE":
      return [artifactPaths.planCritique]
    case "PLAN_REVISION":
      return [artifactPaths.plan]
    case "TASK_ATOMIZATION":
      return [".workflow/tasks/*.json"]
    case "TASK_VERIFICATION":
      return [".workflow/verification/*.json"]
    case "INTEGRATION_VERIFICATION":
      return [artifactPaths.integrationVerification]
    case "FINAL_REVIEW":
      return [artifactPaths.finalReview, artifactPaths.finalReport]
    case "MEMORY_CONFLICT":
      return [".workflow/audit/memory-conflict-report.json"]
    case "BLOCKED":
      return [".workflow/artifacts/blocked.md"]
    default:
      return []
  }
}

export async function ensureWorkflowDirs(root: string) {
  await Promise.all([
    mkdir(path.join(root, ".workflow", "artifacts"), { recursive: true }),
    mkdir(path.join(root, ".workflow", "tasks"), { recursive: true }),
    mkdir(path.join(root, ".workflow", "verification"), { recursive: true }),
    mkdir(path.join(root, ".workflow", "audit"), { recursive: true }),
  ])
}

export async function writeWorkflowFile(root: string, relative: string, content: string) {
  const target = safeJoin(root, relative)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content, "utf8")
  return { path: normalizePath(relative), sha256: await fileSha256(target) }
}

export async function readTextArtifact(root: string, relative: string) {
  return readFile(safeJoin(root, relative), "utf8")
}

export function validateHeadings(content: string, headings: string[]): ValidationResult {
  const missing = headings.filter((heading) => !new RegExp(`^${escapeRegExp(heading)}\\s*$`, "m").test(content))
  if (missing.length) return { ok: false, reason: `Missing required headings: ${missing.join(", ")}` }
  return { ok: true }
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export async function validateMarkdownArtifact(root: string, key: keyof typeof requiredHeadings) {
  const relative = artifactPaths[key as keyof typeof artifactPaths]
  if (!relative) return { ok: false, reason: `Unknown artifact key ${String(key)}` } satisfies ValidationResult
  try {
    const content = await readTextArtifact(root, relative)
    return validateHeadings(content, requiredHeadings[key])
  } catch (error) {
    return { ok: false, reason: `Missing artifact ${relative}`, details: String(error) } satisfies ValidationResult
  }
}

export async function readJsonFile<T>(root: string, relative: string, schema: z.ZodType<T>) {
  const text = await readTextArtifact(root, relative)
  return schema.parse(JSON.parse(text))
}

export async function validateCritique(root: string, relative: string, minimumTotal = 10): Promise<ValidationResult> {
  try {
    const critique = await readJsonFile(root, relative, CritiqueSchema)
    const scores = Object.values(critique.scores)
    const total = scores.reduce((sum, value) => sum + value, 0)
    if (critique.result !== "pass") return { ok: false, reason: "Critique result is not pass" }
    if (critique.blockers.length) return { ok: false, reason: "Critique contains blockers" }
    if (scores.some((value) => value < 1)) return { ok: false, reason: "Critique score below 1" }
    if (total < minimumTotal) return { ok: false, reason: `Critique total score ${total} is below ${minimumTotal}` }
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: `Invalid critique artifact ${relative}`, details: String(error) }
  }
}

export function validateTaskDefinition(task: unknown, config: KernelConfig): { ok: true; task: WorkflowTask } | { ok: false; reason: string; details?: unknown } {
  const parsed = TaskSchema.safeParse(task)
  if (!parsed.success) return { ok: false, reason: "Task schema is invalid", details: parsed.error.issues }
  const value = parsed.data
  if (!config.policy.allowBroadTaskFiles && value.allowed_files.some(isBroadGlob)) {
    return { ok: false, reason: "Task allowed_files is too broad" }
  }
  if (/implement (the )?(whole|entire|full) plugin/i.test(value.objective) || /make it production ready/i.test(value.objective)) {
    return { ok: false, reason: "Task objective is too broad" }
  }
  return { ok: true, task: value }
}

export async function validateTaskFile(root: string, relative: string, config: KernelConfig) {
  try {
    const task = JSON.parse(await readTextArtifact(root, relative))
    return validateTaskDefinition(task, config)
  } catch (error) {
    return { ok: false, reason: `Invalid task file ${relative}`, details: String(error) } as const
  }
}

export function taskFilePath(taskId: string) {
  return `.workflow/tasks/${taskId}-task.json`
}

export function verificationFilePath(taskId: string) {
  return `.workflow/verification/${taskId}-verification.json`
}

export async function validateVerificationFile(root: string, relative: string): Promise<{ ok: true; verification: VerificationResult } | { ok: false; reason: string; details?: unknown }> {
  try {
    const verification = await readJsonFile(root, relative, VerificationResultSchema)
    if (verification.result !== "pass") return { ok: false, reason: "Verification result is not pass" }
    if (verification.commands.some((command) => command.exit_code !== 0)) return { ok: false, reason: "A verification command failed" }
    if (verification.unauthorized_changes.length) return { ok: false, reason: "Verification includes unauthorized changes" }
    if (verification.acceptance_results.some((criterion) => criterion.result !== "pass")) return { ok: false, reason: "An acceptance criterion failed" }
    return { ok: true, verification }
  } catch (error) {
    return { ok: false, reason: `Invalid verification file ${relative}`, details: String(error) }
  }
}

export async function validateIntegrationVerification(root: string): Promise<ValidationResult> {
  try {
    const value = await readJsonFile(root, artifactPaths.integrationVerification, IntegrationVerificationSchema)
    if (value.result !== "pass") return { ok: false, reason: "Integration verification result is not pass" }
    if (value.spec_alignment !== "pass") return { ok: false, reason: "Integration spec alignment failed" }
    if (value.plan_alignment !== "pass") return { ok: false, reason: "Integration plan alignment failed" }
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: "Invalid integration verification", details: String(error) }
  }
}

export async function validateFinalReview(root: string): Promise<ValidationResult> {
  try {
    const value = await readJsonFile(root, artifactPaths.finalReview, FinalReviewSchema)
    if (value.result !== "pass") return { ok: false, reason: "Final review result is not pass" }
    if (value.commit_readiness !== "ready") return { ok: false, reason: "Final review commit readiness is not ready" }
    const sections = [value.spec_alignment, value.plan_completion, value.verification_quality, value.risk_assessment]
    if (sections.some((section) => section.result !== "pass")) return { ok: false, reason: "A final review subsection failed" }
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: "Invalid final review", details: String(error) }
  }
}
