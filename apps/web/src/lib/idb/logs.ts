import { getIdb } from './schema.ts'

const MAX = 500

export async function appendLog(
  projectId: string,
  kind: 'terminal' | 'console',
  chunk: string,
) {
  const db = await getIdb()
  const key = `${projectId}:${kind}`
  // store by projectId only — keep both kinds in separate keys via composite in value
  const existing = await db.get('logs', projectId)
  const lines = existing && existing.kind === kind ? [...existing.lines] : []
  // simpler: store separate entries using projectId+kind as key — but schema key is projectId.
  // Use two stores-in-one by prefixing lines.
  const all = existing?.lines ?? []
  const next = [...all, `[${kind}] ${chunk}`].slice(-MAX)
  await db.put('logs', {
    projectId,
    kind,
    lines: next,
    updatedAt: new Date().toISOString(),
  })
}

export async function readLogs(projectId: string) {
  const db = await getIdb()
  return (await db.get('logs', projectId))?.lines ?? []
}

export async function clearLogs(projectId: string) {
  const db = await getIdb()
  await db.delete('logs', projectId)
}
