import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { CalendarRule, Project } from '../../src/model/types'
import { addDays, subtractWorkdays } from '../../src/lib/dates'
import { todayAmsterdam } from './clock'
import { HttpError } from './errors'
import { hasCalendar, type GoogleService } from './google'
import type { CalEvent } from './googleApi'
import type { Repo } from './repo'
import { applyRules, ensureDefaultRules } from './rules'
import { detectClient, type TodoService } from './service'

export const SCAN_DAYS = 14
export const PREP_MODEL = 'claude-haiku-5-5'
const MAX_JUDGED = 40

/** Een afspraak zoals wij hem gebruiken. */
export interface ScanEvent {
  id: string
  title: string
  /** Dag van de afspraak (YYYY-MM-DD, Europe/Amsterdam). */
  day: string
  /** Starttijd HH:mm, of null bij een afspraak voor de hele dag. */
  time: string | null
  url?: string
  recurring: boolean
  free: boolean
  /** E-mailadressen van deelnemers buiten het eigen bedrijf. */
  externalEmails: string[]
  attendeeCount: number
}

/**
 * Welke afspraken tellen mee? Geannuleerde niet, afspraken die jij hebt geweigerd niet, en geen
 * agenda-items van een andere soort (verjaardag, afwezig, werklocatie, focustijd).
 */
export function toScanEvents(events: CalEvent[], ownDomain: string): ScanEvent[] {
  const out: ScanEvent[] = []
  for (const e of events) {
    if (e.status === 'cancelled') continue
    if (e.eventType && e.eventType !== 'default') continue
    const me = e.attendees?.find((a) => a.self)
    if (me?.responseStatus === 'declined') continue
    const title = (e.summary ?? '').trim()
    const start = e.start?.dateTime ?? e.start?.date
    if (!title || !start) continue
    const allDay = !e.start?.dateTime
    const day = allDay ? start : todayAmsterdam(new Date(start))
    const time = allDay ? null : new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(start))
    const people = (e.attendees ?? []).filter((a) => !a.resource && !a.self && a.email)
    const emails = [...people.map((a) => a.email!), e.organizer && !e.organizer.self ? e.organizer.email : undefined].filter((x): x is string => Boolean(x))
    const external = [...new Set(emails.filter((m) => !ownDomain || !m.toLowerCase().endsWith(`@${ownDomain}`)).map((m) => m.toLowerCase()))]
    out.push({ id: e.id, title, day, time, url: e.htmlLink, recurring: Boolean(e.recurringEventId), free: e.transparency === 'transparent', externalEmails: external, attendeeCount: people.length })
  }
  return out
}

// --- Haiku: welke overige afspraken vragen voorbereiding? ---

export interface PrepAdvice {
  id: string
  /** Titel van de voorbereidingstaak. */
  title: string
  workdaysBefore: number
  reason: string
}

export type PrepJudge = (events: ScanEvent[], ctx: { today: string; projects: Project[] }) => Promise<PrepAdvice[]>

const PREP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prep'],
  properties: {
    prep: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'workdaysBefore', 'reason'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          workdaysBefore: { type: 'integer' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const

const PREP_PROMPT = `Je helpt één consultant (experimentation en CRO-adviseur) die klantafspraken heeft. Je krijgt een lijst afspraken uit zijn agenda. Kies alleen de afspraken waarvoor hij echt iets moet voorbereiden: een presentatie of resultaten delen, een kwartaalgesprek of voortgangsgesprek met een klant, een workshop of training die hij geeft, een pitch of offertegesprek.

Wees streng. Liever geen voorstel dan ruis. Geen voorbereiding nodig bij: wekelijkse of vaste overleggen, korte check-ins, lunch, reistijd, interne routine, een-op-een met collega's, afspraken zonder duidelijk doel, afspraken waar hij alleen toehoort.

Per gekozen afspraak:
- id: het id uit de lijst, ongewijzigd.
- title: korte taak in het Nederlands, bijvoorbeeld "Resultaten voorbereiden voor de bespreking met Wehkamp". Begin met een werkwoord of het onderwerp, geen hoofdletters-tekst.
- workdaysBefore: hoeveel werkdagen vóór de afspraak de voorbereiding af moet zijn: 1 voor een gewone afspraak, 2 of 3 voor een grote presentatie of workshop.
- reason: één korte zin waarom.
Is er niets duidelijks, geef dan een lege lijst.`

const adviceSchema = z.object({
  prep: z.array(z.object({ id: z.string(), title: z.string(), workdaysBefore: z.number(), reason: z.string() })).max(50),
})

export function createHaikuPrepJudge(apiKey: string): PrepJudge {
  const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 1 })
  return async (events, ctx) => {
    const lines = events.map((e) =>
      JSON.stringify({ id: e.id, titel: e.title, dag: e.day, tijd: e.time, deelnemers: e.attendeeCount, externeDomeinen: [...new Set(e.externalEmails.map((m) => m.split('@')[1]))] }),
    )
    const response = await client.messages.create({
      model: PREP_MODEL,
      max_tokens: 3000,
      system: PREP_PROMPT,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: PREP_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user', content: `Vandaag is ${ctx.today}.\n\nAfspraken (één per regel, JSON):\n${lines.join('\n')}` }],
    })
    if (response.stop_reason === 'refusal') throw new Error('Haiku weigerde de aanvraag')
    if (response.stop_reason === 'max_tokens') throw new Error('Haiku-antwoord werd afgekapt')
    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('Haiku gaf geen tekst terug')
    return adviceSchema.parse(JSON.parse(block.text)).prep
  }
}

