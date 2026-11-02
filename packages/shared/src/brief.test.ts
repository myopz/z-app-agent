import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BriefSchema } from './brief.ts'

test('BriefSchema accepts valid brief', () => {
  const parsed = BriefSchema.parse({
    goal: 'Todo app',
    sections: ['UI', 'localStorage'],
    constraints: ['No backend'],
    quality_rules: ['Must run in preview'],
    assignees: ['emma', 'bob', 'alex'],
    acceptance: ['Can add todos'],
    source_message_id: 'm1',
  })
  assert.equal(parsed.goal, 'Todo app')
})

test('BriefSchema coerces object acceptance / sections from LLM', () => {
  const parsed = BriefSchema.parse({
    goal: { text: 'Counter app' },
    sections: [{ title: 'UI' }, 'state'],
    constraints: [{ constraint: 'No backend' }],
    quality_rules: [{ rule: 'Preview works' }],
    assignees: ['Emma', { id: 'alex' }, 'bob'],
    acceptance: [
      { criterion: 'Can increment' },
      { id: 'a2', text: 'Can reset' },
      'Buttons visible',
    ],
    source_message_id: 'm2',
  })
  assert.equal(parsed.goal, 'Counter app')
  assert.deepEqual(parsed.sections, ['UI', 'state'])
  assert.deepEqual(parsed.constraints, ['No backend'])
  assert.deepEqual(parsed.quality_rules, ['Preview works'])
  assert.deepEqual(parsed.assignees, ['emma', 'alex', 'bob'])
  assert.deepEqual(parsed.acceptance, ['Can increment', 'Can reset', 'Buttons visible'])
})

test('BriefSchema defaults empty assignees to emma/bob/alex', () => {
  const parsed = BriefSchema.parse({
    goal: 'Hi',
    sections: [],
    constraints: [],
    quality_rules: [],
    assignees: [],
    acceptance: [],
    source_message_id: 'm3',
  })
  assert.deepEqual(parsed.assignees, ['emma', 'bob', 'alex'])
})
