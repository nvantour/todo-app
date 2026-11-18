import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { Bucket, Project, Recurrence } from '../../src/model/types'
import { formatLongDate } from '../../src/lib/dates'
import { parseQuickAdd } from '../../src/lib/parse'
import { detectClient } from './service'
import { isoDate, recurrenceSchema, timeOfDay } from './schemas'

export const CAPTURE_MODEL = 'claude-haiku-5-5'

/** Eén taak zoals capture die oplevert, nog niet opgeslagen. */
export interface CaptureItem {
  title: string
  due: string | null
  dueTime: string | null
  recurrence: Recurrence | null
  projectId: string | null
  bucket: Bucket
}

export interface CaptureResult {
  items: CaptureItem[]
  /** 'ai' = Haiku, 'fallback' = de vaste parser (geen sleutel of Haiku gaf een fout). */
  engine: 'ai' | 'fallback'
}

/** Wat Haiku moet teruggeven. Alle velden verplicht (nullable) zodat de uitvoer altijd dezelfde vorm heeft. */
const NULL = { type: 'null' } as const
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['todos'],
  properties: {
    todos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'due', 'dueTime', 'recurrence', 'projectId', 'bucket'],
        properties: {
          title: { type: 'string' },
          due: { anyOf: [{ type: 'string' }, NULL] },
          dueTime: { anyOf: [{ type: 'string' }, NULL] },
          recurrence: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['freq', 'interval', 'weekdays'],
                properties: {
                  freq: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
                  interval: { type: 'integer' },
                  weekdays: { anyOf: [{ type: 'array', items: { type: 'integer' } }, NULL] },
                },
              },
              NULL,
            ],
          },
          projectId: { anyOf: [{ type: 'string' }, NULL] },
          bucket: { type: 'string', enum: ['now', 'later'] },
        },
      },
    },
  },
} as const

const SYSTEM_PROMPT = `Je zet vrije tekst (getypt of ingesproken, Nederlands) om in todo's voor één persoon.

Regels:
- Staan er meerdere taken in de tekst, maak dan meerdere todo's. Eén taak blijft één todo.
- title: korte, duidelijke omschrijving van wat er gedaan moet worden. Laat datum- en tijdwoorden en de naam van de klant weg uit de titel. Begin met een hoofdletter.
- due: de datum als YYYY-MM-DD, alleen als er een datum of dag genoemd wordt ("morgen", "vrijdag", "15 december"). Rekening met de datum van vandaag die in het bericht staat; een weekdag zonder meer is de eerstvolgende keer (vandaag telt niet mee tenzij "vandaag" er staat). Anders null.
- dueTime: HH:mm (24 uur), alleen bij een genoemd tijdstip. Anders null.
- recurrence: alleen bij een herhaling ("elke week", "elke maandag", "iedere maand"). freq is day, week, month of year; interval is "elke X"; weekdays alleen bij week (1 = maandag tot 7 = zondag), anders null. Geen herhaling: null.
- projectId: het id van de klant uit de lijst, als de tekst duidelijk over die klant gaat; anders null. Verzin nooit een id.
- bucket: "now" is de standaard. Gebruik "later" alleen als het om iets gaat dat niet vergeten mag worden maar nog niet aan de beurt is ("niet vergeten", "ooit", "op termijn", "later nog").
- Verzin niets bij: geen datum, tijd of klant als die er niet staat.`

const aiSchema = z.object({
  todos: z
    .array(
      z.object({
        title: z.string(),
        due: z.string().nullable(),
        dueTime: z.string().nullable(),
        recurrence: z
          .object({ freq: z.enum(['day', 'week', 'month', 'year']), interval: z.number(), weekdays: z.array(z.number()).nullable() })
          .nullable(),
        projectId: z.string().nullable(),
        bucket: z.enum(['now', 'later']),
      }),
    )
    .max(50),
})

export interface CaptureContext {
  text: string
  projects: Project[]
  today: string
  sourceLabel?: string
}

