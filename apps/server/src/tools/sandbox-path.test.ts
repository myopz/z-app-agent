import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PathEscapeError, resolveInWorkspace } from './sandbox-path.ts'

test('allows nested relative paths', () => {
  const abs = resolveInWorkspace('p1', 'app/frontend/src/App.tsx')
  assert.match(abs, /workspaces[/\\]p1[/\\]app[/\\]frontend[/\\]src[/\\]App\.tsx$/)
})

test('rejects path escape', () => {
  assert.throws(() => resolveInWorkspace('p1', '../other'), PathEscapeError)
  assert.throws(() => resolveInWorkspace('p1', 'a/../../outside'), PathEscapeError)
})
