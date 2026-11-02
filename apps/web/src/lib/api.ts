import { withBase } from './base'

export type Project = {
  id: string
  title: string
  build_mode: string
  collab_mode: string
  preview_port: number | null
  created_at: string
  updated_at: string
}

export type Message = {
  id: string
  project_id: string
  role: string
  agent_id: string | null
  kind: string
  content: unknown
  created_at: string
}

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  const resolved = await res
  if (!resolved.ok) {
    const text = await resolved.text()
    throw new Error(text || resolved.statusText)
  }
  return resolved.json() as Promise<T>
}

function api(path: string) {
  return withBase(path)
}

export function listProjects() {
  return json<{ projects: Project[] }>(fetch(api('/api/projects'))).then((r) => r.projects)
}

export function createProject(body: {
  title: string
  build_mode?: string
  collab_mode?: string
}) {
  return json<{ project: Project }>(
    fetch(api('/api/projects'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  ).then((r) => r.project)
}

export function deleteProject(id: string) {
  return json<{ ok: boolean }>(
    fetch(api(`/api/projects/${id}`), { method: 'DELETE' }),
  )
}

export function getProject(id: string) {
  return json<{
    project: Project
    checkpoint: { payload: unknown; updated_at: string } | null
  }>(fetch(api(`/api/projects/${id}`)))
}

export function listMessages(id: string) {
  return json<{ messages: Message[] }>(fetch(api(`/api/projects/${id}/messages`))).then(
    (r) => r.messages,
  )
}

export function listFiles(id: string) {
  return json<{ files: Array<{ path: string; type: 'file' | 'dir' }> }>(
    fetch(api(`/api/projects/${id}/files`)),
  ).then((r) => r.files)
}

export function readFile(id: string, path: string) {
  const enc = path
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/')
  return json<{ path: string; content: string }>(
    fetch(api(`/api/projects/${id}/files/${enc}`)),
  )
}

export function listVersions(id: string) {
  return json<{
    versions: Array<{ id: string; label: string; created_at: string }>
  }>(fetch(api(`/api/projects/${id}/versions`))).then((r) => r.versions)
}

export function sendMessage(
  id: string,
  body: {
    text: string
    mention?: string | null
    answers?: Record<string, string>
    planAction?: { cardId: string; action: 'approve' | 'decline'; reason?: string }
  },
) {
  return json<{ ok: boolean }>(
    fetch(api(`/api/projects/${id}/messages`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

export function approvePlan(id: string, cardId: string) {
  return fetch(api(`/api/projects/${id}/plan/${cardId}/approve`), { method: 'POST' })
}

export function declinePlan(id: string, cardId: string, reason?: string) {
  return fetch(api(`/api/projects/${id}/plan/${cardId}/decline`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
}

export function stopRun(id: string) {
  return fetch(api(`/api/projects/${id}/stop`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clearQueue: false }),
  })
}

export function resumeRun(id: string, opts?: { force?: boolean }) {
  return json<{ ok: boolean; started?: boolean }>(
    fetch(api(`/api/projects/${id}/resume`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: Boolean(opts?.force) }),
    }),
  )
}

export function restoreVersion(id: string, vid: string) {
  return fetch(api(`/api/projects/${id}/versions/${vid}/restore`), { method: 'POST' })
}

export function revertMessage(id: string, mid: string) {
  return fetch(api(`/api/projects/${id}/messages/${mid}/revert`), { method: 'POST' })
}

export function resolveIssue(id: string, issueId: string) {
  return fetch(api(`/api/projects/${id}/issues/${issueId}/resolve`), { method: 'POST' })
}

export function startPreview(id: string, opts?: { force?: boolean }) {
  return json<{ url: string; port: number }>(
    fetch(api(`/api/projects/${id}/preview`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: Boolean(opts?.force) }),
    }),
  ).then((r) => ({ ...r, url: withBase(r.url) }))
}
