import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFileTree, defaultExpandedPaths } from './file-tree.ts'

test('buildFileTree nests aiot-like layout', () => {
  const tree = buildFileTree([
    { path: '.atoms', type: 'dir' },
    { path: '.atoms/ATOMS.md', type: 'file' },
    { path: 'app', type: 'dir' },
    { path: 'app/backend', type: 'dir' },
    { path: 'app/backend/README.md', type: 'file' },
    { path: 'app/frontend', type: 'dir' },
    { path: 'app/frontend/src', type: 'dir' },
    { path: 'app/frontend/src/App.tsx', type: 'file' },
  ])

  assert.equal(tree.map((n) => n.name).join(','), '.atoms,app')
  const app = tree.find((n) => n.name === 'app')
  assert.ok(app)
  assert.equal(app!.children.map((n) => n.name).join(','), 'backend,frontend')
  const frontend = app!.children.find((n) => n.name === 'frontend')
  assert.ok(frontend)
  assert.equal(frontend!.children[0]?.name, 'src')
})

test('defaultExpandedPaths opens layout roots', () => {
  const open = defaultExpandedPaths([
    { path: '.atoms', type: 'dir' },
    { path: 'app', type: 'dir' },
    { path: 'app/frontend', type: 'dir' },
    { path: 'app/frontend/src', type: 'dir' },
    { path: 'app/backend', type: 'dir' },
    { path: 'app/frontend/package.json', type: 'file' },
  ])
  assert.ok(open.has('app'))
  assert.ok(open.has('app/frontend'))
  assert.ok(open.has('app/backend'))
  assert.equal(open.has('app/frontend/package.json'), false)
})
