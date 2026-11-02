import { z } from 'zod'
import { BriefSchema } from './brief.ts'
import { RoleIdSchema } from './roles.ts'
import { ToolNameSchema } from './tools.ts'

export const QuestionCardSchema = z.object({
  type: z.literal('question'),
  id: z.string(),
  questions: z.array(
    z.object({
      id: z.string(),
      prompt: z.string(),
      options: z.array(z.string()).optional(),
    }),
  ),
})
export type QuestionCard = z.infer<typeof QuestionCardSchema>

export const PlanCardSchema = z.object({
  type: z.literal('plan'),
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  brief: BriefSchema,
  status: z.enum(['pending', 'approved', 'declined']),
})
export type PlanCard = z.infer<typeof PlanCardSchema>

export const VersionCardSchema = z.object({
  type: z.literal('version'),
  id: z.string(),
  version_id: z.string(),
  label: z.string(),
  created_at: z.string(),
})
export type VersionCard = z.infer<typeof VersionCardSchema>

export const ToolCardSchema = z.object({
  type: z.literal('tool'),
  id: z.string(),
  tool: ToolNameSchema,
  status: z.enum(['running', 'ok', 'error']),
  summary: z.string(),
  role: RoleIdSchema.optional(),
})
export type ToolCard = z.infer<typeof ToolCardSchema>

export const ActivityCardSchema = z.object({
  type: z.literal('activity'),
  id: z.string(),
  role: RoleIdSchema,
  text: z.string(),
})
export type ActivityCard = z.infer<typeof ActivityCardSchema>

export const IssueCardSchema = z.object({
  type: z.literal('issue'),
  id: z.string(),
  issue_id: z.string(),
  phase: z.string(),
  summary: z.string(),
  status: z.enum(['open', 'resolving', 'resolved', 'exhausted']),
})
export type IssueCard = z.infer<typeof IssueCardSchema>

export const CardSchema = z.discriminatedUnion('type', [
  QuestionCardSchema,
  PlanCardSchema,
  VersionCardSchema,
  ToolCardSchema,
  ActivityCardSchema,
  IssueCardSchema,
])
export type Card = z.infer<typeof CardSchema>
