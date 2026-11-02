import fs from 'node:fs'
import path from 'node:path'
import { TEMPLATE_ROOT } from '../paths.ts'
import { workspaceRoot } from '../tools/sandbox-path.ts'
import { backendRoot, frontendRoot } from './paths.ts'

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

/**
 * Workspace layout (aligned with aiot-style product trees):
 *   .atoms/
 *   app/
 *     frontend/   # Vite + React + TS
 *     backend/    # stub for future API (P0)
 */
export function scaffoldWorkspace(projectId: string, title: string) {
  const root = workspaceRoot(projectId)
  if (!fs.existsSync(TEMPLATE_ROOT)) {
    throw new Error(`template missing: ${TEMPLATE_ROOT}`)
  }

  const frontend = frontendRoot(projectId)
  const backend = backendRoot(projectId)
  fs.mkdirSync(frontend, { recursive: true })
  fs.mkdirSync(backend, { recursive: true })
  copyDir(TEMPLATE_ROOT, frontend)

  const pkgPath = path.join(frontend, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string }
  pkg.name = `app-${projectId}`
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

  fs.writeFileSync(
    path.join(backend, 'README.md'),
    `# Backend\n\nP0 stub. Application UI lives in \`app/frontend\`.\nAPI / services can be added under this directory later.\n`,
  )
  fs.writeFileSync(
    path.join(backend, '.gitkeep'),
    '',
  )

  const atoms = path.join(root, '.atoms')
  fs.mkdirSync(atoms, { recursive: true })
  const ts = new Date().toISOString()
  fs.writeFileSync(
    path.join(atoms, 'ATOMS.md'),
    `---\nlast_updated: ${ts}\nstatus: active\n---\n\n# ${title}\n\n## Goals\n- (pending)\n\n## Decisions\n| Date | Decision | Rationale |\n|------|----------|----------|\n`,
  )
  fs.writeFileSync(
    path.join(atoms, 'PROGRESS.md'),
    `---\nlast_updated: ${ts}\n---\n\n# Progress\n\n## Requirements\n- ${title}\n\n## Tasks\n| ID | Task | Status |\n|----|------|--------|\n`,
  )
  fs.writeFileSync(
    path.join(atoms, 'ARCHITECTURE.md'),
    `---\nlast_updated: ${ts}\n---\n\n# Architecture\n\n## Overview\n(pending)\n\n## Layout\n\`\`\`text\n.atoms/\napp/\n  frontend/   # Vite + React + TypeScript + Tailwind\n  backend/    # API stub (P0)\n\`\`\`\n\n## Stack\nVite + React + TypeScript + Tailwind\n`,
  )
  return root
}

export function listFileTree(
  projectId: string,
  rel = '',
): Array<{ path: string; type: 'file' | 'dir' }> {
  const root = workspaceRoot(projectId)
  const base = path.join(root, rel)
  if (!fs.existsSync(base)) return []
  const out: Array<{ path: string; type: 'file' | 'dir' }> = []
  const walk = (dir: string, prefix: string) => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
      const p = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        out.push({ path: p, type: 'dir' })
        walk(path.join(dir, entry.name), p)
      } else {
        out.push({ path: p, type: 'file' })
      }
    }
  }
  walk(base, rel.replace(/\\/g, '/'))
  return out
}
