import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { RoleId, ToolCall, ToolName } from '@z-app-agent/shared'
import { nanoid } from 'nanoid'
import { insertPatch, insertToolCall } from '../db/repos.ts'
import { publish } from '../events/bus.ts'
import { ensurePreview } from '../preview/manager.ts'
import { PathEscapeError, resolveInWorkspace } from './sandbox-path.ts'
import { listFileTree } from '../workspace/scaffold.ts'
import { frontendRoot } from '../workspace/paths.ts'

export type ExecContext = {
  projectId: string
  runId?: string
  role?: RoleId
  messageId?: string
  signal?: AbortSignal
}

export type ExecResult = {
  ok: boolean
  summary: string
  data?: unknown
}

const WRITE_TOOLS: ToolName[] = ['write_file', 'edit_file']

export async function executeTool(call: ToolCall, ctx: ExecContext): Promise<ExecResult> {
  const started = Date.now()
  const toolCardId = nanoid()
  publish(ctx.projectId, {
    type: 'card',
    card: {
      type: 'tool',
      id: toolCardId,
      tool: call.name,
      status: 'running',
      summary: `${call.name}…`,
      role: ctx.role,
    },
  })

  let result: ExecResult
  try {
    result = await dispatch(call, ctx)
  } catch (err) {
    result = {
      ok: false,
      summary: err instanceof Error ? err.message : String(err),
    }
  }

  insertToolCall({
    project_id: ctx.projectId,
    run_id: ctx.runId,
    role: ctx.role,
    name: call.name,
    args: call.args,
    result_status: result.ok ? 'ok' : 'error',
    result: result.data ?? { summary: result.summary },
    duration_ms: Date.now() - started,
  })

  publish(ctx.projectId, {
    type: 'card',
    card: {
      type: 'tool',
      id: toolCardId,
      tool: call.name,
      status: result.ok ? 'ok' : 'error',
      summary: result.summary,
      role: ctx.role,
    },
  })
  return result
}

