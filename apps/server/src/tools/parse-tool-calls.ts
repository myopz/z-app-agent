import { ToolCallSchema, ToolNameSchema, type ToolCall, type ToolName } from '@z-app-agent/shared'

const TOOL_NAMES = ToolNameSchema.options
const TOOL_NAME_RE = TOOL_NAMES.map(escapeRegExp).join('|')

/** Canonical: ```tool_call\n{"name":"...","args":{}}\n``` */
const FENCE_TOOL_CALL = /```tool_call\s*([\s\S]*?)```/gi
/** Shorthand LLMs often emit: ```write_file\n{"path":"...","content":"..."}\n``` */
const FENCE_NAMED = new RegExp('```(' + TOOL_NAME_RE + ')\\s*([\\s\\S]*?)```', 'gi')
/** ```json\n{"name":"...","args":{}}\n``` */
const FENCE_JSON = /```json\s*([\s\S]*?)```/gi
/** Models dump source in chat instead of calling write_file */
const FENCE_CODE =
  /```(tsx|typescript|ts|jsx|javascript|js|css|html)\s*(?:[^\n]*)\n([\s\S]*?)```/gi
const JSON_LINE = /^\s*\{\s*"name"\s*:/
const PATH_IN_PROSE =
  /(?:write(?:_file)?|update|edit|create|save|overwrite|in|to)\s+[`'"]?((?:app\/frontend\/)?src\/[\w./-]+\.(?:tsx?|jsx?|css|html)|[\w./-]+\.(?:tsx?|jsx?|css))[`'"]?/i
const APP_PATH = 'app/frontend/src/App.tsx'

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

  // Root-cause bridge: ```tsx source dumps → write_file
  if (!calls.some((c) => c.name === 'write_file' || c.name === 'edit_file')) {
    for (const call of extractCodeFenceWrites(text)) {
      push(call)
    }
  }

  return calls
}

/**
 * Promote markdown code fences into write_file calls.
 * This is the common failure mode: model "implements" in chat and says DONE.
 */
export function extractCodeFenceWrites(text: string): ToolCall[] {
  const out: ToolCall[] = []
  for (const match of text.matchAll(FENCE_CODE)) {
    const lang = (match[1] ?? '').toLowerCase()
    const content = match[2] ?? ''
    if (!looksLikeSourceFile(content)) continue

    const idx = match.index ?? 0
    const before = text.slice(Math.max(0, idx - 240), idx)
    const path = resolveWritePath(before, lang)
    out.push({
      name: 'write_file',
      args: { path, content: content.replace(/\n$/, '') },
    })
  }
  return out
}

export function looksLikeCodeDump(text: string): boolean {
  return extractCodeFenceWrites(text).length > 0
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
    .replace(FENCE_CODE, '')
    .replace(FENCE_JSON, (block) => {
      const inner = block.replace(/^```json\s*/i, '').replace(/```$/, '').trim()
      return parseToolCallObject(inner) ? '' : block
    })
    .trim()
}

function resolveWritePath(before: string, lang: string): string {
  const m = before.match(PATH_IN_PROSE)
  if (m?.[1]) {
    const raw = m[1].replace(/^\.\//, '')
    if (raw.startsWith('app/')) return raw
    if (raw.startsWith('src/')) return `app/frontend/${raw}`
    if (raw === 'App.tsx' || raw === 'App.jsx') return APP_PATH
    if (raw.includes('/')) return raw.startsWith('app/') ? raw : `app/frontend/${raw}`
    return `app/frontend/src/${raw}`
  }
  if (lang === 'css') return 'app/frontend/src/index.css'
  if (lang === 'html') return 'app/frontend/index.html'
  return APP_PATH
}

function looksLikeSourceFile(content: string): boolean {
  const trimmed = content.trim()
  if (trimmed.length < 40) return false
  if (trimmed === '...' || trimmed === '…') return false
  return (
    /\bexport\b/.test(trimmed) ||
    /\bfunction\b/.test(trimmed) ||
    /\bconst\b/.test(trimmed) ||
    /\bimport\b/.test(trimmed) ||
    trimmed.includes('{')
  )
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
