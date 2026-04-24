import path from "node:path"

export type CommandResult = {
  command: string
  cwd: string
  exitCode: number
  stdout: string
  stderr: string
}

export async function runCommand(command: string, cwd: string): Promise<CommandResult> {
  const shell = process.platform === "win32" ? ["cmd", "/d", "/s", "/c", command] : ["sh", "-c", command]
  const proc = Bun.spawn(shell, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { command, cwd, exitCode, stdout, stderr }
}

export async function runGit(args: string[], cwd: string) {
  const command = ["git", ...args].map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ")
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { command, cwd, exitCode, stdout, stderr }
}

export async function isGitRepo(cwd: string) {
  const result = await runGit(["rev-parse", "--is-inside-work-tree"], cwd)
  return result.exitCode === 0 && result.stdout.trim() === "true"
}

export async function repoRoot(cwd: string) {
  const result = await runGit(["rev-parse", "--show-toplevel"], cwd)
  if (result.exitCode !== 0) return cwd
  return path.resolve(result.stdout.trim())
}

export async function currentBranch(cwd: string) {
  const result = await runGit(["branch", "--show-current"], cwd)
  if (result.exitCode !== 0) return null
  return result.stdout.trim() || null
}

export async function remoteUrl(cwd: string) {
  const result = await runGit(["remote", "get-url", "origin"], cwd)
  if (result.exitCode !== 0) return ""
  return result.stdout.trim()
}

export async function gitStatusShort(cwd: string) {
  const result = await runGit(["status", "--short"], cwd)
  return result.stdout.trim()
}

export async function changedFiles(cwd: string) {
  const result = await runGit(["diff", "--name-only", "HEAD"], cwd)
  if (result.exitCode !== 0) return []
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

export async function createWorktree(input: { repoRoot: string; branch: string; baseBranch: string; worktreePath: string }) {
  return runGit(["worktree", "add", "-b", input.branch, input.worktreePath, input.baseBranch], input.repoRoot)
}

export async function commitAll(input: { cwd: string; message: string }) {
  const add = await runGit(["add", "-A"], input.cwd)
  if (add.exitCode !== 0) return add
  return runGit(["commit", "-m", input.message], input.cwd)
}

export async function headCommit(cwd: string) {
  const result = await runGit(["rev-parse", "HEAD"], cwd)
  if (result.exitCode !== 0) return null
  return result.stdout.trim()
}

export async function pushBranch(input: { cwd: string; branch: string }) {
  return runGit(["push", "-u", "origin", input.branch], input.cwd)
}
