import { Link, NavLink } from 'react-router-dom'
import type { Project } from '../../lib/api'
import {
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconFolder,
  IconHome,
  IconPlus,
  IconTrash,
} from '../icons'

export function Sidebar({
  projects,
  collapsed,
  onToggle,
  onNew,
  onDelete,
}: {
  projects: Project[]
  collapsed: boolean
  onToggle: () => void
  onNew?: () => void
  onDelete?: (project: Project) => void
}) {
  const recent = [...projects]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 8)

  if (collapsed) {
    return (
      <aside className="w-14 shrink-0 h-full border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-col items-center py-3 gap-2">
        <Link
          to="/"
          className="grid place-items-center size-8 rounded-lg bg-sky-600 text-white text-sm font-semibold no-underline"
          title="z-app-agent"
        >
          Z
        </Link>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center justify-center size-8 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="展开侧栏"
          title="展开侧栏"
        >
          <IconChevronRight />
        </button>
        <div className="w-6 border-t border-slate-200 dark:border-slate-800 my-1" />
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            [
              'inline-flex items-center justify-center size-8 rounded-lg no-underline',
              isActive
                ? 'bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/70',
            ].join(' ')
          }
          title="首页"
          aria-label="首页"
        >
          <IconHome />
        </NavLink>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center justify-center size-8 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/70"
          title="新建项目"
          aria-label="新建项目"
        >
          <IconPlus />
        </button>
      </aside>
    )
  }

  return (
    <aside className="w-[270px] shrink-0 h-full border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-col">
      <div className="px-3 pt-3 pb-2 flex items-center gap-1">
        <Link to="/" className="flex flex-1 items-center gap-2.5 min-w-0 no-underline text-inherit">
          <span className="grid place-items-center size-8 rounded-lg bg-sky-600 text-white text-sm font-semibold shrink-0">
            Z
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight truncate">z-app-agent</div>
            <div className="text-[11px] text-slate-500 truncate">团队模式</div>
          </div>
        </Link>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center justify-center size-8 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          aria-label="收起侧栏"
          title="收起侧栏"
        >
          <IconChevronLeft />
        </button>
      </div>

      <nav className="px-2 space-y-0.5">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            [
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm no-underline',
              isActive
                ? 'bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/70',
            ].join(' ')
          }
        >
          <IconHome />
          首页
        </NavLink>
        <button
          type="button"
          onClick={onNew}
          className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/70"
        >
          <IconPlus />
          新建项目
        </button>
      </nav>

      <div className="mt-4 px-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          <IconFolder className="size-3.5" />
          我的项目
        </div>
        <span className="text-[11px] text-slate-400">{projects.length}</span>
      </div>
      <div className="mt-1 px-2 flex-1 min-h-0 overflow-auto space-y-0.5">
        {projects.length === 0 && (
          <p className="px-3 py-2 text-xs text-slate-500">还没有项目，在中间输入需求开始。</p>
        )}
        {projects.map((p) => (
          <div
            key={p.id}
            className="group relative flex items-stretch rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/70"
          >
            <Link
              to={`/p/${p.id}`}
              className="flex-1 min-w-0 block px-3 py-2 no-underline text-inherit"
              title={p.title}
            >
              <div className="text-sm truncate pr-6">{p.title}</div>
              <div className="text-[11px] text-slate-500 truncate">
                {p.build_mode}/{p.collab_mode}
              </div>
            </Link>
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center size-7 rounded-md text-slate-400 opacity-0 group-hover:opacity-100 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 focus:opacity-100"
              title="删除项目"
              aria-label={`删除 ${p.title}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDelete?.(p)
              }}
            >
              <IconTrash className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800 px-2 py-3">
        <div className="px-3 pb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          <IconClock className="size-3.5" />
          最近
        </div>
        <div className="space-y-0.5 max-h-40 overflow-auto">
          {recent.map((p) => (
            <Link
              key={`r-${p.id}`}
              to={`/p/${p.id}`}
              className="block rounded-lg px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 no-underline hover:bg-slate-50 dark:hover:bg-slate-900/70 truncate"
            >
              {p.title}
            </Link>
          ))}
          {recent.length === 0 && (
            <p className="px-3 py-1.5 text-xs text-slate-500">暂无最近项目</p>
          )}
        </div>
      </div>
    </aside>
  )
}
