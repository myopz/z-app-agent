import { nanoid } from 'nanoid'
import type { Brief, RoleId } from '@z-app-agent/shared'
import { insertMessage, listMessages } from '../db/repos.ts'
import { publish } from '../events/bus.ts'
import { chatComplete } from '../llm/client.ts'
import { assembleMessages } from '../prompt/assembler.ts'
import { executeTool } from '../tools/executor.ts'
import {
  looksLikeToolAttempt,
  parseToolCalls,
  stripToolCallFences,
} from '../tools/parse-tool-calls.ts'
import { ROLE_TOOLS } from './prompts.ts'

const MAX_ITERS = 8

export async function runRole(input: {
  projectId: string
  runId: string
  role: RoleId
  task: string
  brief?: Brief | null
  signal?: AbortSignal
}): Promise<{ text: string; messageId: string }> {
  const allowed = new Set(ROLE_TOOLS[input.role])
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

    lastText = await chatComplete(msgs, { signal: input.signal })
    publish(input.projectId, {
      type: 'message.delta',
      message_id: messageId,
      text: lastText,
      role: input.role,
    })

    const calls = parseToolCalls(lastText).filter((c) => allowed.has(c.name))
    if (calls.length === 0) {
      if (looksLikeToolAttempt(lastText)) {
        toolResults.push(
          'ERROR: tool fence found but could not parse. Emit exactly:\n```tool_call\n{"name":"write_file","args":{"path":"app/frontend/src/App.tsx","content":"..."}}\n```',
        )
        continue
      }
      break
    }

    for (const call of calls) {
      if (!allowed.has(call.name)) {
        toolResults.push(`${call.name}: not allowed for ${input.role}`)
        continue
      }
      const result = await executeTool(call, {
        projectId: input.projectId,
        runId: input.runId,
        role: input.role,
        messageId,
        signal: input.signal,
      })
      toolResults.push(
        `${call.name}: ${result.summary}\n${JSON.stringify(result.data ?? {}).slice(0, 4000)}`,
      )
    }

    if (/\bDONE\b/i.test(stripToolCallFences(lastText))) {
      break
    }
  }

  const visible = stripToolCallFences(lastText) || lastText
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
  return { text: visible, messageId }
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
