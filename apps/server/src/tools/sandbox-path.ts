import path from 'node:path'
import { WORKSPACES_ROOT } from '../paths.ts'

export class PathEscapeError extends Error {
  constructor(message = 'path_escape') {
    super(message)
    this.name = 'PathEscapeError'
  }
}

export function workspaceRoot(projectId: string): string {
  return path.resolve(WORKSPACES_ROOT, projectId)
}

export function resolveInWorkspace(projectId: string, rel: string): string {
  const root = workspaceRoot(projectId)
  const normalized = rel.replace(/^\/+/, '')
  const abs = path.resolve(root, normalized || '.')
  const relToRoot = path.relative(root, abs)
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw new PathEscapeError()
  }
  return abs
}
