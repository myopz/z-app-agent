import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { localAcceptanceGaps, visualUiGaps } from './app-ui.ts'

const BARE_COUNTER = `import React, { useState } from 'react';
const Counter: React.FC = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <h1>Counter: {count}</h1>
      <button onClick={() => setCount(count + 1)}>+</button>
      <button onClick={() => setCount(count - 1)}>-</button>
      <button onClick={() => setCount(0)}>Reset</button>
    </div>
  );
};
export default Counter;`

const STYLED_COUNTER = `import { useState } from 'react'
export default function App() {
  const [count, setCount] = useState(0)
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-8 space-y-6">
        <h1 className="text-4xl font-semibold tabular-nums">{count}</h1>
        <div className="grid grid-cols-3 gap-3">
          <button type="button" className="h-12 rounded-xl bg-slate-800" onClick={() => setCount(c => c - 1)}>-</button>
          <button type="button" className="h-12 rounded-xl bg-slate-800" onClick={() => setCount(0)}>Reset</button>
          <button type="button" className="h-12 rounded-xl bg-indigo-500" onClick={() => setCount(c => c + 1)}>+</button>
        </div>
      </section>
    </main>
  )
}`

describe('visualUiGaps', () => {
  it('rejects bare counter without Tailwind', () => {
    const gaps = visualUiGaps(BARE_COUNTER)
    assert.ok(gaps.length >= 1)
    assert.ok(gaps.some((g) => /Tailwind|className|bare/i.test(g)))
  })

  it('accepts styled Tailwind counter', () => {
    assert.deepEqual(visualUiGaps(STYLED_COUNTER), [])
  })

  it('flags bare buttons even when some classNames exist', () => {
    const mixed = `export default function App() {
      return (
        <main className="min-h-screen flex p-8 bg-slate-900">
          <button onClick={() => {}}>ok</button>
        </main>
      )
    }`
    const gaps = visualUiGaps(mixed)
    assert.ok(gaps.some((g) => /button/i.test(g)))
  })
})

describe('localAcceptanceGaps export', () => {
  it('is available to orchestrator', () => {
    assert.equal(typeof localAcceptanceGaps, 'function')
  })
})
