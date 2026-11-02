import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import fs from 'node:fs'
import path from 'node:path'
import {
  createProject,
  deleteProject,
  getCheckpoint,
  getProject,
  listMessages,
  listProjects,
  listVersions,
  updateProjectPort,
} from '../db/repos.ts'
import { publish, subscribe } from '../events/bus.ts'
import { llmStatus } from '../llm/client.ts'
import {
  handleUserMessage,
  resolveIssue,
  resumeRun,
  stopProject,
} from '../orch/orchestrator.ts'
import { SNAPSHOTS_ROOT } from '../paths.ts'
import { ensurePreview, getPreviewPort, stopPreview } from '../preview/manager.ts'
import { restoreVersion, revertMessage } from '../snap/snapshot.ts'
import { PathEscapeError, resolveInWorkspace, workspaceRoot } from '../tools/sandbox-path.ts'
import { listFileTree, scaffoldWorkspace } from '../workspace/scaffold.ts'

export const projectsRouter = new Hono()

projectsRouter.get('/api/projects', (c) => {
  return c.json({ projects: listProjects() })
})

projectsRouter.post('/api/projects', async (c) => {
  const body = (await c.req.json()) as {
    title?: string
    build_mode?: string
    collab_mode?: string
  }
  const title = body.title?.trim() || 'Untitled app'
  const project = createProject({
    title,
    build_mode: body.build_mode === 'goal' ? 'goal' : 'build',
    collab_mode: body.collab_mode === 'engineer' ? 'engineer' : 'team',
  })
  scaffoldWorkspace(project.id, title)
  return c.json({ project })
})

projectsRouter.get('/api/projects/:id', (c) => {
  const project = getProject(c.req.param('id'))
  if (!project) return c.json({ error: 'not_found' }, 404)
  const checkpoint = getCheckpoint(project.id)
  return c.json({
    project,
    checkpoint,
    preview_port: getPreviewPort(project.id) ?? project.preview_port,
  })
})

projectsRouter.delete('/api/projects/:id', (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) return c.json({ error: 'not_found' }, 404)
  try {
    stopProject(id, true)
  } catch {
    // ignore if no active run
  }
  stopPreview(id)
  const root = workspaceRoot(id)
  const snapDir = path.join(SNAPSHOTS_ROOT, id)
  if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true })
  if (fs.existsSync(snapDir)) fs.rmSync(snapDir, { recursive: true, force: true })
  deleteProject(id)
  return c.json({ ok: true })
})

projectsRouter.get('/api/projects/:id/messages', (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) return c.json({ error: 'not_found' }, 404)
  const messages = listMessages(id).map((m) => ({
    ...m,
    content: JSON.parse(m.content_json),
  }))
  return c.json({ messages })
})

projectsRouter.get('/api/projects/:id/events', (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) return c.json({ error: 'not_found' }, 404)
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'ready', data: JSON.stringify({ ok: true }) })
    const unsub = subscribe(id, (event) => {
      void stream.writeSSE({ data: JSON.stringify(event) })
    })
    const cp = getCheckpoint(id)
    if (cp) {
      publish(id, {
        type: 'checkpoint',
        resumable: true,
        phase: (cp.payload as { phase?: string }).phase,
      })
    }
    await new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener('abort', () => {
        unsub()
        resolve()
      })
    })
  })
})

projectsRouter.post('/api/projects/:id/messages', async (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) return c.json({ error: 'not_found' }, 404)
  const body = (await c.req.json()) as {
    text?: string
    mention?: string | null
    answers?: Record<string, string>
    planAction?: { cardId: string; action: 'approve' | 'decline'; reason?: string }
  }
  // fire-and-forget orchestration
  void handleUserMessage(id, {
    text: body.text ?? '',
    mention: body.mention,
    answers: body.answers,
    planAction: body.planAction,
  }).catch((err) => {
    publish(id, {
      type: 'error',
      code: 'message_failed',
      message: err instanceof Error ? err.message : String(err),
    })
  })
  return c.json({ ok: true })
})

projectsRouter.post('/api/projects/:id/plan/:cardId/approve', async (c) => {
  const id = c.req.param('id')
  const cardId = c.req.param('cardId')
  void handleUserMessage(id, {
    text: '',
    planAction: { cardId, action: 'approve' },
  })
  return c.json({ ok: true })
})

projectsRouter.post('/api/projects/:id/plan/:cardId/decline', async (c) => {
  const id = c.req.param('id')
  const cardId = c.req.param('cardId')
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string }
  void handleUserMessage(id, {
    text: '',
    planAction: { cardId, action: 'decline', reason: body.reason },
  })
  return c.json({ ok: true })
})

projectsRouter.post('/api/projects/:id/stop', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { clearQueue?: boolean }
  stopProject(id, Boolean(body.clearQueue))
  return c.json({ ok: true })
})

projectsRouter.post('/api/projects/:id/resume', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { force?: boolean }
  try {
    // fire-and-forget long resume; errors published via SSE
    void resumeRun(id, { force: Boolean(body.force) }).catch((err) => {
      publish(id, {
        type: 'error',
        code: 'resume_failed',
        message: err instanceof Error ? err.message : String(err),
      })
    })
    return c.json({ ok: true, started: true })
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      409,
    )
  }
})

projectsRouter.get('/api/projects/:id/files', (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) return c.json({ error: 'not_found' }, 404)
  return c.json({ files: listFileTree(id) })
})

projectsRouter.get('/api/projects/:id/files/*', (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) return c.json({ error: 'not_found' }, 404)
  const rel = c.req.path.replace(`/api/projects/${id}/files/`, '')
  try {
    const abs = resolveInWorkspace(id, decodeURIComponent(rel))
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      return c.json({ error: 'not_found' }, 404)
    }
    return c.json({ path: rel, content: fs.readFileSync(abs, 'utf8') })
  } catch (err) {
    if (err instanceof PathEscapeError) return c.json({ error: 'path_escape' }, 400)
    throw err
  }
})

projectsRouter.get('/api/projects/:id/versions', (c) => {
  const id = c.req.param('id')
  return c.json({ versions: listVersions(id) })
})

projectsRouter.post('/api/projects/:id/versions/:vid/restore', async (c) => {
  const id = c.req.param('id')
  const vid = c.req.param('vid')
  await restoreVersion(id, vid)
  return c.json({ ok: true })
})

projectsRouter.post('/api/projects/:id/messages/:mid/revert', (c) => {
  const id = c.req.param('id')
  const mid = c.req.param('mid')
  try {
    revertMessage(id, mid)
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

projectsRouter.post('/api/projects/:id/issues/:issueId/resolve', async (c) => {
  const id = c.req.param('id')
  const issueId = c.req.param('issueId')
  void resolveIssue(id, issueId).catch((err) => {
    publish(id, {
      type: 'error',
      code: 'resolve_failed',
      message: err instanceof Error ? err.message : String(err),
    })
  })
  return c.json({ ok: true })
})

projectsRouter.post('/api/projects/:id/preview', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { force?: boolean }
  try {
    const { url, port } = await ensurePreview(id, { force: Boolean(body.force) })
    updateProjectPort(id, port)
    return c.json({ url, port })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

projectsRouter.delete('/api/projects/:id/preview', (c) => {
  stopPreview(c.req.param('id'))
  return c.json({ ok: true })
})

projectsRouter.get('/api/llm/status', async (c) => {
  try {
    const status = await llmStatus()
    return c.json(status)
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      503,
    )
  }
})
