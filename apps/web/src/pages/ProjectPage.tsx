import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useParams } from 'react-router-dom'
import type { Card, ServerEvent } from '@z-app-agent/shared'
import { ROLE_LABELS, type RoleId } from '@z-app-agent/shared'
import {
  approvePlan,
  declinePlan,
  getProject,
  listFiles,
  listMessages,
  listVersions,
  resolveIssue,
  restoreVersion,
  resumeRun,
  revertMessage,
  sendMessage,
  readFile,
  startPreview,
  stopRun,
  type Message,
  type Project,
} from '../lib/api'
import { withBase } from '../lib/base'
import { invalidateMessages, cacheMessages, readCachedMessages } from '../lib/idb/messages'
import { appendLog, clearLogs, readLogs } from '../lib/idb/logs'
import { loadDraft, saveDraft, touchRecent } from '../lib/idb/ui'
import { CodeViewer } from '../components/blocks/CodeViewer'
import { ConsolePanel } from '../components/blocks/ConsolePanel'
import { CardView } from '../components/cards/CardView'
import { Collapsible } from '../components/Collapsible'
import { FileTree } from '../components/files/FileTree'
import { IconChevronLeft, IconChevronRight } from '../components/icons'
import { Markdown } from '../components/Markdown'

type ChatItem =
  | { kind: 'message'; message: Message }
  | { kind: 'card'; card: Card }

type RightTab = 'code' | 'app' | 'console'

const CHAT_COLLAPSED_KEY = 'z-app-agent-chat-collapsed'
const CHAT_WIDTH_KEY = 'z-app-agent-chat-width'
const RIGHT_TAB_KEY = 'z-app-agent-right-tab'
const CHAT_WIDTH_MIN = 280
const CHAT_WIDTH_MAX = 720
const CHAT_WIDTH_DEFAULT = 420
const NARROW_BREAKPOINT = 900

