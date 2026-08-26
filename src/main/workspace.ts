import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { dataPath, projectDataPath } from './store'

const FILE = 'workspace.json'

function filePath(): string {
  return dataPath(FILE)
}

export function defaultWorkspace(): string {
  return projectDataPath('LingProjects')
}

function isProtected(target: string): boolean {
  const resolved = resolve(target).toLowerCase()
  if (/^[a-z]:\\windows($|\\)/i.test(resolved)) return true
  return ['\\windows\\', '\\program files\\', '\\program files (x86)\\'].some((item) =>
    resolved.includes(item)
  )
}

function legacyRoots(): string[] {
  const roots = [resolve('D:\\LingProjects')]
  try {
    roots.push(join(app.getPath('documents'), 'LingProjects'))
  } catch {
    // app not ready
  }
  return roots
}

export function remapLegacyPath(target: string): string {
  const resolved = resolve(target)
  const lower = resolved.toLowerCase()
  for (const root of legacyRoots()) {
    const actual = resolve(root)
    const r = actual.toLowerCase()
    if (lower === r) return defaultWorkspace()
    if (lower.startsWith(`${r}\\`)) {
      return join(defaultWorkspace(), resolved.slice(actual.length).replace(/^[\\/]+/, ''))
    }
  }
  return resolved
}

export function getWorkspace(): string {
  let stored = ''
  try {
    if (existsSync(filePath())) {
      const raw = JSON.parse(readFileSync(filePath(), 'utf8')) as { path?: string }
      if (raw.path) stored = raw.path
    }
  } catch {
    // keep default
  }
  const resolved = remapLegacyPath(resolve(stored || defaultWorkspace()))
  if (!existsSync(resolved)) mkdirSync(resolved, { recursive: true })
  if (!stored || resolve(stored) !== resolved) {
    try {
      writeFileSync(filePath(), JSON.stringify({ path: resolved }, null, 2), 'utf8')
    } catch {
      // ignore
    }
  }
  return resolved
}

export function setWorkspace(path: string): string {
  const resolved = remapLegacyPath(resolve(path))
  if (isProtected(resolved)) {
    throw new Error('系统目录不能作为工作区')
  }
  mkdirSync(resolved, { recursive: true })
  writeFileSync(filePath(), JSON.stringify({ path: resolved }, null, 2), 'utf8')
  return resolved
}
