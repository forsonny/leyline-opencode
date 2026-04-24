import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

export function sha256(input: string | Buffer) {
  return createHash("sha256").update(input).digest("hex")
}

export function canonicalJson(input: unknown) {
  return JSON.stringify(sortJson(input))
}

function sortJson(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sortJson)
  if (!input || typeof input !== "object") return input
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, sortJson(value)]))
}

export async function fileSha256(file: string) {
  return sha256(await readFile(file))
}
