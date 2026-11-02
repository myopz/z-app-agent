import type { Card } from '@z-app-agent/shared'
import { ROLE_LABELS } from '@z-app-agent/shared'
import { Collapsible } from '../Collapsible'
import { Markdown } from '../Markdown'

export function CardView({
  card,
  onApprove,
  onDecline,
  onResolve,
}: {
  card: Card
  onApprove: (id: string) => void
  onDecline: (id: string) => void
  onResolve: (issueId: string) => void
}) {
  if (card.type === 'plan') {
    return (
      <div className="rounded-lg border border-violet-300 dark:border-violet-800/80 bg-violet-50 dark:bg-violet-950/30 p-3 space-y-2">
        <div className="text-xs text-violet-700 dark:text-violet-300">
          计划 · {statusLabel(card.status)}
        </div>
        <div className="font-medium text-sm">{card.title}</div>
        <p className="text-sm text-slate-600 dark:text-slate-300">{card.summary}</p>
        {card.status === 'pending' && (
          <div className="flex gap-2">
            <button
              type="button"
              className="text-xs px-2 py-1 rounded bg-emerald-700 text-white"
              onClick={() => onApprove(card.id)}
            >
              批准
            </button>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600"
              onClick={() => onDecline(card.id)}
            >
              拒绝
            </button>
          </div>
        )}
      </div>
    )
  }
  if (card.type === 'question') {
    return (
      <div className="rounded-lg border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
        <div className="text-xs text-amber-700 dark:text-amber-300">问题</div>
        <ul className="text-sm space-y-1">
          {card.questions.map((q) => (
            <li key={q.id}>
              <strong>{q.id}:</strong> {q.prompt}
              {q.options?.length ? ` （${q.options.join(' / ')}）` : ''}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-slate-500">在聊天中直接回复答案即可。</p>
      </div>
    )
  }
  if (card.type === 'version') {
    return (
      <div className="rounded-lg border border-emerald-300 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/20 p-3">
        <div className="text-xs text-emerald-700 dark:text-emerald-300">版本</div>
        <div className="text-sm font-medium">{card.label}</div>
        <div className="text-[11px] text-slate-500">{card.created_at}</div>
      </div>
    )
  }
  if (card.type === 'tool') {
    return (
      <Collapsible
        className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-3 py-2 text-xs"
        defaultOpen={card.status === 'error'}
        title={
          <span>
            <span className="text-slate-500 dark:text-slate-400">工具</span> {card.tool} ·{' '}
            {toolStatusLabel(card.status)}
          </span>
        }
        subtitle={card.summary}
      >
        <div className="text-slate-600 dark:text-slate-300">{card.summary}</div>
      </Collapsible>
    )
  }
  if (card.type === 'activity') {
    return (
      <Collapsible
        className="text-xs text-slate-500 dark:text-slate-400 px-1"
        defaultOpen={false}
        title={
          <span>
            {ROLE_LABELS[card.role] ?? card.role}
            <span className="font-normal text-slate-400"> · 活动</span>
          </span>
        }
        subtitle={card.text}
      >
        <div>{card.text}</div>
      </Collapsible>
    )
  }
  if (card.type === 'issue') {
    const long = card.summary.length > 160
    return (
      <div className="rounded-lg border border-rose-300 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/20 p-3 space-y-2">
        <Collapsible
          defaultOpen={!long}
          title={
            <span className="text-xs text-rose-700 dark:text-rose-300">
              问题 · {issueStatusLabel(card.status)} · {card.phase}
            </span>
          }
          subtitle={long ? card.summary.slice(0, 120) + '…' : undefined}
        >
          <div className="text-sm">
            <Markdown text={'```\n' + card.summary + '\n```'} />
          </div>
        </Collapsible>
        {card.status === 'open' || card.status === 'exhausted' ? (
          <button
            type="button"
            className="text-xs px-2 py-1 rounded bg-rose-700 text-white"
            onClick={() => onResolve(card.issue_id)}
          >
            修复
          </button>
        ) : null}
      </div>
    )
  }
  return null
}

function statusLabel(status: string) {
  switch (status) {
    case 'pending':
      return '待确认'
    case 'approved':
      return '已批准'
    case 'declined':
      return '已拒绝'
    default:
      return status
  }
}

function toolStatusLabel(status: string) {
  switch (status) {
    case 'running':
      return '执行中'
    case 'ok':
      return '成功'
    case 'error':
      return '失败'
    default:
      return status
  }
}

function issueStatusLabel(status: string) {
  switch (status) {
    case 'open':
      return '待处理'
    case 'resolving':
      return '修复中'
    case 'resolved':
      return '已解决'
    case 'exhausted':
      return '已耗尽'
    default:
      return status
  }
}
