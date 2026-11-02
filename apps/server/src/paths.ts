import './load-env.ts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
/** apps/server */
export const SERVER_ROOT = path.resolve(here, '..')
/** repo root z-app-agent */
export const REPO_ROOT = path.resolve(SERVER_ROOT, '../..')
export const WORKSPACES_ROOT = path.resolve(REPO_ROOT, 'workspaces')
export const DATA_ROOT = path.resolve(REPO_ROOT, 'data')
export const DB_PATH = path.resolve(DATA_ROOT, 'z-app-agent.db')
export const SNAPSHOTS_ROOT = path.resolve(DATA_ROOT, 'snapshots')
export const TEMPLATE_ROOT = path.resolve(SERVER_ROOT, 'templates/vite-react-ts')

export const SERVER_PORT = Number(process.env.PORT ?? 39000)

/** Public URL prefix (`` or `/zapp`). Must match web Vite `PUBLIC_BASE_PATH`. */
export function normalizePublicBasePath(raw: string | undefined): string {
  const t = (raw ?? '/zapp').trim()
  if (!t || t === '/') return ''
  return `/${t.replace(/^\/+|\/+$/g, '')}`
}

export const PUBLIC_BASE_PATH = normalizePublicBasePath(process.env.PUBLIC_BASE_PATH)

/**
 * OpenAI-compatible API base, including `/v1` (or provider equivalent).
 * Default: ittoolplus free aggregator.
 * Examples:
 * - https://ittoolplus.cn/api/openai/v1
 * - https://api.openai.com/v1
 * - https://api.deepseek.com/v1
 * - https://api.siliconflow.cn/v1
 */
function resolveLlmBaseUrl(): string {
  const raw =
    process.env.LLM_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    // legacy alias: host root without /api/openai/v1
    (process.env.FREE_AI_BASE_URL
      ? `${process.env.FREE_AI_BASE_URL.replace(/\/$/, '')}/api/openai/v1`
      : '') ||
    'https://ittoolplus.cn/api/openai/v1'
  return raw.replace(/\/$/, '')
}

export const LLM_BASE_URL = resolveLlmBaseUrl()
export const LLM_API_KEY = (
  process.env.LLM_API_KEY?.trim() ||
  process.env.OPENAI_API_KEY?.trim() ||
  ''
)
export const LLM_MODEL = (
  process.env.LLM_MODEL?.trim() ||
  process.env.OPENAI_MODEL?.trim() ||
  'auto'
)
export const LLM_TIMEOUT_MS = Number(
  process.env.LLM_TIMEOUT_MS ?? process.env.LLM_FIRST_TOKEN_MS ?? 90000,
)
/** @deprecated use LLM_TIMEOUT_MS */
export const LLM_FIRST_TOKEN_MS = LLM_TIMEOUT_MS

export const MAX_FIX_ATTEMPTS = Number(process.env.MAX_FIX_ATTEMPTS ?? 3)
export const PREVIEW_PORT_BASE = Number(process.env.PREVIEW_PORT_BASE ?? 3900)

/** Optional JSON object of extra request headers (e.g. OpenRouter HTTP-Referer). */
export function llmExtraHeaders(): Record<string, string> {
  const raw = process.env.LLM_EXTRA_HEADERS?.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (v != null) out[k] = String(v)
    }
    return out
  } catch {
    console.warn('[llm] LLM_EXTRA_HEADERS is not valid JSON, ignored')
    return {}
  }
}
