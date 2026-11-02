import { z } from 'zod'

export const RoleIdSchema = z.enum([
  'mike',
  'emma',
  'bob',
  'alex',
  'david',
  'iris',
  'sarah',
  'adrian',
])
export type RoleId = z.infer<typeof RoleIdSchema>

export const ROLE_LABELS: Record<RoleId, string> = {
  mike: 'Mike · Team Leader',
  emma: 'Emma · Product Manager',
  bob: 'Bob · Architect',
  alex: 'Alex · Engineer',
  david: 'David · Data Analyst',
  iris: 'Iris · Deep Researcher',
  sarah: 'Sarah · SEO (stub)',
  adrian: 'Adrian · Ads (stub)',
}
