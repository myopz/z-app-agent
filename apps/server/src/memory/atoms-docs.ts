import fs from 'node:fs'
import path from 'node:path'
import { resolveInWorkspace } from '../tools/sandbox-path.ts'

export function updateAtomsDoc(
  projectId: string,
  name: 'ATOMS.md' | 'PROGRESS.md' | 'ARCHITECTURE.md',
  body: string,
) {
  const abs = resolveInWorkspace(projectId, path.join('.atoms', name))
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const ts = new Date().toISOString()
  const withFm =
    body.startsWith('---')
      ? body.replace(/^---\n(?:.*\n)*?---\n/, `---\nlast_updated: ${ts}\n---\n\n`)
      : `---\nlast_updated: ${ts}\n---\n\n${body}`
  fs.writeFileSync(abs, withFm)
}

export function readAtomsDoc(
  projectId: string,
  name: 'ATOMS.md' | 'PROGRESS.md' | 'ARCHITECTURE.md',
): string {
  const abs = resolveInWorkspace(projectId, path.join('.atoms', name))
  if (!fs.existsSync(abs)) return ''
  return fs.readFileSync(abs, 'utf8')
}
