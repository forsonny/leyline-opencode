# OpenCode Workflow Kernel PRD Package

Document status: Draft v0.2  
Prepared on: 2026-04-24  
Working product name: OpenCode Workflow Kernel  
Document owner: Product and engineering lead

## Purpose

This package defines a professional product requirements document for an OpenCode plugin that enforces a deterministic software development workflow across multiple LLMs. The plugin is designed to constrain lower-cost, less literal, and more assumptive models so they cannot skip workflow phases, mutate state, bypass verification, or make side effects outside the current authorized step.

## Assumption

The user phrase "get tree workflow" is treated as "git worktree workflow." The PRD assumes implementation work happens in an isolated git worktree and is finalized through a controlled commit and push or merge policy.

## Package contents

1. `01_PRD.md`  
   The main product requirements document, including product vision, goals, users, requirements, non-goals, risks, and success criteria.

2. `02_WORKFLOW_KERNEL_ARCHITECTURE.md`  
   The technical architecture for the workflow controller, state machine, tool perimeter, custom tools, hook enforcement, git worktree flow, and model routing.

3. `03_SCHEMAS_AND_GATES.md`  
   Artifact schemas, phase gates, critique rubrics, task format, verification evidence format, and finalization gates.

4. `04_IMPLEMENTATION_ROADMAP_AND_TEST_PLAN.md`  
   MVP scope, staged roadmap, QA strategy, adversarial tests, acceptance tests, and release criteria.

5. `05_AGENT_PROMPT_CONTRACTS.md`  
   Model-facing prompt contracts for brainstorm, specification, critique, planning, task execution, verification, finalization, and session recovery phases.

6. `06_MEMORY_ADHERENCE_ARCHITECTURE.md`  
   Durable memory architecture for session continuity, trusted state storage, append-only event ledger, git checkpoints, conflict recovery, and resume behavior.

## Source alignment

The PRD is grounded in the official OpenCode documentation for plugins, plugin events and hooks, permissions, tools, custom tools, commands, agents, session behavior, and ecosystem worktree-related patterns. The design intentionally treats prompts as guidance only and uses tool permissions, hook interception, state validation, and external verification as the enforcement mechanism.

## Product thesis

Prompts guide. Tools constrain. Memory persists. State decides. Verification proves. Git protects.

The plugin should not try to make every model smart. It should make the workflow impossible to ignore inside the controlled execution perimeter.
