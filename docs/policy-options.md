# Policy Options

Plugin options are passed through OpenCode's `plugin` config entry.

```json
{
  "plugin": [
    [
      "leyline-opencode",
      {
        "worktree": {
          "enabled": true,
          "root": ".worktrees"
        },
        "finalization": {
          "mode": "branch-push",
          "directMainAllowed": false,
          "performPush": false,
          "requireCleanStatus": true,
          "requireIntegrationVerification": true,
          "requireFinalReview": true
        },
        "policy": {
          "allowUnknownTools": false,
          "allowBroadTaskFiles": false
        }
      }
    ]
  ]
}
```

## Defaults

- Unknown side-effecting tools are denied during active workflows.
- Source edits are denied outside `TASK_EXECUTION`.
- Execution edits must match active task `allowed_files`.
- Direct main finalization is disabled.
- Push is not performed unless explicitly configured or requested.
- Spec and plan critique loops are capped at 3.
- Task repair loops are capped at 2.
