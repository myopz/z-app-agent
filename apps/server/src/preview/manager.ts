import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import { publish } from '../events/bus.ts'
import { updateProjectPort } from '../db/repos.ts'
import { PREVIEW_PORT_BASE } from '../paths.ts'
import { frontendRoot } from '../workspace/paths.ts'

type Slot = {
  projectId: string
  port: number
  proc: ChildProcess | null
  base: string
}

const slots = new Map<string, Slot>()
const usedPorts = new Set<number>()

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

async function allocPort(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const p = PREVIEW_PORT_BASE + i
    if (usedPorts.has(p)) continue
    if (!(await isPortFree(p))) continue
    usedPorts.add(p)
    return p
  }
  throw new Error('no_preview_ports')
}

function freePort(port: number) {
  usedPorts.delete(port)
}

function previewBase(projectId: string) {
  return `/preview/${projectId}/`
}

function isSlotAlive(slot: Slot | undefined): boolean {
  return Boolean(slot?.proc && slot.proc.exitCode == null && !slot.proc.killed)
}

function dropDeadSlot(projectId: string) {
  const slot = slots.get(projectId)
  if (!slot) return
  if (isSlotAlive(slot)) return
  freePort(slot.port)
  slots.delete(projectId)
  updateProjectPort(projectId, null)
}

export function getPreviewPort(projectId: string): number | null {
  dropDeadSlot(projectId)
  const slot = slots.get(projectId)
  return isSlotAlive(slot) ? slot!.port : null
}

export async function ensurePreview(projectId: string): Promise<{ url: string; port: number }> {
  const base = previewBase(projectId)
  dropDeadSlot(projectId)
  const existing = slots.get(projectId)

  // Reuse only if process is alive and was started with the correct iframe base
  if (isSlotAlive(existing) && existing && existing.base === base) {
    const url = base
    publish(projectId, { type: 'preview.ready', url })
    return { url, port: existing.port }
  }

  if (existing) {
    existing.proc?.kill('SIGTERM')
    freePort(existing.port)
    slots.delete(projectId)
  }

  const cwd = frontendRoot(projectId)
  if (!fs.existsSync(cwd)) {
    throw new Error(`frontend missing: ${cwd}`)
  }

  const port = await allocPort()
  if (!fs.existsSync(`${cwd}/node_modules`)) {
    publish(projectId, { type: 'terminal', chunk: `$ npm install (app/frontend)\n` })
    await runCmd(projectId, cwd, 'npm', ['install', '--no-fund', '--no-audit'])
  } else {
    publish(projectId, {
      type: 'terminal',
      chunk: `$ skip npm install (node_modules present)\n`,
    })
  }

  publish(projectId, {
    type: 'terminal',
    chunk: `$ npx vite --host 127.0.0.1 --port ${port} --base ${base}\n`,
  })
  const proc = spawn(
    'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(port), '--base', base],
    {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        Z_APP_PREVIEW_BASE: base,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  proc.stdout?.on('data', (buf: Buffer) => {
    publish(projectId, { type: 'console', chunk: buf.toString() })
  })
  proc.stderr?.on('data', (buf: Buffer) => {
    publish(projectId, { type: 'console', chunk: buf.toString() })
  })
  proc.on('exit', (code) => {
    publish(projectId, { type: 'console', chunk: `\n[preview exited ${code}]\n` })
    const slot = slots.get(projectId)
    if (slot?.proc === proc) {
      freePort(slot.port)
      slots.delete(projectId)
      updateProjectPort(projectId, null)
    }
  })
  proc.on('error', (err) => {
    publish(projectId, {
      type: 'console',
      chunk: `\n[preview spawn error] ${err.message}\n`,
    })
    const slot = slots.get(projectId)
    if (slot?.proc === proc) {
      freePort(slot.port)
      slots.delete(projectId)
      updateProjectPort(projectId, null)
    }
  })

  slots.set(projectId, { projectId, port, proc, base })
  updateProjectPort(projectId, port)

  try {
    await waitForHttp(`http://127.0.0.1:${port}${base}`, 60_000)
  } catch (err) {
    // fallback: some vite versions still answer on /
    try {
      await waitForHttp(`http://127.0.0.1:${port}/`, 5_000)
    } catch {
      stopPreview(projectId)
      throw err
    }
  }

  const url = base
  publish(projectId, { type: 'preview.ready', url })
  return { url, port }
}

export function stopPreview(projectId: string) {
  const slot = slots.get(projectId)
  if (!slot) return
  slot.proc?.kill('SIGTERM')
  freePort(slot.port)
  slots.delete(projectId)
  updateProjectPort(projectId, null)
}

function runCmd(projectId: string, cwd: string, cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    proc.stdout?.on('data', (buf: Buffer) => {
      publish(projectId, { type: 'terminal', chunk: buf.toString() })
    })
    proc.stderr?.on('data', (buf: Buffer) => {
      publish(projectId, { type: 'terminal', chunk: buf.toString() })
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited ${code}`))
    })
  })
}

async function waitForHttp(url: string, timeoutMs: number) {
  const start = Date.now()
  let lastErr = ''
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return
      lastErr = `HTTP ${res.status}`
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`preview_timeout: ${url} (${lastErr})`)
}
