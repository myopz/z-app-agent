import { z } from 'zod'
import { RoleIdSchema, type RoleId } from './roles.ts'

/** LLM often emits objects like `{criterion:"..."}` instead of plain strings. */
function coerceStringItem(item: unknown): string {
  if (typeof item === 'string') return item
  if (typeof item === 'number' || typeof item === 'boolean') return String(item)
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>
    for (const key of [
      'criterion',
      'text',
      'title',
      'prompt',
      'name',
      'description',
      'acceptance',
      'section',
      'rule',
      'constraint',
      'id',
    ]) {
      if (typeof o[key] === 'string' && o[key].trim()) return o[key]
    }
    try {
      return JSON.stringify(item)
    } catch {
      return String(item)
    }
  }
  if (item == null) return ''
  return String(item)
}

function coerceStringList(value: unknown): string[] {
  if (value == null) return []
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return [coerceStringItem(value)].filter(Boolean)
  return value.map(coerceStringItem).map((s) => s.trim()).filter(Boolean)
}

const ROLE_ALIASES: Record<string, RoleId> = {
  mike: 'mike',
  emma: 'emma',
  bob: 'bob',
  alex: 'alex',
  david: 'david',
  iris: 'iris',
  sarah: 'sarah',
  adrian: 'adrian',
  leader: 'mike',
  pm: 'emma',
  architect: 'bob',
  engineer: 'alex',
  coder: 'alex',
}

function coerceAssignees(value: unknown): RoleId[] {
  const fallback: RoleId[] = ['emma', 'bob', 'alex']
  if (value == null) return fallback
  const raw = Array.isArray(value) ? value : [value]
  const out: RoleId[] = []
  for (const item of raw) {
    const token =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
          ? String((item as { id: string }).id)
          : coerceStringItem(item)
    const key = token.trim().toLowerCase().replace(/^@/, '')
    const role = ROLE_ALIASES[key]
    if (role && !out.includes(role)) out.push(role)
  }
  return out.length ? out : fallback
}

const StringListSchema = z.preprocess(coerceStringList, z.array(z.string()))
const AssigneesSchema = z.preprocess(coerceAssignees, z.array(RoleIdSchema).min(1))

export const BriefSchema = z.object({
  goal: z.preprocess(
    (v) => (typeof v === 'string' ? v : coerceStringItem(v)),
    z.string().min(1),
  ),
  sections: StringListSchema,
  constraints: StringListSchema,
  quality_rules: StringListSchema,
  assignees: AssigneesSchema,
  acceptance: StringListSchema,
  source_message_id: z.string(),
})
export type Brief = z.infer<typeof BriefSchema>

export function parseBrief(input: unknown): Brief {
  return BriefSchema.parse(input)
}
