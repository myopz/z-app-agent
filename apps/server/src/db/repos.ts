import { nanoid } from 'nanoid'
import type { Brief, RoleId } from '@z-app-agent/shared'
import { getDb, nowIso } from './index.ts'

export type ProjectRow = {
  id: string
  title: string
  build_mode: string
  collab_mode: string
  preview_port: number | null
  created_at: string
  updated_at: string
}

export type MessageRow = {
  id: string
  project_id: string
  role: string
  agent_id: string | null
  kind: string
  content_json: string
  created_at: string
}

export function listProjects(): ProjectRow[] {
  return getDb().prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as ProjectRow[]
}

export function getProject(id: string): ProjectRow | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
}

export function createProject(input: {
  title: string
  build_mode?: string
  collab_mode?: string
}): ProjectRow {
  const id = nanoid(10)
  const ts = nowIso()
  const row: ProjectRow = {
    id,
    title: input.title,
    build_mode: input.build_mode ?? 'build',
    collab_mode: input.collab_mode ?? 'team',
    preview_port: null,
    created_at: ts,
    updated_at: ts,
  }
  getDb()
    .prepare(
      `INSERT INTO projects (id, title, build_mode, collab_mode, preview_port, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.title,
      row.build_mode,
      row.collab_mode,
      row.preview_port,
      row.created_at,
      row.updated_at,
    )
  return row
}

export function touchProject(id: string) {
  getDb().prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(nowIso(), id)
}

/** Delete project row and related tables that lack ON DELETE CASCADE. */
export function deleteProject(id: string): boolean {
  const db = getDb()
  if (!getProject(id)) return false
  db.prepare('DELETE FROM tool_calls WHERE project_id = ?').run(id)
  db.prepare('DELETE FROM patches WHERE project_id = ?').run(id)
  db.prepare('DELETE FROM issues WHERE project_id = ?').run(id)
  db.prepare('DELETE FROM message_queue WHERE project_id = ?').run(id)
  // cascades: messages, runs, versions, checkpoints
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return true
}

export function updateProjectPort(id: string, port: number | null) {
  // Runtime metadata only — opening preview must not change project sort order.
  getDb().prepare('UPDATE projects SET preview_port = ? WHERE id = ?').run(port, id)
}

export function insertMessage(input: {
  project_id: string
  role: string
  agent_id?: RoleId | null
  kind: string
  content: unknown
  id?: string
}): MessageRow {
  const row: MessageRow = {
    id: input.id ?? nanoid(),
    project_id: input.project_id,
    role: input.role,
    agent_id: input.agent_id ?? null,
    kind: input.kind,
    content_json: JSON.stringify(input.content),
    created_at: nowIso(),
  }
  getDb()
    .prepare(
      `INSERT INTO messages (id, project_id, role, agent_id, kind, content_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.project_id,
      row.role,
      row.agent_id,
      row.kind,
      row.content_json,
      row.created_at,
    )
  touchProject(input.project_id)
  return row
}

export function listMessages(projectId: string): MessageRow[] {
  return getDb()
    .prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as MessageRow[]
}

export function createRun(input: {
  project_id: string
  phase: string
  brief?: Brief | null
  source_message_id?: string
}): { id: string } {
  const id = nanoid()
  getDb()
    .prepare(
      `INSERT INTO runs (id, project_id, status, phase, brief_json, source_message_id, fix_attempts, started_at)
       VALUES (?, ?, 'running', ?, ?, ?, 0, ?)`,
    )
    .run(
      id,
      input.project_id,
      input.phase,
      input.brief ? JSON.stringify(input.brief) : null,
      input.source_message_id ?? null,
      nowIso(),
    )
  return { id }
}

export function updateRun(
  id: string,
  patch: {
    status?: string
    phase?: string
    brief?: Brief | null
    fix_attempts?: number
    ended?: boolean
  },
) {
  const row = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(id) as
    | {
        status: string
        phase: string
        brief_json: string | null
        fix_attempts: number
      }
    | undefined
  if (!row) return
  getDb()
    .prepare(
      `UPDATE runs SET status = ?, phase = ?, brief_json = ?, fix_attempts = ?, ended_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.status ?? row.status,
      patch.phase ?? row.phase,
      patch.brief !== undefined
        ? patch.brief
          ? JSON.stringify(patch.brief)
          : null
        : row.brief_json,
      patch.fix_attempts ?? row.fix_attempts,
      patch.ended ? nowIso() : null,
      id,
    )
}

export function getActiveRun(projectId: string) {
  return getDb()
    .prepare(
      `SELECT * FROM runs WHERE project_id = ? AND status IN ('running','waiting_plan','waiting_answers')
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(projectId) as
    | {
        id: string
        project_id: string
        status: string
        phase: string
        brief_json: string | null
        source_message_id: string | null
        fix_attempts: number
      }
    | undefined
}

export function getRun(id: string) {
  return getDb().prepare('SELECT * FROM runs WHERE id = ?').get(id) as
    | {
        id: string
        project_id: string
        status: string
        phase: string
        brief_json: string | null
        source_message_id: string | null
        fix_attempts: number
      }
    | undefined
}

/** Latest run that can be resumed from a checkpoint (includes stopped/failed). */
export function getResumableRun(projectId: string) {
  return getDb()
    .prepare(
      `SELECT * FROM runs WHERE project_id = ?
         AND status IN ('running','waiting_plan','waiting_answers','stopped','failed')
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(projectId) as
    | {
        id: string
        project_id: string
        status: string
        phase: string
        brief_json: string | null
        source_message_id: string | null
        fix_attempts: number
      }
    | undefined
}

export function listOpenRuns() {
  return getDb()
    .prepare(
      `SELECT * FROM runs WHERE status IN ('running','waiting_plan','waiting_answers')`,
    )
    .all() as Array<{
    id: string
    project_id: string
    status: string
    phase: string
    brief_json: string | null
  }>
}

export function saveCheckpoint(projectId: string, payload: unknown) {
  getDb()
    .prepare(
      `INSERT INTO checkpoints (project_id, payload_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
    )
    .run(projectId, JSON.stringify(payload), nowIso())
}

export function getCheckpoint(projectId: string) {
  const row = getDb()
    .prepare('SELECT * FROM checkpoints WHERE project_id = ?')
    .get(projectId) as { payload_json: string; updated_at: string } | undefined
  if (!row) return null
  return { payload: JSON.parse(row.payload_json), updated_at: row.updated_at }
}

export function clearCheckpoint(projectId: string) {
  getDb().prepare('DELETE FROM checkpoints WHERE project_id = ?').run(projectId)
}

export function enqueueMessage(projectId: string, payload: unknown) {
  const max = getDb()
    .prepare(
      'SELECT COALESCE(MAX(position), 0) AS m FROM message_queue WHERE project_id = ?',
    )
    .get(projectId) as { m: number }
  const id = nanoid()
  getDb()
    .prepare(
      `INSERT INTO message_queue (id, project_id, payload_json, position, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, projectId, JSON.stringify(payload), max.m + 1, nowIso())
  return id
}

export function dequeueMessage(projectId: string) {
  const row = getDb()
    .prepare(
      `SELECT * FROM message_queue WHERE project_id = ? ORDER BY position ASC LIMIT 1`,
    )
    .get(projectId) as { id: string; payload_json: string } | undefined
  if (!row) return null
  getDb().prepare('DELETE FROM message_queue WHERE id = ?').run(row.id)
  return JSON.parse(row.payload_json) as unknown
}

export function clearQueue(projectId: string) {
  getDb().prepare('DELETE FROM message_queue WHERE project_id = ?').run(projectId)
}

export function insertPatch(input: {
  project_id: string
  run_id?: string
  message_id?: string
  path: string
  before_text: string | null
  after_text: string | null
}) {
  const id = nanoid()
  getDb()
    .prepare(
      `INSERT INTO patches (id, project_id, run_id, message_id, path, before_text, after_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.project_id,
      input.run_id ?? null,
      input.message_id ?? null,
      input.path,
      input.before_text,
      input.after_text,
      nowIso(),
    )
  return id
}

export function listPatchesForMessage(messageId: string) {
  return getDb()
    .prepare('SELECT * FROM patches WHERE message_id = ? ORDER BY created_at ASC')
    .all(messageId) as Array<{
    id: string
    path: string
    before_text: string | null
    after_text: string | null
  }>
}

export function insertVersion(input: {
  project_id: string
  label: string
  parent_id?: string | null
  snapshot_path: string
  message_id?: string
}) {
  const id = nanoid()
  const created_at = nowIso()
  getDb()
    .prepare(
      `INSERT INTO versions (id, project_id, label, parent_id, snapshot_path, message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.project_id,
      input.label,
      input.parent_id ?? null,
      input.snapshot_path,
      input.message_id ?? null,
      created_at,
    )
  return { id, created_at, label: input.label }
}

export function listVersions(projectId: string) {
  return getDb()
    .prepare('SELECT * FROM versions WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as Array<{
    id: string
    label: string
    snapshot_path: string
    created_at: string
    parent_id: string | null
  }>
}

export function getVersion(id: string) {
  return getDb().prepare('SELECT * FROM versions WHERE id = ?').get(id) as
    | {
        id: string
        project_id: string
        label: string
        snapshot_path: string
        created_at: string
      }
    | undefined
}

export function insertIssue(input: {
  project_id: string
  run_id?: string
  phase: string
  logs: string
}) {
  const id = nanoid()
  getDb()
    .prepare(
      `INSERT INTO issues (id, project_id, run_id, phase, logs, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(id, input.project_id, input.run_id ?? null, input.phase, input.logs, nowIso())
  return id
}

export function getIssue(id: string) {
  return getDb().prepare('SELECT * FROM issues WHERE id = ?').get(id) as
    | {
        id: string
        project_id: string
        run_id: string | null
        phase: string
        logs: string
        status: string
      }
    | undefined
}

export function updateIssueStatus(id: string, status: string) {
  getDb().prepare('UPDATE issues SET status = ? WHERE id = ?').run(status, id)
}

export function insertToolCall(input: {
  project_id: string
  run_id?: string
  role?: string
  name: string
  args: unknown
  result_status: string
  result?: unknown
  duration_ms?: number
}) {
  const id = nanoid()
  getDb()
    .prepare(
      `INSERT INTO tool_calls (id, project_id, run_id, role, name, args_json, result_status, result_json, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.project_id,
      input.run_id ?? null,
      input.role ?? null,
      input.name,
      JSON.stringify(input.args),
      input.result_status,
      input.result ? JSON.stringify(input.result) : null,
      input.duration_ms ?? null,
      nowIso(),
    )
  return id
}
