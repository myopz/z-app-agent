import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getDb } from './db/index.ts'
import { listOpenRuns, getCheckpoint, updateRun, updateIssueStatus } from './db/repos.ts'
import { publish } from './events/bus.ts'
import { PUBLIC_BASE_PATH, SERVER_PORT } from './paths.ts'
import { ensurePreview, getPreviewPort, stopPreview } from './preview/manager.ts'
import { projectsRouter } from './routes/projects.ts'

getDb()

// After process restart, in-memory AbortControllers are gone — mark orphan runners stopped
// so UI is not stuck on "running". Checkpoints remain for Resume.
for (const run of listOpenRuns()) {
  if (run.status !== 'running') continue
  updateRun(run.id, { status: 'stopped', phase: run.phase, ended: true })
  publish(run.project_id, {
    type: 'run.status',
    run_id: run.id,
    status: 'stopped',
    phase: run.phase,
  })
}
for (const row of getDb()
  .prepare(`SELECT id FROM issues WHERE status = 'resolving'`)
  .all() as Array<{ id: string }>) {
  updateIssueStatus(row.id, 'open')
}

const app = new Hono()
app.use('*', cors())

app.get('/healthz', (c) => c.json({ ok: true, service: 'z-app-agent-server' }))

app.route('/', projectsRouter)

async function proxyPreview(c: {
  req: { param: (k: string) => string; path: string; url: string; method: string; raw: Request }
}) {
  const id = c.req.param('id')
  let port = getPreviewPort(id)
  if (!port) {
    try {
      ;({ port } = await ensurePreview(id))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return new Response(`preview unavailable: ${msg}`, { status: 503 })
    }
  }

  // 经 Vite 反代后 path 为 /preview/:id/...；上游 preview Vite 的 base 含 PUBLIC_BASE_PATH
  const routePrefix = `/preview/${id}`
  const upstreamPrefix = `${PUBLIC_BASE_PATH}/preview/${id}`
  let suffix = c.req.path.startsWith(routePrefix)
    ? c.req.path.slice(routePrefix.length)
    : '/'
  if (!suffix) suffix = '/'
  const qs = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : ''
  const target = `http://127.0.0.1:${port}${upstreamPrefix}${suffix}${qs}`
  const headers = new Headers(c.req.raw.headers)
  headers.delete('host')

  try {
    const res = await fetch(target, {
      method: c.req.method,
      headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.raw.arrayBuffer(),
      redirect: 'manual',
    })
    const outHeaders = new Headers(res.headers)
    outHeaders.delete('x-frame-options')
    outHeaders.delete('content-security-policy')
    return new Response(res.body, { status: res.status, headers: outHeaders })
  } catch (err) {
    // Stale port / crashed vite — clear and try one restart
    stopPreview(id)
    try {
      const restarted = await ensurePreview(id)
      const retryTarget = `http://127.0.0.1:${restarted.port}${upstreamPrefix}${suffix}${qs}`
      const res = await fetch(retryTarget, {
        method: c.req.method,
        headers,
        body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : undefined,
        redirect: 'manual',
      })
      const outHeaders = new Headers(res.headers)
      outHeaders.delete('x-frame-options')
      outHeaders.delete('content-security-policy')
      return new Response(res.body, { status: res.status, headers: outHeaders })
    } catch (retryErr) {
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr)
      const cause = err instanceof Error ? err.message : String(err)
      return new Response(`preview proxy failed: ${cause}; restart: ${msg}`, { status: 502 })
    }
  }
}

app.all('/preview/:id/*', (c) => proxyPreview(c))
// 相对服务端路由；经 Vite 时 Location 会再补上 PUBLIC_BASE_PATH
app.all('/preview/:id', (c) => c.redirect(`/preview/${c.req.param('id')}/`))

for (const run of listOpenRuns()) {
  const cp = getCheckpoint(run.project_id)
  publish(run.project_id, {
    type: 'checkpoint',
    resumable: Boolean(cp),
    phase: run.phase,
    run_id: run.id,
  })
}

console.log(`z-app-agent server listening on http://127.0.0.1:${SERVER_PORT}`)
serve({ fetch: app.fetch, port: SERVER_PORT, hostname: '127.0.0.1' })
