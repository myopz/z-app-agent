import { getIdb } from './schema.ts'

export async function cacheMessages(projectId: string, messages: unknown[]) {
  const db = await getIdb()
  await db.put('messages', {
    projectId,
    messages,
    updatedAt: new Date().toISOString(),
  })
}

export async function readCachedMessages(projectId: string) {
  const db = await getIdb()
  return db.get('messages', projectId)
}

export async function invalidateMessages(projectId: string) {
  const db = await getIdb()
  await db.delete('messages', projectId)
}

export async function purgeProjectCache(projectId: string) {
  const db = await getIdb()
  await Promise.all([
    db.delete('messages', projectId),
    db.delete('drafts', projectId),
    db.delete('ui', projectId),
    db.delete('logs', projectId),
    db.delete('recentProjects', projectId),
  ])
}
