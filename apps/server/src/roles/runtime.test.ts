import assert from 'node:assert/strict'
import test from 'node:test'
import { formatToolResultForLlm } from './runtime.ts'

test('formatToolResultForLlm truncates large read_file content', () => {
  const huge = 'x'.repeat(20_000)
  const out = formatToolResultForLlm(
    { name: 'read_file', args: { path: 'app/frontend/src/App.tsx' } },
    { ok: true, summary: 'read App.tsx', data: { path: 'app/frontend/src/App.tsx', content: huge } },
  )
  const parsed = JSON.parse(out) as { content: string }
  assert.ok(parsed.content.length < 20_000)
  assert.match(parsed.content, /truncated/)
})

test('formatToolResultForLlm omits write_file body', () => {
  const out = formatToolResultForLlm(
    { name: 'write_file', args: { path: 'a.tsx', content: 'export const x = 1' } },
    { ok: true, summary: 'wrote a.tsx (18 bytes)', data: { leaked: 'nope' } },
  )
  assert.equal(out, JSON.stringify({ ok: true, summary: 'wrote a.tsx (18 bytes)' }))
})