function readChatCollapsed(): boolean {
  try {
    return localStorage.getItem(CHAT_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function readChatWidth(): number {
  try {
    const n = Number(localStorage.getItem(CHAT_WIDTH_KEY))
    if (Number.isFinite(n) && n >= CHAT_WIDTH_MIN && n <= CHAT_WIDTH_MAX) return n
  } catch {
    // ignore
  }
  return CHAT_WIDTH_DEFAULT
}

function readRightTab(): RightTab {
  try {
    const v = localStorage.getItem(RIGHT_TAB_KEY)
    if (v === 'code' || v === 'app' || v === 'console') return v
    // migrate old keys
    if (v === 'workspace') return 'code'
    if (v === 'preview') return 'app'
  } catch {
    // ignore
  }
  return 'app'
}

function clampChatWidth(width: number) {
  return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, Math.round(width)))
}

export function ProjectPage() {
  const { id = '' } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [items, setItems] = useState<ChatItem[]>([])
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Array<{ path: string; type: 'file' | 'dir' }>>([])
  const [versions, setVersions] = useState<
    Array<{ id: string; label: string; created_at: string }>
  >([])
  const [terminal, setTerminal] = useState('')
  const [consoleLog, setConsoleLog] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewKey, setPreviewKey] = useState(0)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState('idle')
  const [phase, setPhase] = useState('')
  const [resumable, setResumable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatCollapsed, setChatCollapsed] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < NARROW_BREAKPOINT) return true
    return readChatCollapsed()
  })
  const [chatWidth, setChatWidth] = useState(readChatWidth)
  const [narrowScreen, setNarrowScreen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < NARROW_BREAKPOINT : false,
  )
  const [rightTab, setRightTab] = useState<RightTab>(readRightTab)
  const bottomRef = useRef<HTMLDivElement>(null)
  const resizingRef = useRef(false)
  const wasNarrowRef = useRef(narrowScreen)

  const refreshMeta = useCallback(async () => {
    const [f, v] = await Promise.all([listFiles(id), listVersions(id)])
    setFiles(f)
    setVersions(v)
  }, [id])

  const hydrateFromServer = useCallback(async () => {
    const msgs = await listMessages(id)
    setItems(msgs.map((m) => ({ kind: 'message' as const, message: m })))
    await cacheMessages(id, msgs)
    await refreshMeta()
  }, [id, refreshMeta])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cached = await readCachedMessages(id)
      if (!cancelled && cached?.messages?.length) {
        setItems(
          (cached.messages as Message[]).map((m) => ({
            kind: 'message' as const,
            message: m,
          })),
        )
      }
      const draft = await loadDraft(id)
      if (!cancelled) setText(draft)
      const logs = await readLogs(id)
      if (!cancelled && logs.length) {
        setTerminal(logs.filter((l) => l.startsWith('[terminal]')).join(''))
        setConsoleLog(logs.filter((l) => l.startsWith('[console]')).join(''))
      }
      const info = await getProject(id)
      if (cancelled) return
      setProject(info.project)
      void touchRecent(info.project.id, info.project.title)
      if (info.checkpoint) setResumable(true)
      await hydrateFromServer()
    })().catch((e) => setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [id, hydrateFromServer])

  useEffect(() => {
    const es = new EventSource(withBase(`/api/projects/${id}/events`))
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as ServerEvent
        handleEvent(event)
      } catch {
        // ignore
      }
    }
    return () => es.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [items])

  useEffect(() => {
    const onResize = () => {
      const isNarrow = window.innerWidth < NARROW_BREAKPOINT
      setNarrowScreen(isNarrow)
      // Entering narrow viewport: auto-collapse to left rail
      if (isNarrow && !wasNarrowRef.current) {
        setChatCollapsed(true)
        try {
          localStorage.setItem(CHAT_COLLAPSED_KEY, '1')
        } catch {
          // ignore
        }
      }
      wasNarrowRef.current = isNarrow
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function persistChatWidth(width: number) {
    const next = clampChatWidth(width)
    setChatWidth(next)
    try {
      localStorage.setItem(CHAT_WIDTH_KEY, String(next))
    } catch {
      // ignore
    }
  }

  function onResizePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault()
    resizingRef.current = true
    const startX = e.clientX
    const startWidth = chatWidth
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: PointerEvent) => {
      if (!resizingRef.current) return
      persistChatWidth(startWidth + (ev.clientX - startX))
    }
    const onUp = (ev: PointerEvent) => {
      resizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try {
        target.releasePointerCapture(ev.pointerId)
      } catch {
        // ignore
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function handleEvent(event: ServerEvent) {
    switch (event.type) {
      case 'message': {
        const message: Message = {
          id: event.message_id,
          project_id: id,
          role:
            event.kind === 'user' || event.kind === 'answers'
              ? 'user'
              : event.agent_id
                ? 'assistant'
                : 'system',
          agent_id: event.agent_id,
          kind: event.kind,
          content: event.content,
          created_at: new Date().toISOString(),
        }
        setItems((prev) => [...prev, { kind: 'message', message }])
        void listMessages(id).then((msgs) => cacheMessages(id, msgs))
        if (event.kind === 'version' || event.kind === 'restore' || event.kind === 'revert') {
          void invalidateMessages(id).then(() => hydrateFromServer())
        }
        break
      }
      case 'card': {
        const card = event.card
        setItems((prev) => {
          if (card.type === 'issue') {
            const issueId = card.issue_id
            const idx = prev.findIndex(
              (item) =>
                item.kind === 'card' &&
                item.card.type === 'issue' &&
                item.card.issue_id === issueId,
            )
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = { kind: 'card', card }
              return next
            }
          }
          if (card.type === 'tool') {
            const toolId = card.id
            const idx = prev.findIndex(
              (item) =>
                item.kind === 'card' &&
                item.card.type === 'tool' &&
                item.card.id === toolId,
            )
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = { kind: 'card', card }
              return next
            }
          }
          return [...prev, { kind: 'card', card }]
        })
        if (card.type === 'version') {
          void invalidateMessages(id).then(() => hydrateFromServer())
          void refreshMeta()
        }
        break
      }
      case 'terminal':
        setTerminal((t) => t + event.chunk)
        void appendLog(id, 'terminal', event.chunk)
        break
      case 'console':
        setConsoleLog((t) => t + event.chunk)
        void appendLog(id, 'console', event.chunk)
        break
      case 'run.status':
        setRunStatus(event.status)
        setPhase(event.phase)
        break
      case 'preview.ready': {
        const url = withBase(event.url)
        const bust = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`
        setPreviewUrl(bust)
        setPreviewKey((k) => k + 1)
        setPreviewLoading(false)
        setRightTab('app')
        break
      }
      case 'error':
        setError(`${event.code}: ${event.message}`)
        if (
          event.code === 'resume_failed' ||
          event.code === 'checkpoint_conflict' ||
          event.code === 'nothing_to_resume'
        ) {
          setResumable(true)
        }
        break
      case 'checkpoint':
        setResumable(event.resumable)
        if (event.phase) setPhase(event.phase)
        break
      default:
        break
    }
  }

  async function onSend() {
    const raw = text.trim()
    if (!raw) return
    let mention: string | null = null
    let body = raw
    const m = raw.match(/^@(\w+)\s+([\s\S]*)/)
    if (m) {
      mention = m[1]!.toLowerCase()
      body = m[2] ?? ''
    }
    setText('')
    await saveDraft(id, '')
    setError(null)
    await sendMessage(id, { text: body || raw, mention })
  }

  const statusLabel = useMemo(() => {
    return `${runStatus}${phase ? ` · ${phase}` : ''}`
  }, [runStatus, phase])

  function toggleChat() {
    setChatCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(CHAT_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }

  function switchTab(tab: RightTab) {
    setRightTab(tab)
    try {
      localStorage.setItem(RIGHT_TAB_KEY, tab)
    } catch {
      // ignore
    }
  }

  const openFile = useCallback(
    async (path: string, opts?: { switchToCode?: boolean }) => {
      setSelectedFile(path)
      setFileLoading(true)
      setFileError(null)
      try {
        const res = await readFile(id, path)
        setFileContent(res.content)
        if (opts?.switchToCode !== false) switchTab('code')
      } catch (e) {
        setFileContent('')
        setFileError(e instanceof Error ? e.message : String(e))
      } finally {
        setFileLoading(false)
      }
    },
    [id],
  )

  const loadPreview = useCallback(
    async (opts?: { force?: boolean }) => {
      setPreviewLoading(true)
      try {
        const r = await startPreview(id, { force: opts?.force })
        const bust = `${r.url}${r.url.includes('?') ? '&' : '?'}t=${Date.now()}`
        setPreviewUrl(bust)
        setPreviewKey((k) => k + 1)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setPreviewLoading(false)
      }
    },
    [id],
  )

  useEffect(() => {
    setPreviewUrl(null)
    setPreviewKey(0)
    void loadPreview({ force: false })
  }, [loadPreview])

  useEffect(() => {
    if (selectedFile) return
    const preferred =
      files.find((f) => f.type === 'file' && f.path.endsWith('src/App.tsx')) ??
      files.find((f) => f.type === 'file' && f.path.includes('app/frontend/src/'))
    if (preferred) void openFile(preferred.path, { switchToCode: false })
  }, [files, selectedFile, openFile])

  const runActive = ['running', 'waiting_plan', 'waiting_answers'].includes(runStatus)

  if (!project) {
    return <div className="p-6 text-slate-500 dark:text-slate-400">加载项目中…</div>
  }

  return (
    <div className="h-full flex min-h-0">
      {/* Chat — always on the left; auto-collapses on narrow screens */}
      {chatCollapsed ? (
        <aside className="w-14 shrink-0 h-full border-r border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950 flex flex-col items-center py-3 gap-2">
          <button
            type="button"
            onClick={toggleChat}
            className="inline-flex items-center justify-center size-8 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="展开对话"
            title="展开对话"
          >
            <IconChevronRight />
          </button>
          <div
            className="mt-2 text-[11px] text-slate-500 truncate max-h-40"
            style={{ writingMode: 'vertical-rl' }}
            title={project.title}
          >
            {project.title}
          </div>
        </aside>
      ) : (
        <>
          <section
            className="flex flex-col min-h-0 bg-white/60 dark:bg-transparent shrink-0"
            style={{ width: narrowScreen ? Math.min(chatWidth, Math.max(CHAT_WIDTH_MIN, window.innerWidth - 64)) : chatWidth }}
          >
            <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{project.title}</div>
                <div className="text-[11px] text-slate-500">{statusLabel}</div>
              </div>
              <div className="flex gap-1 shrink-0">
                {runActive && (
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => void stopRun(id).then(() => invalidateMessages(id))}
                  >
                    停止
                  </button>
                )}
                {resumable && !runActive && (
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border border-amber-500 dark:border-amber-700 text-amber-700 dark:text-amber-300"
                    onClick={() => {
                      setError(null)
                      setResumable(false)
                      setRunStatus('running')
                      void resumeRun(id, { force: true })
                        .then(() => {
                          setPhase((p) => p || 'resuming')
                        })
                        .catch((e) => {
                          setResumable(true)
                          setRunStatus('stopped')
                          setError(e instanceof Error ? e.message : String(e))
                        })
                    }}
                  >
                    继续
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleChat}
                  className="inline-flex items-center justify-center size-7 rounded border border-slate-300 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="收起对话"
                  title="收起对话"
                >
                  <IconChevronLeft className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-3">
              {items.map((item, idx) =>
                item.kind === 'message' ? (
                  <MessageBubble
                    key={`m-${item.message.id}-${idx}`}
                    message={item.message}
                    onRevert={() =>
                      void revertMessage(id, item.message.id).then(() =>
                        invalidateMessages(id).then(hydrateFromServer),
                      )
                    }
                  />
                ) : (
                  <CardView
                    key={`c-${item.card.id}-${idx}`}
                    card={item.card}
                    onApprove={(cardId) => void approvePlan(id, cardId)}
                    onDecline={(cardId) => void declinePlan(id, cardId, 'Please revise')}
                    onResolve={(issueId) => void resolveIssue(id, issueId)}
                  />
                ),
              )}
              <div ref={bottomRef} />
            </div>
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              {error && <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>}
              <textarea
                className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm min-h-[72px]"
                placeholder="描述你的应用… 可用 @alex 仅走工程师模式"
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  void saveDraft(id, e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void onSend()
                  }
                }}
              />
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-slate-500">⌘/Ctrl+Enter 发送</span>
                <button
                  type="button"
                  onClick={() => void onSend()}
                  className="rounded bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-sm text-white"
                >
                  发送
                </button>
              </div>
            </div>
          </section>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整对话栏宽度"
            title="拖动调整宽度"
            className="w-1.5 shrink-0 cursor-col-resize border-x border-transparent hover:border-sky-400/50 hover:bg-sky-400/30 active:bg-sky-500/40 bg-slate-200/60 dark:bg-slate-800"
            onPointerDown={onResizePointerDown}
          />
        </>
      )}

      {/* Atoms-like blocks: 代码 / 应用 / 控制台 */}
      <section className="flex flex-1 flex-col min-h-0 min-w-0 bg-white/40 dark:bg-transparent">
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-900 p-0.5">
            <TabButton active={rightTab === 'app'} onClick={() => switchTab('app')}>
              应用
            </TabButton>
            <TabButton active={rightTab === 'console'} onClick={() => switchTab('console')}>
              控制台
            </TabButton>
            <TabButton active={rightTab === 'code'} onClick={() => switchTab('code')}>
              代码
            </TabButton>
          </div>
          <div className="flex items-center gap-1.5">
            {rightTab === 'code' && (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700"
                onClick={() => void refreshMeta()}
              >
                刷新
              </button>
            )}
            {rightTab === 'app' && (
              <button
                type="button"
                disabled={previewLoading}
                className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-50"
                onClick={() => void loadPreview({ force: true })}
              >
                {previewLoading ? '加载中…' : '刷新预览'}
              </button>
            )}
          </div>
        </div>

        {rightTab === 'code' && (
          <div className="flex-1 min-h-0 flex">
            <aside className="w-[220px] shrink-0 border-r border-slate-200 dark:border-slate-800 flex flex-col min-h-0">
              <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-slate-800">
                文件
              </div>
              <div className="flex-1 min-h-0 overflow-auto px-1 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                <FileTree
                  files={files}
                  selectedPath={selectedFile}
                  onSelectFile={(path) => void openFile(path)}
                />
              </div>
              <div className="border-t border-slate-200 dark:border-slate-800 max-h-28 overflow-auto">
                <div className="px-3 py-1.5 text-[11px] font-medium text-slate-500">版本</div>
                {versions.length === 0 && (
                  <div className="px-3 pb-2 text-[11px] text-slate-400">暂无版本</div>
                )}
                {versions.map((v) => (
                  <div key={v.id} className="px-3 py-1 flex justify-between gap-2">
                    <span className="truncate text-[11px]">{v.label}</span>
                    <button
                      type="button"
                      className="text-[11px] text-sky-600 dark:text-sky-400 shrink-0"
                      onClick={() =>
                        void restoreVersion(id, v.id).then(() =>
                          invalidateMessages(id).then(hydrateFromServer),
                        )
                      }
                    >
                      恢复
                    </button>
                  </div>
                ))}
              </div>
            </aside>
            <div className="flex-1 min-w-0 min-h-0">
              <CodeViewer
                path={selectedFile}
                content={fileContent}
                loading={fileLoading}
                error={fileError}
              />
            </div>
          </div>
        )}

        {rightTab === 'app' && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="shrink-0 h-9 px-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-xs text-slate-500">
              <span className="font-mono truncate">
                {previewUrl ? previewUrl : '/'}
              </span>
              <button
                type="button"
                className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                onClick={() => switchTab('console')}
              >
                控制台
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-950 relative">
              {previewLoading && (
                <div className="absolute inset-0 z-10 grid place-items-center bg-white/70 dark:bg-slate-950/70 text-sm text-slate-600 dark:text-slate-300">
                  正在启动预览…
                </div>
              )}
              {previewUrl ? (
                <iframe
                  key={`${previewKey}-${previewUrl}`}
                  title="应用预览"
                  src={previewUrl}
                  className="w-full h-full border-0 bg-white"
                />
              ) : (
                <div className="h-full grid place-items-center text-slate-500 text-sm px-6 text-center">
                  构建完成后会显示应用，也可点击「刷新预览」。
                </div>
              )}
            </div>
          </div>
        )}

        {rightTab === 'console' && (
          <div className="flex-1 min-h-0">
            <ConsolePanel
              terminal={terminal}
              consoleLog={consoleLog}
              onClear={() => {
                setTerminal('')
                setConsoleLog('')
                void clearLogs(id)
              }}
            />
          </div>
        )}
      </section>
    </div>
  )
}

function TabButton({
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
        'px-3 py-1 rounded-md text-xs font-medium transition-colors',
        active
          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
          : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function MessageBubble({
  message,
  onRevert,
}: {
  message: Message
  onRevert: () => void
}) {
  if (message.kind === 'version') {
    const c = message.content as { version_id?: string; label?: string; created_at?: string }
    return (
      <div className="rounded-lg border border-emerald-300 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/20 p-3 space-y-1">
        <div className="text-xs text-emerald-700 dark:text-emerald-300">版本已创建 · 含构建与验收</div>
        <div className="text-sm font-medium">{c.label ?? 'Version'}</div>
        {c.created_at && <div className="text-[11px] text-slate-500">{c.created_at}</div>}
      </div>
    )
  }
  if (message.kind === 'restore' || message.kind === 'revert') {
    const c = message.content as { label?: string; version_id?: string; path?: string }
    return (
      <div className="rounded-lg border border-sky-300 dark:border-sky-800/70 bg-sky-50 dark:bg-sky-950/20 p-3 space-y-1">
        <div className="text-xs text-sky-700 dark:text-sky-300">
          {message.kind === 'restore' ? '已恢复版本' : '已回退更改'}
        </div>
        <div className="text-sm font-medium">{c.label ?? c.path ?? c.version_id ?? 'done'}</div>
      </div>
    )
  }

  const content = message.content as { text?: string }
  const text =
    typeof content?.text === 'string'
      ? content.text
      : typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content)
  const label =
    message.agent_id && message.agent_id in ROLE_LABELS
      ? ROLE_LABELS[message.agent_id as RoleId]
      : message.role === 'user' || message.kind === 'user'
        ? '用户'
        : message.role === 'system'
          ? '系统'
          : message.role
  const isUser = message.role === 'user' || message.kind === 'user'
  const long = !isUser && (text.length > 280 || text.split('\n').length > 8)
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, 100)

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-3">
      <Collapsible
        defaultOpen={isUser || !long}
        title={
          <span className="text-[11px] tracking-wide text-sky-700 dark:text-sky-400/90">
            {label}
            {long ? <span className="text-slate-400"> · 过程</span> : null}
          </span>
        }
        subtitle={long ? preview + (text.length > 100 ? '…' : '') : undefined}
        actions={
          message.agent_id === 'alex' && message.kind === 'agent' ? (
            <button type="button" className="text-[11px] text-slate-500 shrink-0" onClick={onRevert}>
              回退
            </button>
          ) : undefined
        }
      >
        <Markdown text={text} />
      </Collapsible>
    </div>
  )
}
