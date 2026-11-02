import { useEffect, useMemo, useState } from 'react'
import {
  buildFileTree,
  defaultExpandedPaths,
  type FlatFile,
  type FileTreeNode,
} from '../../lib/file-tree'

export function FileTree({
  files,
  selectedPath,
  onSelectFile,
}: {
  files: FlatFile[]
  selectedPath?: string | null
  onSelectFile?: (path: string) => void
}) {
  const tree = useMemo(() => buildFileTree(files), [files])
  const fileKey = useMemo(() => files.map((f) => `${f.type}:${f.path}`).join('|'), [files])
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpandedPaths(files))

  useEffect(() => {
    setExpanded(defaultExpandedPaths(files))
  }, [fileKey, files])

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (tree.length === 0) {
    return <div className="text-slate-500 px-1">暂无文件</div>
  }

  return (
    <div className="select-none" role="tree">
      {tree.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          selectedPath={selectedPath}
          onToggle={toggle}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  )
}

function TreeRow({
  node,
  depth,
  expanded,
  selectedPath,
  onToggle,
  onSelectFile,
}: {
  node: FileTreeNode
  depth: number
  expanded: Set<string>
  selectedPath?: string | null
  onToggle: (path: string) => void
  onSelectFile?: (path: string) => void
}) {
  const isDir = node.type === 'dir'
  const isOpen = isDir && expanded.has(node.path)
  const selected = !isDir && selectedPath === node.path
  const pad = 8 + depth * 14

  return (
    <div>
      <button
        type="button"
        role="treeitem"
        aria-expanded={isDir ? isOpen : undefined}
        aria-selected={selected || undefined}
        className={[
          'w-full flex items-center gap-1 py-0.5 pr-1 text-left rounded',
          selected
            ? 'bg-sky-100 text-sky-900 dark:bg-sky-950/60 dark:text-sky-100'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800/80',
        ].join(' ')}
        style={{ paddingLeft: pad }}
        onClick={() => {
          if (isDir) onToggle(node.path)
          else onSelectFile?.(node.path)
        }}
        title={node.path}
      >
        <span className="w-3 shrink-0 text-[10px] text-slate-400">
          {isDir ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span className="shrink-0" aria-hidden>
          {isDir ? '📁' : '📄'}
        </span>
        <span className="truncate">{node.name}</span>
      </button>
      {isDir &&
        isOpen &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selectedPath={selectedPath}
            onToggle={onToggle}
            onSelectFile={onSelectFile}
          />
        ))}
    </div>
  )
}
