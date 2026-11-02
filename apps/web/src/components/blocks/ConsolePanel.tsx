import { useMemo, useState, type ReactNode } from 'react'

type Filter = 'all' | 'error' | 'info'

type LogLine = {
  id: string
  kind: 'error' | 'info'
  source: 'terminal' | 'console'
  text: string
}

function classify(text: string): 'error' | 'info' {
  return /error|failed|exception|traceback|ERR_|TS\d{4}/i.test(text) ? 'error' : 'info'
}

function toLines(raw: string, source: 'terminal' | 'console'): LogLine[] {
  if (!raw.trim()) return []
  return raw
    .split('\n')
    .filter((t) => t.length > 0)
    .map((text, i) => ({
      id: `${source}-${i}-${text.slice(0, 24)}`,
      kind: classify(text),
      source,
      text,
    }))
}

export function ConsolePanel({
  terminal,
  consoleLog,
  onClear,
}: {
  terminal: string
  consoleLog: string
  onClear: () => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const lines = useMemo(() => {
    const all = [...toLines(terminal, 'terminal'), ...toLines(consoleLog, 'console')]
    if (filter === 'all') return all
    return all.filter((l) => l.kind === filter)
  }, [terminal, consoleLog, filter])

  const errorCount = useMemo(
    () => toLines(terminal, 'terminal').concat(toLines(consoleLog, 'console')).filter((l) => l.kind === 'error')
      .length,
    [terminal, consoleLog],
  )
  const infoCount = useMemo(
    () => toLines(terminal, 'terminal').concat(toLines(consoleLog, 'console')).filter((l) => l.kind === 'info')
      .length,
    [terminal, consoleLog],
  )

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            全部 {errorCount + infoCount}
          </FilterChip>
          <FilterChip active={filter === 'error'} onClick={() => setFilter('error')}>
            错误 {errorCount}
          </FilterChip>
          <FilterChip active={filter === 'info'} onClick={() => setFilter('info')}>
            信息 {infoCount}
          </FilterChip>
        </div>
        <button
          type="button"
          className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          onClick={onClear}
        >
          清除所有
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 py-2 font-mono text-[11px] space-y-0.5">
        {lines.length === 0 && <div className="text-slate-500">暂无日志</div>}
        {lines.map((line) => (
          <div
            key={line.id}
            className={[
              'whitespace-pre-wrap break-words',
              line.kind === 'error'
                ? 'text-rose-600 dark:text-rose-400'
                : line.source === 'terminal'
                  ? 'text-emerald-700 dark:text-emerald-300/90'
                  : 'text-amber-700 dark:text-amber-200/80',
            ].join(' ')}
          >
            <span className="text-slate-400 mr-2">[{line.source}]</span>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'px-2 py-0.5 rounded text-[11px]',
        active
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
