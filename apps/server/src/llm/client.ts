import type { ToolCall, ToolName } from '@z-app-agent/shared'
import { ToolCallSchema } from '@z-app-agent/shared'
import {
  LLM_API_KEY,
  LLM_BASE_URL,
  LLM_MODEL,
  LLM_TIMEOUT_MS,
  llmExtraHeaders,
} from '../paths.ts'
import { toOpenAiTools } from '../tools/openai-tools.ts'

export class LlmError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'LlmError'
    this.status = status
  }
}

export type AssistantToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  name?: string
  tool_calls?: AssistantToolCall[]
}

export type LlmChatOptions = {
  signal?: AbortSignal
  temperature?: number
  model?: string
  /** OpenAI-compatible function tools (names). */
  tools?: ToolName[]
  /** Force at least one tool call when supported by the provider. */
  toolChoice?: 'auto' | 'required' | 'none'
}

export type NativeToolCall = {
  id: string
  call: ToolCall
  rawArguments: string
}

export type LlmUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export type ChatCompleteResult = {
  text: string
  toolCalls: ToolCall[]
  nativeToolCalls: NativeToolCall[]
  /** Provider returned native tool_calls */
  usedNativeTools: boolean
  usage?: LlmUsage
}

function chatCompletionsUrl() {
  return `${LLM_BASE_URL}/chat/completions`
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...llmExtraHeaders(),
  }
  if (LLM_API_KEY) {
    headers.Authorization = `Bearer ${LLM_API_KEY}`
  }
  return headers
}

function resolveModel(override?: string) {
  return override?.trim() || LLM_MODEL || 'auto'
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

export function getLlmConfigPublic() {
  return {
    baseUrl: LLM_BASE_URL,
    model: LLM_MODEL,
    hasApiKey: Boolean(LLM_API_KEY),
    timeoutMs: LLM_TIMEOUT_MS,
  }
}

function serializeMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool' as const,
        content: m.content ?? '',
        tool_call_id: m.tool_call_id ?? 'tool',
        ...(m.name ? { name: m.name } : {}),
      }
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return {
        role: 'assistant' as const,
        content: m.content,
        tool_calls: m.tool_calls,
      }
    }
    return { role: m.role, content: m.content ?? '' }
  })
}

export async function chatComplete(
  messages: ChatMessage[],
  opts?: LlmChatOptions,
): Promise<ChatCompleteResult> {
  let lastErr: unknown
  let disableTools = false
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await chatCompleteOnce(messages, opts, disableTools)
    } catch (err) {
      lastErr = err
      // Provider may reject tools — retry once without native tools
      if (
        !disableTools &&
        opts?.tools?.length &&
        err instanceof LlmError &&
        (err.status === 400 || err.status === 404 || err.status === 422)
      ) {
        disableTools = true
        continue
      }
      if (err instanceof LlmError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw err
      }
      if (attempt < 2) await sleep(500 * (attempt + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new LlmError(500, String(lastErr))
}

async function chatCompleteOnce(
  messages: ChatMessage[],
  opts: LlmChatOptions | undefined,
  disableTools: boolean,
): Promise<ChatCompleteResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  opts?.signal?.addEventListener('abort', onAbort)

  try {
    const useTools = !disableTools && Boolean(opts?.tools?.length)
    const body: Record<string, unknown> = {
      model: resolveModel(opts?.model),
      messages: serializeMessages(messages),
      stream: false,
      temperature: opts?.temperature ?? 0.2,
    }
    if (useTools && opts?.tools) {
      body.tools = toOpenAiTools(opts.tools)
      body.tool_choice = opts.toolChoice ?? 'auto'
    }

    const res = await fetch(chatCompletionsUrl(), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new LlmError(res.status, text || res.statusText)
    }
    const json = (await res.json()) as {
      usage?: LlmUsage
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }> | null
          tool_calls?: Array<{
            id?: string
            type?: string
            function?: { name?: string; arguments?: string }
          }>
        }
      }>
    }
    const message = json.choices?.[0]?.message
    const raw = message?.content
    const text =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? raw.map((p) => (typeof p === 'string' ? p : p.text ?? '')).join('')
          : ''

    const nativeToolCalls: NativeToolCall[] = []
    const toolCalls: ToolCall[] = []
    let toolIdx = 0
    for (const tc of message?.tool_calls ?? []) {
      const name = tc.function?.name
      const argsRaw = tc.function?.arguments ?? '{}'
      if (!name) continue
      try {
        const args = JSON.parse(argsRaw) as Record<string, unknown>
        const call = ToolCallSchema.parse({ name, args })
        const id = tc.id?.trim() || `call_${toolIdx}`
        toolIdx++
        nativeToolCalls.push({ id, call, rawArguments: argsRaw })
        toolCalls.push(call)
      } catch {
        // skip malformed native tool call
      }
    }

    if (!text && toolCalls.length === 0) {
      throw new LlmError(502, 'empty_llm_content')
    }

    const usage = json.usage
    if (usage?.total_tokens != null || usage?.prompt_tokens != null) {
      console.info(
        '[llm.usage]',
        JSON.stringify({
          model: resolveModel(opts?.model),
          prompt_tokens: usage.prompt_tokens ?? null,
          completion_tokens: usage.completion_tokens ?? null,
          total_tokens: usage.total_tokens ?? null,
          messages: messages.length,
          tools: useTools,
        }),
      )
    }

    return {
      text: text || '',
      toolCalls,
      nativeToolCalls,
      usedNativeTools: toolCalls.length > 0,
      usage,
    }
  } catch (err) {
    if (err instanceof LlmError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LlmError(504, 'llm_timeout')
    }
    throw new LlmError(502, err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(timer)
    opts?.signal?.removeEventListener('abort', onAbort)
  }
}

export async function* chatStream(
  messages: ChatMessage[],
  opts?: LlmChatOptions,
): AsyncGenerator<string> {
  const body = {
    model: resolveModel(opts?.model),
    messages: serializeMessages(messages),
    stream: true,
    temperature: opts?.temperature ?? 0.2,
  }

  const res = await fetch(chatCompletionsUrl(), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: opts?.signal,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new LlmError(res.status, text || res.statusText)
  }
  if (!res.body) throw new LlmError(502, 'no_stream_body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>
        }
        const delta = json.choices?.[0]?.delta?.content
        if (delta) yield delta
      } catch {
        // ignore partial json
      }
    }
  }
}

/** Probe OpenAI-compatible `/models` (and optional `/free-status` for ittoolplus). */
export async function llmStatus(): Promise<unknown> {
  const local = getLlmConfigPublic()
  try {
    const res = await fetch(`${LLM_BASE_URL}/models`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(Math.min(LLM_TIMEOUT_MS, 15_000)),
    })
    if (res.ok) {
      return { ...local, models: await res.json() }
    }
    const freeRes = await fetch(`${LLM_BASE_URL}/free-status`, {
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null)
    if (freeRes?.ok) {
      return {
        ...local,
        freeStatus: await freeRes.json(),
        modelsHttpStatus: res.status,
      }
    }
    return {
      ...local,
      modelsHttpStatus: res.status,
      modelsError: await res.text(),
    }
  } catch (err) {
    return {
      ...local,
      probeError: err instanceof Error ? err.message : String(err),
    }
  }
}
