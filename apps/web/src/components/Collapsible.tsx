import { useState, type ReactNode } from 'react'

export function Collapsible({
  title,
  subtitle,
  defaultOpen = false,
  actions,
  children,
  className = '',
}: {
  title: ReactNode
  subtitle?: ReactNode
  defaultOpen?: boolean
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="w-3 shrink-0 text-[10px] text-slate-400">{open ? '▾' : '▸'}</span>
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </button>
        {actions}
      </div>
      {subtitle && !open && <div className="pl-4 mt-0.5 text-[11px] text-slate-500 truncate">{subtitle}</div>}
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

export function PanelSection({
  title,
  defaultOpen = true,
  actions,
  bodyClassName = '',
  children,
}: {
  title: string
  defaultOpen?: boolean
  actions?: ReactNode
  bodyClassName?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="flex flex-col min-h-0 border-b border-slate-200 dark:border-slate-800">
      <div className="px-3 py-2 flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          className="flex items-center gap-1.5 font-medium text-left min-w-0"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="w-3 text-[10px] text-slate-400">{open ? '▾' : '▸'}</span>
          <span>{title}</span>
        </button>
        {actions}
      </div>
      {open && <div className={bodyClassName}>{children}</div>}
    </div>
  )
}
