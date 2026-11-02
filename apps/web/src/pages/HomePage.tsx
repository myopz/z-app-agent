import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { IconSend } from '../components/icons'
import { createProject, listProjects, sendMessage, type Project } from '../lib/api'

export function HomePage({
  projects,
  onProjectsChange,
}: {
  projects: Project[]
  onProjectsChange: (projects: Project[]) => void
}) {
  const [text, setText] = useState('')
  const [buildMode, setBuildMode] = useState<'build' | 'goal'>('build')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nav = useNavigate()

  const placeholders = useMemo(
    () => [
      '做一个计数器，有加减和重置',
      '做一个简单待办，能添加和删除',
      '做一个问候页，输入名字后显示 Hello',
    ],
    [],
  )

  async function onCreate() {
    const raw = text.trim()
    if (!raw || busy) return

    let mention: string | null = null
    let body = raw
    const m = raw.match(/^@(\w+)\s+([\s\S]*)/)
    if (m) {
      mention = m[1]!.toLowerCase()
      body = m[2] ?? ''
    }

    setBusy(true)
    setError(null)
    try {
      const titleSource = (body || raw).replace(/\s+/g, ' ').trim()
      const title = titleSource.slice(0, 48) || 'My app'
      const p = await createProject({
        title,
        build_mode: buildMode,
        collab_mode: 'team',
      })
      await sendMessage(p.id, { text: body || raw, mention })
      const next = await listProjects()
      onProjectsChange(next)
      nav(`/p/${p.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="min-h-full flex flex-col items-center px-6 pt-10 pb-16 bg-slate-50/80 dark:bg-slate-900/30">
        <div className="home-creation-content w-full max-w-[720px] flex flex-col items-center gap-6">
          <div className="w-full text-center space-y-2 pt-4">
            <h1 className="text-3xl sm:text-[34px] font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              你今天想创造什么？
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              用一句话描述应用，Team 会分析、规划并构建预览
            </p>
          </div>

          <div className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 shadow-sm dark:shadow-none p-3 sm:p-4 space-y-3">
            <textarea
              id="home-composer"
              className="w-full min-h-[120px] resize-y rounded-xl border-0 bg-transparent px-2 py-1 text-[15px] leading-relaxed outline-none placeholder:text-slate-400"
              placeholder={`例如：${placeholders[0]}… 也可用 @alex 仅工程师模式`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void onCreate()
                }
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-1.5">
                <ModeChip
                  active={buildMode === 'build'}
                  onClick={() => setBuildMode('build')}
                  label="构建"
                />
                <ModeChip
                  active={buildMode === 'goal'}
                  onClick={() => setBuildMode('goal')}
                  label="目标"
                />
                <span className="hidden sm:inline text-[11px] text-slate-400 ml-1">
                  ⌘/Ctrl+Enter
                </span>
              </div>
              <button
                type="button"
                disabled={busy || !text.trim()}
                onClick={() => void onCreate()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 px-3.5 py-2 text-sm font-medium text-white"
              >
                <IconSend className="size-4" />
                {busy ? '创建中…' : '开始创造'}
              </button>
            </div>
          </div>

          {error && (
            <p className="w-full text-sm text-rose-600 dark:text-rose-400">{error}</p>
          )}

          <div className="w-full flex flex-wrap justify-center gap-2">
            {placeholders.map((hint) => (
              <button
                key={hint}
                type="button"
                className="max-w-full truncate rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-950/60 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:border-sky-400 dark:hover:border-sky-600"
                onClick={() => setText(hint)}
              >
                {hint}
              </button>
            ))}
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-500 pt-2">
            将你的需求交给 Team · Mike → Emma → Bob → Alex
          </p>

          {projects.length > 0 && (
            <section className="w-full pt-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">最近项目</h2>
                <span className="text-[11px] text-slate-400">也可从左侧打开</span>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {projects.slice(0, 4).map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/p/${p.id}`}
                      className="block rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/70 px-4 py-3 no-underline text-inherit hover:border-sky-400 dark:hover:border-sky-700"
                    >
                      <div className="font-medium text-sm truncate">{p.title}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {p.build_mode}/{p.collab_mode}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function ModeChip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-lg px-2.5 py-1 text-xs border transition-colors',
        active
          ? 'border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-600'
          : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900',
      ].join(' ')}
    >
      {label}
    </button>
  )
}
