import {
  LLM_API_KEY,
  LLM_BASE_URL,
  LLM_MODEL,
  LLM_TIMEOUT_MS,
  llmExtraHeaders,
} from '../paths.ts'

export class LlmError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'LlmError'
    this.status = status
  }
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LlmChatOptions = {
  signal?: AbortSignal
  temperature?: number
  model?: string
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

export async function chatComplete(
  messages: ChatMessage[],
  opts?: LlmChatOptions,
): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await chatCompleteOnce(messages, opts)
    } catch (err) {
      lastErr = err
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
  opts?: LlmChatOptions,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  opts?.signal?.addEventListener('abort', onAbort)

  try {
    const body = {
      model: resolveModel(opts?.model),
      messages,
      stream: false,
      temperature: opts?.temperature ?? 0.2,
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
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
    }
    const raw = json.choices?.[0]?.message?.content
    const content =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? raw.map((p) => (typeof p === 'string' ? p : p.text ?? '')).join('')
          : null
    if (typeof content !== 'string' || !content) {
      throw new LlmError(502, 'empty_llm_content')
    }
    return content
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
    messages,
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