async function dispatch(call: ToolCall, ctx: ExecContext): Promise<ExecResult> {
  switch (call.name) {
    case 'list_files': {
      const glob = String(call.args.glob ?? '')
      const files = listFileTree(ctx.projectId).filter((f) =>
        glob ? f.path.includes(String(glob).replace(/\*\*/g, '')) || true : true,
      )
      return { ok: true, summary: `${files.length} entries`, data: files.slice(0, 200) }
    }
    case 'read_file': {
      const rel = String(call.args.path ?? '')
      const abs = resolveInWorkspace(ctx.projectId, rel)
      const text = fs.readFileSync(abs, 'utf8')
      return { ok: true, summary: `read ${rel}`, data: { path: rel, content: text } }
    }
    case 'write_file': {
      const rel = String(call.args.path ?? '')
      const content = String(call.args.content ?? '')
      const reject = rejectTrivialSourceWrite(rel, content)
      if (reject) return { ok: false, summary: reject }
      const abs = resolveInWorkspace(ctx.projectId, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null
      fs.writeFileSync(abs, content)
      recordWrite(ctx, rel, before, content)
      return { ok: true, summary: `wrote ${rel} (${content.length} bytes)` }
    }
    case 'edit_file': {
      const rel = String(call.args.path ?? '')
      const oldStr = String(call.args.old_string ?? '')
      const newStr = String(call.args.new_string ?? '')
      const abs = resolveInWorkspace(ctx.projectId, rel)
      const before = fs.readFileSync(abs, 'utf8')
      if (!before.includes(oldStr)) {
        return { ok: false, summary: `old_string not found in ${rel}` }
      }
      const after = before.replace(oldStr, newStr)
      fs.writeFileSync(abs, after)
      recordWrite(ctx, rel, before, after)
      return { ok: true, summary: `edited ${rel}` }
    }
    case 'run_command': {
      const cmd = String(call.args.cmd ?? '')
      if (!cmd.trim()) return { ok: false, summary: 'empty cmd' }
      const cwdRel = String(call.args.cwd ?? '.')
      const cwd = resolveInWorkspace(ctx.projectId, cwdRel)
      const timeout = Number(call.args.timeout ?? 60_000)
      const { code, output } = await runShell(ctx.projectId, cwd, cmd, timeout, ctx.signal)
      return {
        ok: code === 0,
        summary: `exit ${code}`,
        data: { code, output: output.slice(-8000) },
      }
    }
    case 'install_deps': {
      const cwd = frontendRoot(ctx.projectId)
      // npm avoids parent pnpm-workspace trapping installs for generated apps
      const { code, output } = await runShell(
        ctx.projectId,
        cwd,
        'npm install --no-fund --no-audit',
        180_000,
        ctx.signal,
      )
      return { ok: code === 0, summary: code === 0 ? 'deps installed' : 'install failed', data: { output } }
    }
    case 'build': {
      const cwd = frontendRoot(ctx.projectId)
      if (!fs.existsSync(path.join(cwd, 'node_modules'))) {
        const install = await runShell(
          ctx.projectId,
          cwd,
          'npm install --no-fund --no-audit',
          180_000,
          ctx.signal,
        )
        if (install.code !== 0) {
          return {
            ok: false,
            summary: 'install failed before build',
            data: { code: install.code, output: install.output },
          }
        }
      }
      const { code, output } = await runShell(
        ctx.projectId,
        cwd,
        'npx tsc --noEmit && npx vite build',
        180_000,
        ctx.signal,
      )
      return {
        ok: code === 0,
        summary: code === 0 ? 'build ok' : 'build failed',
        data: { code, output },
      }
    }
    case 'preview': {
      const { url, port } = await ensurePreview(ctx.projectId)
      return { ok: true, summary: `preview on ${port}`, data: { url, port } }
    }
    case 'resolve_issue':
      return { ok: true, summary: 'resolve_issue acknowledged', data: call.args }
    case 'web_search':
      return { ok: false, summary: 'web_search not configured in P0' }
    default:
      return { ok: false, summary: `unknown tool` }
  }
}

/** Block placeholder writes like "..." that wipe working source files. */
function rejectTrivialSourceWrite(rel: string, content: string): string | null {
  const normalized = rel.replace(/\\/g, '/')
  const isAppSource =
    /\.(tsx?|jsx?|css|html)$/i.test(normalized) &&
    (normalized.includes('app/frontend/src/') || normalized.endsWith('App.tsx'))
  if (!isAppSource) return null
  const trimmed = content.trim()
  if (!trimmed || trimmed === '...' || trimmed === '…' || trimmed === 'pass') {
    return `refused write_file ${rel}: content is empty/placeholder — provide full file source`
  }
  if (trimmed.length < 40) {
    return `refused write_file ${rel}: content too short (${trimmed.length} chars) for app source`
  }
  if (/\.(tsx|jsx|ts|js)$/i.test(normalized) && !/\bexport\b/.test(trimmed) && !/\bfunction\b/.test(trimmed) && !/\bconst\b/.test(trimmed)) {
    return `refused write_file ${rel}: does not look like valid JS/TS source`
  }
  return null
}

function recordWrite(
  ctx: ExecContext,
  rel: string,
  before: string | null,
  after: string | null,
) {
  insertPatch({
    project_id: ctx.projectId,
    run_id: ctx.runId,
    message_id: ctx.messageId,
    path: rel,
    before_text: before,
    after_text: after,
  })
}

function runShell(
  projectId: string,
  cwd: string,
  command: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    publish(projectId, { type: 'terminal', chunk: `$ ${command}\n` })
    const proc = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const onData = (buf: Buffer) => {
      const chunk = buf.toString()
      output += chunk
      publish(projectId, { type: 'terminal', chunk })
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('command_timeout'))
    }, timeoutMs)
    const onAbort = () => {
      proc.kill('SIGKILL')
      reject(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort)
    proc.on('error', (err) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ code: code ?? 1, output })
    })
  })
}

export function isWriteTool(name: ToolName) {
  return WRITE_TOOLS.includes(name)
}

export { PathEscapeError }
