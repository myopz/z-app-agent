import assert from 'node:assert/strict'
import { test } from 'node:test'
import { looksLikeToolAttempt, parseToolCalls, stripToolCallFences } from './parse-tool-calls.ts'

test('parses fenced tool_call', () => {
  const text = `Hello
\`\`\`tool_call
{"name":"list_files","args":{"glob":"**/*"}}
\`\`\`
`
  const calls = parseToolCalls(text)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.name, 'list_files')
})

test('parses named write_file fence', () => {
  const text = `\`\`\`write_file
{"path":"app/frontend/src/App.tsx","content":"export default function App(){return <h1>Hi</h1>}"}
\`\`\``
  const calls = parseToolCalls(text)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.name, 'write_file')
  assert.equal(calls[0]?.args.path, 'app/frontend/src/App.tsx')
})

test('coerces edit_file+content to write_file', () => {
  const text = `\`\`\`edit_file
{"path":"app/frontend/src/App.tsx","content":"export default function App(){return null}"}
\`\`\``
  const calls = parseToolCalls(text)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.name, 'write_file')
  assert.ok(String(calls[0]?.args.content).includes('export default'))
})

test('looksLikeToolAttempt detects named fences', () => {
  assert.equal(looksLikeToolAttempt('```write_file\n{}\n```'), true)
  assert.equal(looksLikeToolAttempt('just DONE'), false)
})

test('stripToolCallFences removes named fences', () => {
  const text = `note\n\`\`\`write_file\n{"path":"a","content":"b"}\n\`\`\`\nDONE`
  assert.match(stripToolCallFences(text), /DONE/)
  assert.doesNotMatch(stripToolCallFences(text), /write_file/)
})
