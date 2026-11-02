import type { Brief, RoleId } from '@z-app-agent/shared'
import { listFileTree } from '../workspace/scaffold.ts'
import { readAtomsDoc } from '../memory/atoms-docs.ts'
import { ROLE_SYSTEM } from '../roles/prompts.ts'

const MAX_HISTORY_CHARS = 12_000
const MAX_TREE = 80

export function assembleMessages(input: {
  role: RoleId
  userText: string
  brief?: Brief | null
  history: Array<{ role: string; agent_id?: string | null; content: string }>
  projectId: string
  extraSystem?: string
}): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const s0 = ROLE_SYSTEM[input.role]
  const tree = listFileTree(input.projectId)
    .slice(0, MAX_TREE)
    .map((f) => `${f.type[0]} ${f.path}`)
    .join('\n')
  const atoms = [
    readAtomsDoc(input.projectId, 'ATOMS.md').slice(0, 2000),
    readAtomsDoc(input.projectId, 'PROGRESS.md').slice(0, 1500),
    readAtomsDoc(input.projectId, 'ARCHITECTURE.md').slice(0, 1500),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n')

  const briefBlock = input.brief
    ? `BRIEF (authoritative):\n${JSON.stringify(input.brief, null, 2)}`
    : ''

  const system = [
    s0,
    input.extraSystem ?? '',
    'Available tools — you MUST mutate files via tool fences (markdown alone does nothing). Preferred form:',
    '```tool_call',
    '{"name":"write_file","args":{"path":"app/frontend/src/App.tsx","content":"..."}}',
    '```',
    'Also accepted: ```write_file / ```edit_file / ```read_file with a JSON args object.',
    'edit_file args: {"path":"...","old_string":"...","new_string":"..."}. For full-file replace use write_file.',
    'When finished with your role duties, write DONE and a short summary without more tool calls.',
    briefBlock,
    `FILE TREE:\n${tree}`,
    atoms ? `PROJECT MEMORY:\n${atoms}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const historyMsgs: Array<{ role: 'user' | 'assistant'; content: string }> = []
  let budget = MAX_HISTORY_CHARS
  for (const h of [...input.history].reverse()) {
    const content = h.content.slice(0, 2000)
    if (budget <= 0) break
    budget -= content.length
    const role = h.role === 'user' ? 'user' : 'assistant'
    historyMsgs.unshift({ role, content: h.agent_id ? `[${h.agent_id}] ${content}` : content })
  }

  return [
    { role: 'system', content: system },
    ...historyMsgs,
    { role: 'user', content: input.userText },
  ]
}