/** Maakt de aanroep naar Haiku; los van de rest zodat tests hem kunnen vervangen. */
export type AiCapture = (ctx: CaptureContext) => Promise<CaptureItem[]>

export function createHaikuCapture(apiKey: string): AiCapture {
  const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 })
  return async (ctx) => {
    const klanten = ctx.projects
      .filter((p) => !p.archived)
      .map((p) => `- ${p.id}: ${p.name} (trefwoorden: ${p.keywords.join(', ')})`)
      .join('\n')
    const response = await client.messages.create({
      model: CAPTURE_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
      messages: [
        {
          role: 'user',
          content: `Vandaag is ${formatLongDate(ctx.today)} (${ctx.today}, tijdzone Europe/Amsterdam).\n\nKlanten:\n${klanten || '(geen)'}\n\nTekst:\n${ctx.text}`,
        },
      ],
    })
    if (response.stop_reason === 'refusal') throw new Error('Haiku weigerde de aanvraag')
    if (response.stop_reason === 'max_tokens') throw new Error('Haiku-antwoord werd afgekapt')
    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('Haiku gaf geen tekst terug')
    return normalize(aiSchema.parse(JSON.parse(block.text)).todos, ctx)
  }
}

/** Haalt onzin eruit: ongeldige datums/tijden/klant-ids worden null, lege titels vallen weg. */
export function normalize(
  raw: { title: string; due: string | null; dueTime: string | null; recurrence: { freq: Recurrence['freq']; interval: number; weekdays: number[] | null } | null; projectId: string | null; bucket: Bucket }[],
  ctx: CaptureContext,
): CaptureItem[] {
  const knownIds = new Set(ctx.projects.filter((p) => !p.archived).map((p) => p.id))
  const items: CaptureItem[] = []
  for (const r of raw) {
    const title = r.title.trim()
    if (!title) continue
    const rec = r.recurrence
      ? recurrenceSchema.safeParse({ freq: r.recurrence.freq, interval: Math.round(r.recurrence.interval), ...(r.recurrence.weekdays && r.recurrence.freq === 'week' ? { weekdays: r.recurrence.weekdays } : {}) })
      : null
    // klantherkenning: eerst de vaste trefwoorden, daarna de keuze van Haiku
    const projectId = detectClient([title, ctx.sourceLabel], ctx.projects) ?? (r.projectId && knownIds.has(r.projectId) ? r.projectId : null)
    items.push({
      title,
      due: r.due && isoDate.safeParse(r.due).success ? r.due : null,
      dueTime: r.dueTime && timeOfDay.safeParse(r.dueTime).success ? r.dueTime : null,
      recurrence: rec?.success ? rec.data : null,
      projectId,
      bucket: r.bucket,
    })
  }
  return items
}

/** Vaste parser: splitst op regels (en puntkomma's) en laat `parseQuickAdd` elk stuk lezen. */
export function fallbackCapture(ctx: CaptureContext): CaptureItem[] {
  const parts = ctx.text
    .split(/[\n;]+/)
    .map((s) => s.trim().replace(/^[-*•\d.)\s]+(?=\S)/, ''))
    .filter(Boolean)
  const items: CaptureItem[] = []
  for (const part of parts) {
    const p = parseQuickAdd(part, ctx.projects, ctx.today)
    if (!p.title.trim()) continue
    items.push({
      title: p.title.trim(),
      due: p.due,
      dueTime: p.dueTime,
      recurrence: p.recurrence,
      projectId: p.projectId ?? detectClient([p.title, ctx.sourceLabel], ctx.projects),
      bucket: 'now',
    })
  }
  return items
}

export async function runCapture(ctx: CaptureContext, ai: AiCapture | null, onError?: (e: unknown) => void): Promise<CaptureResult> {
  if (ai) {
    try {
      const items = await ai(ctx)
      if (items.length) return { items, engine: 'ai' }
    } catch (e) {
      onError?.(e)
    }
  }
  return { items: fallbackCapture(ctx), engine: 'fallback' }
}