// --- plannen: afspraken + regels + advies -> voorstellen ---

export interface Candidate {
  externalId: string
  title: string
  due: string
  projectId: string | null
  reason: string
  label: string
  url?: string
}

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** De dag waarop een voorbereiding af moet zijn: n werkdagen voor de afspraak, nooit eerder dan vandaag. */
export function prepDue(eventDay: string, workdaysBefore: number, today: string): string {
  const d = subtractWorkdays(eventDay, workdaysBefore)
  return d < today ? today : d
}

export function planCandidates(input: {
  events: ScanEvent[]
  rules: CalendarRule[]
  projects: Project[]
  today: string
  advice: PrepAdvice[]
}): Candidate[] {
  const { events, rules, projects, today } = input
  const adviceById = new Map(input.advice.map((a) => [a.id, a]))
  const out: Candidate[] = []
  for (const e of events) {
    const label = `${e.title} · ${dayLabel(e.day)}`
    const projectId = detectClient([e.title, ...e.externalEmails], projects)
    const hits = applyRules(rules, e.title, e.day, today)
    hits.forEach((h, i) => {
      out.push({
        externalId: i === 0 ? e.id : `${e.id}#${h.rule.id}`,
        title: h.title,
        due: h.due,
        projectId,
        reason: `Regel “${h.rule.match}”: ${h.rule.workdaysBefore} werkdag${h.rule.workdaysBefore === 1 ? '' : 'en'} voor de afspraak op ${dayLabel(e.day)}.`,
        label,
        url: e.url,
      })
    })
    if (hits.length) continue
    const a = adviceById.get(e.id)
    const title = a?.title.trim()
    if (!a || !title) continue
    const days = Math.min(5, Math.max(0, Math.round(Number.isFinite(a.workdaysBefore) ? a.workdaysBefore : 1)))
    out.push({
      externalId: e.id,
      title,
      due: prepDue(e.day, days, today),
      projectId,
      reason: `Claude denkt dat deze afspraak voorbereiding vraagt: ${a.reason.trim() || 'geen toelichting'}`,
      label,
      url: e.url,
    })
  }
  return out
}

/** Welke afspraken mogen naar Haiku? Eenmalige, niet-vrije afspraken die niet al door een regel geraakt zijn. */
export function judgeable(events: ScanEvent[], rules: CalendarRule[], today: string): ScanEvent[] {
  return events
    .filter((e) => !e.recurring && !e.free && applyRules(rules, e.title, e.day, today).length === 0)
    .slice(0, MAX_JUDGED)
}

// --- uitvoeren ---

export interface ScanDeps {
  repo: Repo
  service: TodoService
  google: GoogleService
  ai: PrepJudge | null
  onError?: (e: unknown) => void
}

export interface ScanResult {
  found: number
  created: number
  duplicates: number
}

export async function runCalendarScan(deps: ScanDeps, uid: string): Promise<ScanResult> {
  const { repo, service } = deps
  const stamp = service.stamp()
  try {
    const conn = await deps.google.connection(uid)
    if (!hasCalendar(conn)) throw new HttpError(409, 'google_scope_missing', 'De agenda is niet gekoppeld (toestemming ontbreekt). Koppel opnieuw in Instellingen.')
    await ensureDefaultRules(repo, uid)
    const api = await deps.google.api(uid)
    const today = service.today()
    const now = new Date(stamp)
    const raw = await api.listEvents(now.toISOString(), new Date(now.getTime() + (SCAN_DAYS + 1) * 86_400_000).toISOString())
    const ownDomain = conn.email.split('@')[1]?.toLowerCase() ?? ''
    const last = addDays(today, SCAN_DAYS)
    const events = toScanEvents(raw, ownDomain).filter((e) => e.day >= today && e.day <= last)
    const [rules, projects] = await Promise.all([repo.listCalendarRules(uid), service.listProjects(uid)])

    let advice: PrepAdvice[] = []
    const toJudge = judgeable(events, rules, today)
    if (deps.ai && toJudge.length) {
      try {
        advice = await deps.ai(toJudge, { today, projects })
      } catch (e) {
        deps.onError?.(e) // zonder Haiku werken de regels gewoon door
      }
    }

    const candidates = planCandidates({ events, rules, projects, today, advice })
    let created = 0
    for (const c of candidates) {
      const r = await service.suggest(uid, {
        title: c.title,
        due: c.due,
        projectId: c.projectId,
        reason: c.reason,
        bucket: 'later',
        source: { type: 'calendar', label: c.label, url: c.url, externalId: c.externalId },
      })
      if (r.created) created++
    }
    const result = { found: candidates.length, created, duplicates: candidates.length - created }
    await repo.saveState(uid, { lastCalendarScan: { at: stamp, found: result.found, created } })
    return result
  } catch (e) {
    await repo.saveState(uid, { lastCalendarScan: { at: stamp, found: 0, created: 0, error: e instanceof HttpError ? e.message : 'De scan is mislukt.' } }).catch(() => undefined)
    throw e
  }
}
