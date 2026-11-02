import path from 'node:path'
import { workspaceRoot } from '../tools/sandbox-path.ts'

/** Application root under workspace: app/ */
export function appRoot(projectId: string): string {
  return path.join(workspaceRoot(projectId), 'app')
}

/** Vite React frontend root: app/frontend */
export function frontendRoot(projectId: string): string {
  return path.join(appRoot(projectId), 'frontend')
}

/** Backend stub root: app/backend */
export function backendRoot(projectId: string): string {
  return path.join(appRoot(projectId), 'backend')
}
