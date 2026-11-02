import assert from 'node:assert/strict'
import test from 'node:test'
import { withCacheBust } from './cache.ts'

test('withCacheBust adds t param', () => {
  assert.equal(withCacheBust('/zapp/preview/x/', 1), '/zapp/preview/x/?t=1')
})

test('withCacheBust replaces existing t', () => {
  assert.equal(withCacheBust('/zapp/preview/x/?t=99&foo=1', 2), '/zapp/preview/x/?foo=1&t=2')
})
