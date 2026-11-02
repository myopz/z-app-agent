import { z } from 'zod'
import { CardSchema } from './cards.ts'
import { RoleIdSchema } from './roles.ts'

export const ServerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message.delta'),
    message_id: z.string(),
    text: z.string(),
    role: RoleIdSchema.optional(),
  }),
  z.object({
    type: z.literal('message'),
    message_id: z.string(),
    agent_id: RoleIdSchema.nullable(),
    kind: z.string(),
    content: z.unknown(),
  }),
  z.object({
    type: z.literal('card'),
    card: CardSchema,
  }),
  z.object({
    type: z.literal('terminal'),
    chunk: z.string(),
  }),
  z.object({
    type: z.literal('console'),
    chunk: z.string(),
  }),
  z.object({
    type: z.literal('run.status'),
    run_id: z.string(),
    status: z.string(),
    phase: z.string(),
  }),
  z.object({
    type: z.literal('preview.ready'),
    url: z.string(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('checkpoint'),
    resumable: z.boolean(),
    phase: z.string().optional(),
    run_id: z.string().optional(),
  }),
])
export type ServerEvent = z.infer<typeof ServerEventSchema>

export const BuildModeSchema = z.enum(['build', 'goal'])
export type BuildMode = z.infer<typeof BuildModeSchema>

export const CollabModeSchema = z.enum(['team', 'engineer'])
export type CollabMode = z.infer<typeof CollabModeSchema>
