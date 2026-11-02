import { z } from 'zod'

export const ToolNameSchema = z.enum([
  'list_files',
  'read_file',
  'write_file',
  'edit_file',
  'run_command',
  'install_deps',
  'build',
  'preview',
  'resolve_issue',
  'web_search',
])
export type ToolName = z.infer<typeof ToolNameSchema>

export const ToolCallSchema = z.object({
  name: ToolNameSchema,
  args: z.record(z.unknown()).default({}),
})
export type ToolCall = z.infer<typeof ToolCallSchema>
