import type { Brief } from '@z-app-agent/shared'
import fs from 'node:fs'
import path from 'node:path'
import { workspaceRoot } from '../tools/sandbox-path.ts'

/** Layout / visual Tailwind utilities that bare HTML never has. */
const VISUAL_UTIL =
  /\b(min-h-|h-screen|flex|grid|gap-|space-[xy]-|p-\d|px-|py-|pt-|pb-|m-\d|mx-|my-|rounded|bg-|text-|shadow|border|w-full|max-w-|items-|justify-|backdrop-|from-|to-|via-)/

export function readAppTsx(projectId: string): string {
  const appPath = path.join(workspaceRoot(projectId), 'app/frontend/src/App.tsx')
  if (!fs.existsSync(appPath)) return ''
  return fs.readFileSync(appPath, 'utf8')
}

export function isScaffoldAppSource(text: string): boolean {
  return (
    !text ||
    text.includes('Ready to build') ||
    text.trim() === '...' ||
    text.trim().length < 40
  )
}

export function isScaffoldApp(projectId: string): boolean {
  return isScaffoldAppSource(readAppTsx(projectId))
}

/**
 * Find the index of the real `>` that closes a JSX/HTML opening tag,
 * skipping string literals and nested `{...}` expressions (so `() =>` does not truncate).
 */
export function findJsxOpeningTagEnd(source: string, from: number): number {
  let i = from
  let braceDepth = 0
  let quote: '"' | "'" | '`' | null = null

  while (i < source.length) {
    const ch = source[i]!

    if (quote) {
      if (ch === '\\' && i + 1 < source.length && quote !== '`') {
        i += 2
        continue
      }
      if (quote === '`' && ch === '$' && source[i + 1] === '{') {
        braceDepth++
        quote = null
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }

    if (braceDepth > 0) {
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch
        i++
        continue
      }
      if (ch === '{') braceDepth++
      else if (ch === '}') braceDepth--
      i++
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      i++
      continue
    }
    if (ch === '{') {
      braceDepth++
      i++
      continue
    }
    if (ch === '>') return i
    i++
  }

  return -1
}

/** Collect full opening tags for the given element names (case-insensitive). */
export function collectJsxOpeningTags(source: string, tagNames: readonly string[]): string[] {
  if (!tagNames.length) return []
  const pattern = new RegExp(`<(?:${tagNames.join('|')})\\b`, 'gi')
  const tags: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const start = match.index
    const end = findJsxOpeningTagEnd(source, start + match[0].length)
    if (end < 0) {
      pattern.lastIndex = start + match[0].length
      continue
    }
    tags.push(source.slice(start, end + 1))
    pattern.lastIndex = end + 1
  }
  return tags
}

function countBareControls(tags: string[]): number {
  return tags.filter((tag) => !/\bclassName\s*=/.test(tag)).length
}

/**
 * Invariant: product UI must be Tailwind-styled, not browser-default bare markup.
 * Single authority for "has a real UI page" — used after Alex and in verify.
 */
export function visualUiGaps(source: string): string[] {
  const gaps: string[] = []
  if (!source.trim()) {
    gaps.push('App.tsx missing')
    return gaps
  }
  if (source.includes('Ready to build')) {
    gaps.push('App.tsx is still scaffold')
    return gaps
  }

  const classCount = (source.match(/className\s*=/g) ?? []).length
  if (classCount < 3) {
    gaps.push(
      `UI lacks Tailwind styling (found ${classCount} className; need ≥3 with layout/visual utilities)`,
    )
  } else if (!VISUAL_UTIL.test(source)) {
    gaps.push(
      'UI className present but missing layout/visual Tailwind utilities (flex/grid/bg/padding/…)',
    )
  }

  const buttons = collectJsxOpeningTags(source, ['button'])
  if (buttons.length > 0) {
    const bare = countBareControls(buttons)
    if (bare > 0) {
      gaps.push(`${bare}/${buttons.length} <button> have no className (bare controls)`)
    }
  }

  const inputs = collectJsxOpeningTags(source, ['input', 'select', 'textarea'])
  if (inputs.length > 0) {
    const bare = countBareControls(inputs)
    if (bare > 0) {
      gaps.push(`${bare}/${inputs.length} form controls have no className`)
    }
  }

  return gaps
}

/** Tailwind v4 + @tailwindcss/vite must use `@import 'tailwindcss'`, not v3 `@tailwind` directives. */
export function tailwindV4CssGaps(projectId: string): string[] {
  const frontend = path.join(workspaceRoot(projectId), 'app/frontend')
  const pkgPath = path.join(frontend, 'package.json')
  const cssPath = path.join(frontend, 'src/index.css')
  if (!fs.existsSync(pkgPath) || !fs.existsSync(cssPath)) return []

  let pkgText: string
  try {
    pkgText = fs.readFileSync(pkgPath, 'utf8')
  } catch {
    return []
  }

  const usesVitePlugin = pkgText.includes('@tailwindcss/vite')
  const usesTw4 =
    usesVitePlugin ||
    /"tailwindcss"\s*:\s*"[^"]*4(?:\.\d+)*[^"]*"/.test(pkgText)
  if (!usesTw4) return []

  const css = fs.readFileSync(cssPath, 'utf8')
  const hasImport = /@import\s+['"]tailwindcss['"]/.test(css)
  const hasV3Directives = /@tailwind\s+(?:base|components|utilities)\b/.test(css)
  if (hasV3Directives && !hasImport) {
    return [
      "index.css uses Tailwind v3 @tailwind directives but project is Tailwind v4 (need @import 'tailwindcss')",
    ]
  }
  return []
}

/** Deterministic gaps the LLM often lies about in verify fences. */
export function localAcceptanceGaps(projectId: string, brief: Brief | null): string[] {
  const text = readAppTsx(projectId)
  const gaps: string[] = []

  if (isScaffoldAppSource(text)) {
    gaps.push('App.tsx is still scaffold / empty')
  }

  gaps.push(...visualUiGaps(text))
  gaps.push(...tailwindV4CssGaps(projectId))

  const hay = `${brief?.goal ?? ''}\n${(brief?.acceptance ?? []).join('\n')}\n${(brief?.sections ?? []).join('\n')}`.toLowerCase()
  if (/scientific|科学|trig|sin\b|cos\b|tan\b|log\b|sqrt|exponent/.test(hay)) {
    const needed = ['sin', 'cos', 'tan', 'log', 'sqrt', '√']
    const hit = needed.filter((k) => text.toLowerCase().includes(k.toLowerCase()) || text.includes(k))
    if (hit.length < 3) {
      gaps.push(
        `scientific calculator UI missing (found ${hit.join(', ') || 'none'}; need sin/cos/tan/log/√)`,
      )
    }
  }
  if (/counter|计数/.test(hay) && !/\bcount\b|setCount/i.test(text)) {
    gaps.push('counter state/UI not found in App.tsx')
  }
  if (/hello|问候|greeting/.test(hay) && !/hello|greeting|name/i.test(text)) {
    gaps.push('greeting UI not found in App.tsx')
  }

  return [...new Set(gaps)]
}
