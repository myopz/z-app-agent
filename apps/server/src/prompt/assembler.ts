import type { Brief, RoleId } from '@z-app-agent/shared'
import { listFileTree } from '../workspace/scaffold.ts'
import { readAtomsDoc } from '../memory/atoms-docs.ts'
import { ROLE_SYSTEM } from '../roles/prompts.ts'

/** Keep history lean — long agent dumps were a major token amplifier. */
const MAX_HISTORY_CHARS = 6_000
const MAX_MSG_CHARS = 1_200
const MAX_TREE = 60

export function assembleMessages(input: {
  role: RoleId
  userText: string
  brief?: Brief | null
  history: Array<{ role: string; agent_id?: string | null; content: string; kind?: string }>
  projectId: string
  extraSystem?: string
}): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const s0 = ROLE_SYSTEM[input.role]
  const tree = listFileTree(input.projectId)
    .slice(0, MAX_TREE)
    .map((f) => `${f.type[0]} ${f.path}`)
    .join('\n')
  const atoms = [
    readAtomsDoc(input.projectId, 'ATOMS.md').slice(0, 1200),
    readAtomsDoc(input.projectId, 'PROGRESS.md').slice(0, 800),
    readAtomsDoc(input.projectId, 'ARCHITECTURE.md').slice(0, 1000),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n')

  const briefBlock = input.brief
    ? `BRIEF (authoritative):\n${JSON.stringify(input.brief)}`
    : ''

  const system = [
    s0,
    input.extraSystem ?? '',
    'Tools (authoritative): prefer native function/tool calls from the API.',
    'Fallback text form if tools API unavailable:',
    '```tool_call',
    '{"name":"write_file","args":{"path":"app/frontend/src/App.tsx","content":"FULL SOURCE"}}',
    '```',
    'CRITICAL: Putting code only in ```tsx chat fences does NOT save files. Always call write_file (or ```write_file).',
    'edit_file args: {"path":"...","old_string":"...","new_string":"..."}. For full-file replace use write_file.',
    'When finished AFTER successful writes, write DONE and a short summary.',
    briefBlock,
    `FILE TREE:\n${tree}`,
    atoms ? `PROJECT MEMORY:\n${atoms}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const historyMsgs: Array<{ role: 'user' | 'assistant'; content: string }> = []
  let budget = MAX_HISTORY_CHARS
  for (const h of [...input.history].reverse()) {
    const raw = h.content.trim()
    if (!raw) continue
    // Prefer a short head for long process logs (keep last / summary side).
    const content =
      raw.length <= MAX_MSG_CHARS
        ? raw
        : `${raw.slice(0, MAX_MSG_CHARS / 2)}\n…\n${raw.slice(-MAX_MSG_CHARS / 2)}`
    if (budget <= 0) break
    budget -= content.length
    const role = h.role === 'user' ? 'user' : 'assistant'
    historyMsgs.unshift({
      role,
      content: h.agent_id ? `[${h.agent_id}] ${content}` : content,
    })
  }

  return [
    { role: 'system', content: system },
    ...historyMsgs,
    { role: 'user', content: input.userText },
  ]
}
