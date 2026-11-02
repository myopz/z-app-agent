import { nanoid } from 'nanoid'
import type { Brief, RoleId, ToolCall } from '@z-app-agent/shared'
import { insertMessage, listMessages } from '../db/repos.ts'
import { publish } from '../events/bus.ts'
import { chatComplete, type ChatMessage } from '../llm/client.ts'
import { assembleMessages } from '../prompt/assembler.ts'
import { executeTool, isWriteTool, type ExecResult } from '../tools/executor.ts'
import {
  looksLikeToolAttempt,
  parseToolCalls,
  stripToolCallFences,
} from '../tools/parse-tool-calls.ts'
import { ROLE_TOOLS } from './prompts.ts'

const MAX_ITERS = 8
const MAX_READ_CHARS = 6_000
const MAX_CMD_CHARS = 4_000

export async function runRole(input: {
  projectId: string
  runId: string
  role: RoleId
  task: string
  brief?: Brief | null
  signal?: AbortSignal
  /** When true, refuse to finish until a write_file/edit_file succeeds. */
  requireWrite?: boolean
}): Promise<{ text: string; messageId: string; wroteFiles: boolean }> {
  const allowedList = ROLE_TOOLS[input.role]
  const allowed = new Set(allowedList)
  const canWrite = allowedList.some((t) => isWriteTool(t))
  const verifyOnly =
    /\bVERIFICATION\b/i.test(input.task) ||
    /\bRe-verify\b/i.test(input.task) ||
    /\bread-only first\b/i.test(input.task)
  const requireWrite =
    input.requireWrite ?? (input.role === 'alex' && canWrite && !verifyOnly)

  const history = listMessages(input.projectId)
    .filter((m) => !['version', 'restore', 'revert', 'queued'].includes(m.kind))
    .map((m) => {
      let content = m.content_json
      try {
        const parsed = JSON.parse(m.content_json) as { text?: unknown }
        if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
          content = parsed.text
        }
      } catch {
        // keep raw
      }
      return {
        role: m.role,
        agent_id: m.agent_id,
        kind: m.kind,
        content,
      }
    })
    .filter((m) => m.content.trim().length > 0)

  const messageId = nanoid()
  const processSteps: string[] = []
  let lastText = ''
  let wroteFiles = false
  let wroteThisTurn = false

  publish(input.projectId, {
    type: 'card',
    card: {
      type: 'activity',
      id: nanoid(),
      role: input.role,
      text: `Working…`,
    },
  })

  // Assemble once; subsequent turns append assistant/tool messages (avoids re-sending
  // system+history+all tool blobs every iteration — the main token blow-up).
  const msgs: ChatMessage[] = assembleMessages({
    role: input.role,
    userText: input.task,
    brief: input.brief,
    history,
    projectId: input.projectId,
  })

  for (let i = 0; i < MAX_ITERS; i++) {
    if (input.signal?.aborted) throw new Error('aborted')
    wroteThisTurn = false

    const forceTool =
      canWrite && requireWrite && !wroteFiles && i < 4 && allowedList.length > 0

    const llm = await chatComplete(msgs, {
      signal: input.signal,
      tools: allowedList.length ? allowedList : undefined,
      toolChoice: forceTool ? 'required' : allowedList.length ? 'auto' : 'none',
    })

    lastText = llm.text
    const fenceCalls = parseToolCalls(lastText)
    const native = llm.nativeToolCalls.filter((n) => allowed.has(n.call.name))
    const fenceOnly = mergeToolCalls(
      [],
      fenceCalls.filter((c) => allowed.has(c.name)),
    )
    // Prefer native calls when present; fence calls still needed for text-tool providers.
    const calls = native.length
      ? native.map((n) => n.call)
      : fenceOnly

    const stepVisible =
      stripToolCallFences(lastText).trim() ||
      (calls.length
        ? `→ ${calls.map((c) => c.name + toolArgHint(c)).join(', ')}`
        : '')
    if (stepVisible) {
      processSteps.push(stepVisible)
      publishProcess(input.projectId, messageId, input.role, processSteps)
    }

    if (calls.length === 0) {
      // Keep assistant turn in the thread for any follow-up nudges.
      if (lastText) msgs.push({ role: 'assistant', content: lastText })

      if (looksLikeToolAttempt(lastText)) {
        msgs.push({
          role: 'user',
          content:
            'ERROR: tool fence found but could not parse. Use native tools or emit:\n```tool_call\n{"name":"write_file","args":{"path":"app/frontend/src/App.tsx","content":"..."}}\n```\nDo NOT put source only in ```tsx chat fences — it will not save the file unless promoted.',
        })
        continue
      }
      if (requireWrite && canWrite && !wroteFiles) {
        msgs.push({
          role: 'user',
          content:
            'ERROR: no file writes yet. Chat/markdown code does not change the workspace by itself. Call write_file (or emit a full ```tsx source block for App.tsx which will be saved). Continue implementing.',
        })
        continue
      }
      break
    }

    if (native.length > 0) {
      msgs.push({
        role: 'assistant',
        content: lastText || '',
        tool_calls: native.map((n) => ({
          id: n.id,
          type: 'function' as const,
          function: {
            name: n.call.name,
            arguments: n.rawArguments,
          },
        })),
      })
    } else {
      msgs.push({ role: 'assistant', content: lastText || `Calling ${calls.map((c) => c.name).join(', ')}` })
    }

    const fenceResultLines: string[] = []
    for (let ci = 0; ci < calls.length; ci++) {
      const call = calls[ci]!
      const result = await executeTool(call, {
        projectId: input.projectId,
        runId: input.runId,
        role: input.role,
        messageId,
        signal: input.signal,
      })
      if (isWriteTool(call.name) && result.ok) {
        wroteFiles = true
        wroteThisTurn = true
      }
      const formatted = formatToolResultForLlm(call, result)
      if (native.length > 0) {
        const id = native[ci]?.id ?? native[0]?.id ?? `tool_${ci}`
        msgs.push({
          role: 'tool',
          tool_call_id: id,
          name: call.name,
          content: formatted,
        })
      } else {
        fenceResultLines.push(`${call.name}: ${formatted}`)
      }
      processSteps.push(`✔ ${call.name}${toolArgHint(call)} — ${result.summary}`)
      publishProcess(input.projectId, messageId, input.role, processSteps)
    }

    if (fenceResultLines.length > 0) {
      msgs.push({
        role: 'user',
        content: `Tool results:\n${fenceResultLines.join('\n\n')}`,
      })
    }

    const saidDone = /\bDONE\b/i.test(stripToolCallFences(lastText))
    if (saidDone) {
      if (requireWrite && canWrite && !wroteFiles) {
        msgs.push({
          role: 'user',
          content:
            'ERROR: you said DONE but no write_file/edit_file succeeded. Call write_file now.',
        })
        continue
      }
      break
    }

    // After a successful write, allow a short summary turn without forcing more tools
    if (wroteThisTurn && requireWrite) {
      continue
    }
  }

  const cleanedSteps = processSteps.map((s) => s.trim()).filter(Boolean)
  const visible =
    cleanedSteps.join('\n\n') ||
    stripToolCallFences(lastText) ||
    (wroteFiles ? 'DONE' : '')

  insertMessage({
    id: messageId,
    project_id: input.projectId,
    role: 'assistant',
    agent_id: input.role,
    kind: 'agent',
    content: { text: visible, process: cleanedSteps },
  })
  publish(input.projectId, {
    type: 'message',
    message_id: messageId,
    agent_id: input.role,
    kind: 'agent',
    content: { text: visible, process: cleanedSteps },
  })
  return { text: visible, messageId, wroteFiles }
}

