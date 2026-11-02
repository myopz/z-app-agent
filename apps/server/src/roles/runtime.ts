import { nanoid } from 'nanoid'
import type { Brief, RoleId, ToolCall } from '@z-app-agent/shared'
import { insertMessage, listMessages } from '../db/repos.ts'
import { publish } from '../events/bus.ts'
import { chatComplete } from '../llm/client.ts'
import { assembleMessages } from '../prompt/assembler.ts'
import { executeTool, isWriteTool } from '../tools/executor.ts'
import {
  looksLikeToolAttempt,
  parseToolCalls,
  stripToolCallFences,
} from '../tools/parse-tool-calls.ts'
import { ROLE_TOOLS } from './prompts.ts'

const MAX_ITERS = 10

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

  const history = listMessages(input.projectId).map((m) => ({
    role: m.role,
    agent_id: m.agent_id,
    content:
      typeof JSON.parse(m.content_json) === 'object' &&
      JSON.parse(m.content_json) &&
      'text' in (JSON.parse(m.content_json) as object)
        ? String((JSON.parse(m.content_json) as { text?: string }).text ?? m.content_json)
        : m.content_json,
  }))

  let messageId = nanoid()
  let lastText = ''
  const toolResults: string[] = []
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

  for (let i = 0; i < MAX_ITERS; i++) {
    if (input.signal?.aborted) throw new Error('aborted')
    wroteThisTurn = false
    const userText =
      toolResults.length === 0
        ? input.task
        : `${input.task}\n\nTool results so far:\n${toolResults.join('\n\n')}`

    const msgs = assembleMessages({
      role: input.role,
      userText,
      brief: input.brief,
      history,
      projectId: input.projectId,
    })

    const forceTool =
      canWrite &&
      requireWrite &&
      !wroteFiles &&
      i < 4 &&
      allowedList.length > 0

    const llm = await chatComplete(msgs, {
      signal: input.signal,
      tools: allowedList.length ? allowedList : undefined,
      toolChoice: forceTool ? 'required' : allowedList.length ? 'auto' : 'none',
    })

    lastText = llm.text
    publish(input.projectId, {
      type: 'message.delta',
      message_id: messageId,
      text: lastText || (llm.toolCalls.length ? `[native tools: ${llm.toolCalls.map((c) => c.name).join(', ')}]` : ''),
      role: input.role,
    })

    const fenceCalls = parseToolCalls(lastText)
    const calls = mergeToolCalls(llm.toolCalls, fenceCalls).filter((c) => allowed.has(c.name))

    if (calls.length === 0) {
      if (looksLikeToolAttempt(lastText)) {
        toolResults.push(
          'ERROR: tool fence found but could not parse. Use native tools or emit:\n```tool_call\n{"name":"write_file","args":{"path":"app/frontend/src/App.tsx","content":"..."}}\n```\nDo NOT put source only in ```tsx chat fences — it will not save the file unless promoted.',
        )
        continue
      }
      if (requireWrite && canWrite && !wroteFiles) {
        toolResults.push(
          'ERROR: no file writes yet. Chat/markdown code does not change the workspace by itself. Call write_file (or emit a full ```tsx source block for App.tsx which will be saved). Continue implementing.',
        )
        continue
      }
      break
    }

    for (const call of calls) {
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
      toolResults.push(
        `${call.name}: ${result.summary}\n${JSON.stringify(result.data ?? {}).slice(0, 4000)}`,
      )
    }

    const saidDone = /\bDONE\b/i.test(stripToolCallFences(lastText))
    if (saidDone) {
      if (requireWrite && canWrite && !wroteFiles) {
        toolResults.push(
          'ERROR: you said DONE but no write_file/edit_file succeeded. Call write_file now.',
        )
        continue
      }
      break
    }

    // After a successful write, allow a short summary turn without forcing more tools
    if (wroteThisTurn && requireWrite) {
      // keep looping so model can say DONE, but stop forcing tool_choice required next iters
      continue
    }
  }

  const visible = stripToolCallFences(lastText) || lastText || (wroteFiles ? 'DONE' : '')
  insertMessage({
    id: messageId,
    project_id: input.projectId,
    role: 'assistant',
    agent_id: input.role,
    kind: 'agent',
    content: { text: visible },
  })
  publish(input.projectId, {
    type: 'message',
    message_id: messageId,
    agent_id: input.role,
    kind: 'agent',
    content: { text: visible },
  })
  return { text: visible, messageId, wroteFiles }
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
