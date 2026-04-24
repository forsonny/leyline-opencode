import type { Plugin, ToolContext } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { mergeConfig } from "./config"
import { WorkflowKernel } from "./kernel"
import { phases } from "./types"

function json(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function errorJson(error: unknown) {
  return json({ ok: false, error: error instanceof Error ? error.message : String(error) })
}

const server: Plugin = async (ctx, options) => {
  const config = mergeConfig(options)
  const kernel = new WorkflowKernel(config, ctx.directory, ctx.worktree)

  return {
    tool: {
      workflow_start: tool({
        description: "Start a new phase-gated Workflow Kernel workflow from a user goal.",
        args: {
          goal: tool.schema.string().min(1).describe("The user's workflow goal."),
          base_branch: tool.schema.string().optional().describe("Base branch for git worktree creation."),
          finalization_mode: tool.schema.enum(["branch-push", "pull-request", "direct-main"]).optional(),
          create_worktree: tool.schema.boolean().optional().describe("Set false to use the current worktree even when worktree creation is enabled."),
        },
        async execute(args, context) {
          try {
            return json(await kernel.startWorkflow(args, context))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),

      workflow_status: tool({
        description: "Show current Workflow Kernel phase, gates, active task, and next required action.",
        args: {},
        async execute(_args, context) {
          try {
            return json(await kernel.status(kernel.rootFromContext(context)))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),

      workflow_memory_status: tool({
        description: "Show trusted memory, ledger, and frozen artifact validation status.",
        args: {},
        async execute(_args, context) {
          try {
            return json(await kernel.memoryStatus(context))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),

      workflow_conflict_report: tool({
        description: "Run resume checks and write a memory conflict report when state, artifacts, ledger, or git disagree.",
        args: {},
        async execute(_args, context) {
          try {
            return json(await kernel.conflictReport(context))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),

      workflow_read_context: tool({
        description: "Read the authoritative workflow state, phase contract, artifacts, and task list.",
        args: {},
        async execute(_args, context) {
          try {
            return json(await kernel.readContext(context))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),

      workflow_write_artifact: tool({
        description: "Write a workflow artifact allowed by the current phase and record its hash.",
        args: {
          path: tool.schema.string().min(1).describe("Repo-relative artifact path, for example .workflow/artifacts/plan.md."),
          content: tool.schema.string().describe("Artifact content."),
          artifact_key: tool.schema.string().optional().describe("Optional stable artifact key for memory."),
        },
        async execute(args, context) {
          try {
            return json(await kernel.writeArtifact(args, context))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),

      workflow_request_phase_advance: tool({
        description: "Request a finite-state-machine phase advance after the required gate validates.",
        args: {
          target_phase: tool.schema.enum(phases).optional().describe("Requested next phase."),
          reason: tool.schema.string().optional().describe("Reason for the requested transition."),
        },
        async execute(args, context) {
          try {
            return json(await kernel.requestPhaseAdvance(args, context))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),

      workflow_create_task: tool({
        description: "Create and validate one atomized task JSON file during TASK_ATOMIZATION.",
        args: {
          task: tool.schema.any().describe("Task object matching the Workflow Kernel task schema."),
        },
        async execute(args, context) {
          try {
            return json(await kernel.createTask(args, context))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),

      workflow_start_task: tool({
        description: "Activate a pending task and enter TASK_EXECUTION.",
        args: {
          task_id: tool.schema.string().optional().describe("Task ID. If omitted, the first pending task starts."),
        },
        async execute(args, context) {
          try {
            return json(await kernel.startTask(args, context))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),

      workflow_edit_task_file: tool({
        description: "Overwrite a file only when it is inside the active task allowed_files list.",
        args: {
          path: tool.schema.string().min(1).describe("Repo-relative file path."),
          content: tool.schema.string().describe("Full replacement file content."),
        },
        async execute(args, context) {
          try {
            return json(await kernel.editTaskFile(args, context))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),

      workflow_run_verification: tool({
        description: "Run approved verification commands for the active task and record evidence.",
        args: {
          task_id: tool.schema.string().optional().describe("Task ID. Defaults to active task."),
          command: tool.schema.string().optional().describe("Optional single verification command from the task schema."),
        },
        async execute(args, context) {
          try {
            return json(await kernel.runVerification(args, context))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),

      workflow_finish_task: tool({
        description: "Mark a task complete only after verification evidence passes.",
        args: {
          task_id: tool.schema.string().optional().describe("Task ID. Defaults to active task."),
        },
        async execute(args, context) {
          try {
            return json(await kernel.finishTask(args, context))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),

      workflow_abort: tool({
        description: "Abort the current workflow while preserving artifacts and audit logs.",
        args: {
          reason: tool.schema.string().min(1).describe("Abort reason."),
        },
        async execute(args, context) {
          try {
            return json(await kernel.abort(args, context))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),

      workflow_finalize: tool({
        description: "Create the authorized commit and optionally push according to finalization policy after all final gates pass.",
        args: {
          commit_message: tool.schema.string().optional().describe("Commit message. Defaults to a workflow summary."),
          mode: tool.schema.enum(["branch-push", "pull-request", "direct-main"]).optional(),
          perform_push: tool.schema.boolean().optional().describe("Set true to push when policy allows it."),
        },
        async execute(args, context) {
          try {
            return json(await kernel.finalize(args, context))
          } catch (error) {
            return errorJson(error)
          }
        },
      }),
    },

    "tool.execute.before": async (input, output) => {
      const decision = await kernel.authorizeBuiltInTool({ tool: input.tool, args: output.args ?? {}, sessionID: input.sessionID, root: ctx.worktree || ctx.directory })
      if (decision.decision === "deny") throw new Error(`Workflow Kernel denied ${input.tool}: ${decision.reason}`)
    },

    "tool.execute.after": async (input, output) => {
      const workflow = await kernel.activeWorkflow(ctx.worktree || ctx.directory)
      if (!workflow) return
      kernel.memory.appendEvent({
        workflowId: workflow.id,
        event: "TOOL_EXECUTED",
        actor: "opencode",
        fromPhase: workflow.currentPhase,
        toPhase: workflow.currentPhase,
        reason: `Tool executed: ${input.tool}`,
        payload: { tool: input.tool, title: output.title, metadata: output.metadata },
        mirrorRoot: workflow.worktreePath,
      })
    },

    "experimental.chat.system.transform": async (_input, output) => {
      const prompt = await kernel.systemPrompt(ctx.worktree || ctx.directory)
      if (prompt) output.system.push(prompt)
    },

    "experimental.session.compacting": async (_input, output) => {
      const status = await kernel.status(ctx.worktree || ctx.directory)
      output.context.push(`## OpenCode Workflow Kernel State\n${json(status)}`)
    },

    "command.execute.before": async (input, output) => {
      const workflow = await kernel.activeWorkflow(ctx.worktree || ctx.directory)
      if (!workflow) return
      kernel.memory.appendEvent({
        workflowId: workflow.id,
        event: "COMMAND_EXECUTED",
        actor: "human",
        fromPhase: workflow.currentPhase,
        toPhase: workflow.currentPhase,
        reason: `Command executed: ${input.command}`,
        payload: { command: input.command, arguments: input.arguments, parts: output.parts.length },
        mirrorRoot: workflow.worktreePath,
      })
    },

    event: async ({ event }) => {
      const typed = event as { type?: string; properties?: Record<string, unknown> }
      if (!typed.type) return
      const workflow = await kernel.activeWorkflow(ctx.worktree || ctx.directory)
      if (!workflow) return
      if (typed.type === "file.edited") {
        kernel.memory.appendEvent({
          workflowId: workflow.id,
          event: "FILE_EDITED_EVENT",
          actor: "opencode",
          fromPhase: workflow.currentPhase,
          toPhase: workflow.currentPhase,
          reason: "OpenCode reported file.edited",
          payload: typed.properties ?? {},
          mirrorRoot: workflow.worktreePath,
        })
      }
      if (typed.type === "permission.asked" || typed.type === "permission.replied" || typed.type === "todo.updated" || typed.type === "session.idle") {
        kernel.memory.appendEvent({
          workflowId: workflow.id,
          event: typed.type.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
          actor: "opencode",
          fromPhase: workflow.currentPhase,
          toPhase: workflow.currentPhase,
          reason: `OpenCode event: ${typed.type}`,
          payload: typed.properties ?? {},
          mirrorRoot: workflow.worktreePath,
        })
      }
    },
  }
}

const plugin = {
  id: "leyline-opencode",
  server,
}

export { server, WorkflowKernel }
export default plugin
