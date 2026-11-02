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

  const buttons = source.match(/<button\b[^>]*>/gi) ?? []
  if (buttons.length > 0) {
    const bare = buttons.filter((tag) => !/\bclassName\s*=/.test(tag))
    if (bare.length > 0) {
      gaps.push(`${bare.length}/${buttons.length} <button> have no className (bare controls)`)
    }
  }

  const inputs = source.match(/<(?:input|select|textarea)\b[^>]*>/gi) ?? []
  if (inputs.length > 0) {
    const bare = inputs.filter((tag) => !/\bclassName\s*=/.test(tag))
    if (bare.length > 0) {
      gaps.push(`${bare.length}/${inputs.length} form controls have no className`)
    }
  }

  return gaps
}

/** Deterministic gaps the LLM often lies about in verify fences. */
export function localAcceptanceGaps(projectId: string, brief: Brief | null): string[] {
  const text = readAppTsx(projectId)
  const gaps: string[] = []

  if (isScaffoldAppSource(text)) {
    gaps.push('App.tsx is still scaffold / empty')
  }

  gaps.push(...visualUiGaps(text))

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
