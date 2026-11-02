import { getIdb } from './schema.ts'

export async function saveDraft(projectId: string, text: string) {
  const db = await getIdb()
  await db.put('drafts', { projectId, text, updatedAt: new Date().toISOString() })
}

export async function loadDraft(projectId: string) {
  const db = await getIdb()
  return (await db.get('drafts', projectId))?.text ?? ''
}

export async function saveUiPrefs(
  projectId: string,
  prefs: { buildMode: string; collabMode: string },
) {
  const db = await getIdb()
  await db.put('ui', {
    projectId,
    ...prefs,
    updatedAt: new Date().toISOString(),
  })
}

export async function loadUiPrefs(projectId: string) {
  const db = await getIdb()
  return db.get('ui', projectId)
}

export async function touchRecent(id: string, title: string) {
  const db = await getIdb()
  await db.put('recentProjects', { id, title, openedAt: new Date().toISOString() })
}
