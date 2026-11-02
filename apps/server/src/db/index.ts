import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { DATA_ROOT, DB_PATH, SNAPSHOTS_ROOT, WORKSPACES_ROOT } from '../paths.ts'
import { migrate } from './schema.ts'

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  fs.mkdirSync(DATA_ROOT, { recursive: true })
  fs.mkdirSync(WORKSPACES_ROOT, { recursive: true })
  fs.mkdirSync(SNAPSHOTS_ROOT, { recursive: true })
  db = new DatabaseSync(DB_PATH)
  migrate(db)
  return db
}

export function nowIso() {
  return new Date().toISOString()
}
