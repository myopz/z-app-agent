import {
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
  type ThemedToken,
} from 'shiki'

const THEMES = ['github-light', 'github-dark'] as const
const LANGS = [
  'tsx',
  'typescript',
  'javascript',
  'jsx',
  'json',
  'css',
  'html',
  'markdown',
  'bash',
  'shellscript',
  'yaml',
  'toml',
  'xml',
  'sql',
  'python',
] as const satisfies readonly BundledLanguage[]

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [...THEMES],
      langs: [...LANGS],
    })
  }
  return highlighterPromise
}

const EXT_LANG: Record<string, BundledLanguage> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  mdx: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  svg: 'xml',
  xml: 'xml',
  sql: 'sql',
  py: 'python',
}

export function languageFromPath(filePath: string): BundledLanguage | null {
  const base = filePath.split('/').pop() ?? filePath
  if (base === 'Dockerfile') return null
  const ext = base.includes('.') ? base.split('.').pop()?.toLowerCase() : ''
  if (!ext) return null
  return EXT_LANG[ext] ?? null
}

export function languageLabel(filePath: string): string {
  return languageFromPath(filePath) ?? (filePath.split('.').pop()?.toUpperCase() || 'TEXT')
}

export async function highlightLines(
  code: string,
  filePath: string,
  theme: 'light' | 'dark',
): Promise<ThemedToken[][] | null> {
  const lang = languageFromPath(filePath)
  if (!lang) return null
  try {
    const hl = await getHighlighter()
    const result = hl.codeToTokens(code, {
      lang,
      theme: theme === 'dark' ? 'github-dark' : 'github-light',
    })
    return result.tokens
  } catch {
    return null
  }
}
