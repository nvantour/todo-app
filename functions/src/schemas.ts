import { z } from 'zod'

const validDay = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum moet YYYY-MM-DD zijn')
  .refine(validDay, 'Dit is geen bestaande datum')
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Tijd moet HH:mm zijn')

export const SOURCE_TYPES = ['manual', 'voice', 'mail', 'meeting', 'calendar', 'airtable', 'chat', 'claude', 'api'] as const

export const sourceSchema = z.object({
  type: z.enum(SOURCE_TYPES),
  label: z.string().max(300).optional(),
  url: z.string().max(2000).optional(),
  externalId: z.string().max(300).optional(),
})

export const recurrenceSchema = z.object({
  freq: z.enum(['day', 'week', 'month', 'year']),
  interval: z.number().int().min(1).max(365),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
})

const subtaskSchema = z.object({ id: z.string().max(100), title: z.string().max(500), done: z.boolean() })

const todoFields = {
  title: z.string().trim().min(1, 'Titel is verplicht').max(500),
  note: z.string().max(10_000),
  due: isoDate.nullable(),
  dueTime: timeOfDay.nullable(),
  bucket: z.enum(['now', 'later']),
  projectId: z.string().max(100).nullable(),
  labelIds: z.array(z.string().max(100)).max(50),
  subtasks: z.array(subtaskSchema).max(100),
  estimateMin: z.number().int().min(0).max(100_000).nullable(),
  recurrence: recurrenceSchema.nullable(),
}

export const newTodoSchema = z.object({ ...z.object(todoFields).partial().shape, title: todoFields.title, source: sourceSchema.optional() })

export const patchTodoSchema = z.object({ ...z.object(todoFields).partial().shape, done: z.boolean().optional() })

export const captureSchema = z.object({
  text: z.string().trim().min(1, 'Tekst is verplicht').max(5000),
  source: sourceSchema.optional(),
  dryRun: z.boolean().optional(),
})

export const suggestionSchema = z.object({
  title: todoFields.title,
  note: z.string().max(10_000).optional(),
  due: isoDate.nullable().optional(),
  projectId: z.string().max(100).nullable().optional(),
  bucket: z.enum(['now', 'later']).optional(),
  source: sourceSchema,
  reason: z.string().max(1000).optional(),
})

export type NewTodoInput = z.infer<typeof newTodoSchema>
export type PatchTodoInput = z.infer<typeof patchTodoSchema>
export type SuggestionInput = z.infer<typeof suggestionSchema>

export const airtableResolveSchema = z.object({ url: z.string().trim().min(1, 'Link is verplicht').max(2000) })

export const scheduleSchema = z.object({
  minutes: z.number().int().min(15, 'Minimaal 15 minuten').max(480, 'Maximaal 8 uur'),
  /** Plan opnieuw in en haal het eerdere blok uit de agenda. */
  replace: z.boolean().optional(),
})

export const deviceSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  label: z.string().trim().min(1).max(80).default('Apparaat'),
})

// --- Antwoorden ---

const replyMessageSchema = z.object({
  author: z.string().max(200),
  text: z.string().max(10_000),
  at: z.string().max(40).nullable().optional().transform((v) => v ?? null),
  mine: z.boolean().optional(),
})

export const incomingReplySchema = z.object({
  channel: z.enum(['mail', 'gchat', 'slack', 'teams']),
  externalId: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(300),
  who: z.string().max(300).default(''),
  projectId: z.string().max(100).nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
  target: z.object({
    threadId: z.string().max(200).optional(),
    space: z.string().max(200).optional(),
    thread: z.string().max(300).optional(),
    url: z.string().max(2000).optional(),
    channel: z.string().max(100).optional(),
    ts: z.string().max(100).optional(),
  }),
  messages: z.array(replyMessageSchema).max(50),
  draft: z.string().trim().min(1, 'Een voorstel voor het antwoord is verplicht').max(10_000),
  reason: z.string().max(1000).optional(),
})

export const repliesInSchema = z.object({ replies: z.array(incomingReplySchema).min(1).max(100) })

/** Alleen het verzendscript: voortgang van een goedgekeurd antwoord. Goedkeuren zelf kan alleen in de app. */
export const replyResultSchema = z.object({
  status: z.enum(['sending', 'sent', 'failed']),
  error: z.string().max(500).optional(),
})

export const replySendSchema = z.object({ text: z.string().trim().min(1).max(10_000) })

export type IncomingReplyInput = z.infer<typeof incomingReplySchema>