function publishProcess(
  projectId: string,
  messageId: string,
  role: RoleId,
  steps: string[],
) {
  publish(projectId, {
    type: 'message.delta',
    message_id: messageId,
    text: steps.join('\n\n'),
    role,
  })
}

function toolArgHint(call: ToolCall): string {
  const path = call.args?.path
  return typeof path === 'string' && path ? `(${path})` : ''
}

/** Compact tool payloads for the LLM — full files must not accumulate across turns. */
export function formatToolResultForLlm(call: ToolCall, result: ExecResult): string {
  if (call.name === 'read_file') {
    const data = result.data as { path?: string; content?: string } | undefined
    const content = data?.content ?? ''
    const truncated =
      content.length > MAX_READ_CHARS
        ? `${content.slice(0, MAX_READ_CHARS)}\n…[truncated ${content.length - MAX_READ_CHARS} of ${content.length} chars]`
        : content
    return JSON.stringify({
      ok: result.ok,
      summary: result.summary,
      path: data?.path,
      content: truncated,
    })
  }
  if (call.name === 'write_file' || call.name === 'edit_file') {
    return JSON.stringify({ ok: result.ok, summary: result.summary })
  }
  if (
    call.name === 'run_command' ||
    call.name === 'build' ||
    call.name === 'install_deps'
  ) {
    const data = result.data as { code?: number; output?: string } | undefined
    const output = String(data?.output ?? '')
    return JSON.stringify({
      ok: result.ok,
      summary: result.summary,
      code: data?.code,
      output: output.length > MAX_CMD_CHARS ? output.slice(-MAX_CMD_CHARS) : output,
    })
  }
  if (call.name === 'list_files') {
    const files = Array.isArray(result.data) ? result.data.slice(0, 80) : result.data
    return JSON.stringify({ ok: result.ok, summary: result.summary, files })
  }
  return JSON.stringify({
    ok: result.ok,
    summary: result.summary,
    data: result.data ?? null,
  })
}

function mergeToolCalls(native: ToolCall[], fenced: ToolCall[]): ToolCall[] {
  const out: ToolCall[] = []
  const seen = new Set<string>()
  for (const call of [...native, ...fenced]) {
    const key = `${call.name}:${JSON.stringify(call.args)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(call)
  }
  return out
}

export function extractFenceJson<T = unknown>(text: string, fence: string): T | null {
  const re = new RegExp('```' + fence + '\\s*([\\s\\S]*?)```', 'i')
  const m = text.match(re)
  if (!m?.[1]) return null
  try {
    return JSON.parse(m[1].trim()) as T
  } catch {
    return null
  }
}
