import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

interface ZAppDb extends DBSchema {
  messages: {
    key: string
    value: {
      projectId: string
      messages: unknown[]
      updatedAt: string
    }
  }
  drafts: {
    key: string
    value: { projectId: string; text: string; updatedAt: string }
  }
  ui: {
    key: string
    value: {
      projectId: string
      buildMode: string
      collabMode: string
      updatedAt: string
    }
  }
  logs: {
    key: string
    value: {
      projectId: string
      kind: 'terminal' | 'console'
      lines: string[]
      updatedAt: string
    }
  }
  recentProjects: {
    key: string
    value: { id: string; title: string; openedAt: string }
  }
}

let dbPromise: Promise<IDBPDatabase<ZAppDb>> | null = null

export function getIdb() {
  if (!dbPromise) {
    dbPromise = openDB<ZAppDb>('z-app-agent', 1, {
      upgrade(db) {
        db.createObjectStore('messages', { keyPath: 'projectId' })
        db.createObjectStore('drafts', { keyPath: 'projectId' })
        db.createObjectStore('ui', { keyPath: 'projectId' })
        db.createObjectStore('logs', { keyPath: 'projectId' })
        db.createObjectStore('recentProjects', { keyPath: 'id' })
      },
    })
  }
  return dbPromise
}
