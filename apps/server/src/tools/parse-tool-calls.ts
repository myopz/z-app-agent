import { ToolCallSchema, ToolNameSchema, type ToolCall, type ToolName } from '@z-app-agent/shared'

const TOOL_NAMES = ToolNameSchema.options
const TOOL_NAME_RE = TOOL_NAMES.map(escapeRegExp).join('|')

/** Canonical: ```tool_call\n{"name":"...","args":{}}\n``` */
const FENCE_TOOL_CALL = /```tool_call\s*([\s\S]*?)```/gi
/** Shorthand LLMs often emit: ```write_file\n{"path":"...","content":"..."}\n``` */
const FENCE_NAMED = new RegExp('```(' + TOOL_NAME_RE + ')\\s*([\\s\\S]*?)```', 'gi')
/** ```json\n{"name":"...","args":{}}\n``` */
const FENCE_JSON = /```json\s*([\s\S]*?)```/gi
const JSON_LINE = /^\s*\{\s*"name"\s*:/

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = []
  const seen = new Set<string>()

  const push = (call: ToolCall | null) => {
    if (!call) return
    const key = `${call.name}:${JSON.stringify(call.args)}`
    if (seen.has(key)) return
    seen.add(key)
    calls.push(call)
  }

  for (const match of text.matchAll(FENCE_TOOL_CALL)) {
    push(parseToolCallObject(match[1]))
  }

  for (const match of text.matchAll(FENCE_NAMED)) {
    const name = match[1]?.trim() as ToolName | undefined
    const body = match[2]?.trim()
    if (!name || !body) continue
    push(parseNamedFence(name, body))
  }

  for (const match of text.matchAll(FENCE_JSON)) {
    push(parseToolCallObject(match[1]))
  }

  if (calls.length === 0) {
    for (const line of text.split('\n')) {
      if (!JSON_LINE.test(line)) continue
      push(parseToolCallObject(line))
    }
  }

  return calls
}

/** True when the model clearly tried to invoke tools but parsing may have failed. */
export function looksLikeToolAttempt(text: string): boolean {
  if (/```tool_call\b/i.test(text)) return true
  if (new RegExp('```(?:' + TOOL_NAME_RE + ')\\b', 'i').test(text)) return true
  if (/```json[\s\S]*?"name"\s*:/i.test(text)) return true
  return false
}

export function stripToolCallFences(text: string): string {
  return text
    .replace(FENCE_TOOL_CALL, '')
    .replace(FENCE_NAMED, '')
    .replace(FENCE_JSON, (block) => {
      const inner = block.replace(/^```json\s*/i, '').replace(/```$/, '').trim()
      return parseToolCallObject(inner) ? '' : block
    })
    .trim()
}

function parseToolCallObject(raw: string | undefined): ToolCall | null {
  if (!raw?.trim()) return null
  try {
    const parsed = ToolCallSchema.parse(JSON.parse(raw.trim()))
    return normalizeCall(parsed.name, parsed.args)
  } catch {
    return null
  }
}

function parseNamedFence(name: ToolName, body: string): ToolCall | null {
  try {
    const args = JSON.parse(body) as Record<string, unknown>
    if (args && typeof args === 'object' && 'name' in args && 'args' in args) {
      return parseToolCallObject(body)
    }
    return normalizeCall(name, args ?? {})
  } catch {
    return null
  }
}

/** Models often emit edit_file with full `content` — treat as write_file. */
function normalizeCall(name: ToolName, args: Record<string, unknown>): ToolCall {
  if (
    name === 'edit_file' &&
    args.content != null &&
    (args.old_string == null || args.old_string === '')
  ) {
    return {
      name: 'write_file',
      args: { path: args.path, content: args.content },
    }
  }
  return { name, args }
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
