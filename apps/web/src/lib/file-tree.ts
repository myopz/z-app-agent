export type FlatFile = { path: string; type: 'file' | 'dir' }

export type FileTreeNode = {
  name: string
  path: string
  type: 'file' | 'dir'
  children: FileTreeNode[]
}

/** Build a nested tree from a flat path list (dirs + files). */
export function buildFileTree(files: FlatFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = []
  const byPath = new Map<string, FileTreeNode>()

  const ensureDir = (dirPath: string): FileTreeNode => {
    const existing = byPath.get(dirPath)
    if (existing) return existing
    const name = dirPath.includes('/') ? dirPath.slice(dirPath.lastIndexOf('/') + 1) : dirPath
    const node: FileTreeNode = { name, path: dirPath, type: 'dir', children: [] }
    byPath.set(dirPath, node)
    const parentPath = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : ''
    if (parentPath) {
      ensureDir(parentPath).children.push(node)
    } else {
      root.push(node)
    }
    return node
  }

  for (const f of files) {
    if (f.type === 'dir') {
      ensureDir(f.path)
      continue
    }
    const parentPath = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
    const name = f.path.includes('/') ? f.path.slice(f.path.lastIndexOf('/') + 1) : f.path
    const node: FileTreeNode = { name, path: f.path, type: 'file', children: [] }
    if (parentPath) {
      ensureDir(parentPath).children.push(node)
    } else {
      root.push(node)
    }
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) {
      if (n.children.length) sortNodes(n.children)
    }
  }
  sortNodes(root)
  return root
}

/** Default expanded folders for aiot-like layout. */
export function defaultExpandedPaths(files: FlatFile[]): Set<string> {
  const open = new Set<string>()
  for (const f of files) {
    if (f.type !== 'dir') continue
    if (
      f.path === '.atoms' ||
      f.path === 'app' ||
      f.path === 'app/frontend' ||
      f.path === 'app/frontend/src' ||
      f.path === 'app/backend'
    ) {
      open.add(f.path)
    }
  }
  return open
}
