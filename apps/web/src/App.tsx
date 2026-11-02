import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { IconHome, IconMoon, IconSun } from './components/icons'
import { Sidebar } from './components/layout/Sidebar'
import { useTheme } from './hooks/useTheme'
import { deleteProject, listProjects, type Project } from './lib/api'
import { purgeProjectCache } from './lib/idb/messages'
import { HomePage } from './pages/HomePage'
import { ProjectPage } from './pages/ProjectPage'

const SIDEBAR_COLLAPSED_KEY = 'z-app-agent-sidebar-collapsed'

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const isHome = location.pathname === '/'
  const [projects, setProjects] = useState<Project[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
  }, [location.pathname])

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }

  async function onDeleteProject(project: Project) {
    const ok = window.confirm(`确定删除项目「${project.title}」？工作区与版本快照将一并清除，不可恢复。`)
    if (!ok) return
    try {
      await deleteProject(project.id)
      await purgeProjectCache(project.id)
      setProjects((prev) => prev.filter((p) => p.id !== project.id))
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="h-full flex bg-[var(--app-bg)] text-[var(--app-fg)]">
      {isHome && (
        <Sidebar
          projects={projects}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          onDelete={(p) => void onDeleteProject(p)}
          onNew={() => {
            const el = document.getElementById('home-composer')
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            ;(el as HTMLTextAreaElement | null)?.focus()
          }}
        />
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-12 shrink-0 px-3 flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-950/70 backdrop-blur">
          <div className="flex items-center">
            {!isHome && (
              <Link
                to="/"
                className="inline-flex items-center justify-center size-8 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 no-underline"
                aria-label="首页"
                title="首页"
              >
                <IconHome />
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center justify-center size-8 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label={theme === 'light' ? '切换黑夜' : '切换白天'}
            title={theme === 'light' ? '切换黑夜' : '切换白天'}
          >
            {theme === 'light' ? <IconMoon /> : <IconSun />}
          </button>
        </header>

        <div className="flex-1 min-h-0">
          <Routes>
            <Route
              path="/"
              element={
                <HomePage
                  projects={projects}
                  onProjectsChange={setProjects}
                />
              }
            />
            <Route path="/p/:id" element={<ProjectPage />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}
