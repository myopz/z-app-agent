import { useEffect, useState } from 'react'
import type { ThemedToken } from 'shiki'
import { highlightLines, languageLabel } from '../../lib/highlight'

function useDocumentTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
  )

  useEffect(() => {
    const el = document.documentElement
    const sync = () => setTheme(el.classList.contains('dark') ? 'dark' : 'light')
    const obs = new MutationObserver(sync)
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  return theme
}

export function CodeViewer({
  path,
  content,
  loading,
  error,
}: {
  path: string | null
  content: string
  loading?: boolean
  error?: string | null
}) {
  const theme = useDocumentTheme()
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null)

  useEffect(() => {
    let cancelled = false
    setTokens(null)
    if (!path || loading || error) return

    void highlightLines(content, path, theme).then((next) => {
      if (!cancelled) setTokens(next)
    })

    return () => {
      cancelled = true
    }
  }, [path, content, theme, loading, error])

  if (!path) {
    return (
      <div className="h-full grid place-items-center text-sm text-slate-500 px-6 text-center">
        从左侧选择文件查看代码
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full grid place-items-center text-sm text-slate-500">加载中…</div>
    )
  }

  if (error) {
    return (
      <div className="h-full grid place-items-center text-sm text-rose-600 dark:text-rose-400 px-6 text-center">
        {error}
      </div>
    )
  }

  const plainLines = content.replace(/\n$/, '').split('\n')
  const lines: Array<ThemedToken[] | string> =
    tokens && tokens.length > 0 ? tokens : plainLines
  const digits = String(Math.max(lines.length, 1)).length
  const lang = languageLabel(path)

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 min-w-0">
        <span className="text-xs text-slate-500 font-mono truncate flex-1 min-w-0">{path}</span>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
          {lang}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto bg-white dark:bg-slate-950">
        <table className="w-full border-collapse font-mono text-[12px] leading-5">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-900/80">
                <td
                  className="select-none text-right text-slate-400 dark:text-slate-600 pr-3 pl-3 align-top whitespace-nowrap border-r border-slate-100 dark:border-slate-900"
                  style={{ width: `${digits + 2}ch` }}
                >
                  {i + 1}
                </td>
                <td className="pl-3 pr-4 whitespace-pre text-slate-800 dark:text-slate-200 align-top">
                  {typeof line === 'string' ? (
                    line.length ? line : ' '
                  ) : line.length === 0 ? (
                    ' '
                  ) : (
                    line.map((token, j) => (
                      <span key={j} style={{ color: token.color }}>
                        {token.content}
                      </span>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
