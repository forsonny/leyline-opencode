import path from "node:path"

export function normalizePath(input: string) {
  return input.replace(/\\/g, "/").replace(/^\.\//, "")
}

export function relativePath(root: string, file: string) {
  const absolute = path.isAbsolute(file) ? file : path.resolve(root, file)
  return normalizePath(path.relative(root, absolute))
}

export function safeJoin(root: string, file: string) {
  const absolute = path.isAbsolute(file) ? file : path.resolve(root, file)
  const normalizedRoot = path.resolve(root)
  const relative = path.relative(normalizedRoot, absolute)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workflow root: ${file}`)
  }
  return absolute
}

export function globToRegExp(glob: string) {
  let out = "^"
  const value = normalizePath(glob)
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    const next = value[i + 1]
    if (char === "*" && next === "*") {
      out += ".*"
      i++
      continue
    }
    if (char === "*") {
      out += "[^/]*"
      continue
    }
    if (char === "?") {
      out += "[^/]"
      continue
    }
    if ("\\^$+?.()|{}[]".includes(char)) out += `\\${char}`
    else out += char
  }
  out += "$"
  return new RegExp(out)
}

export function matchGlob(glob: string, target: string) {
  const normalized = normalizePath(target)
  return globToRegExp(glob).test(normalized)
}

export function matchesAny(globs: string[], target: string) {
  return globs.some((glob) => matchGlob(glob, target))
}

export function isBroadGlob(glob: string) {
  const normalized = normalizePath(glob).trim()
  return normalized === "*" || normalized === "**" || normalized === "**/*" || normalized === "." || normalized === "./**/*"
}
