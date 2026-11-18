// Vrije blokken zoeken in de agenda. Zelfde regels als `findFreeSlots` in legacy/src/utils/calendarApi.js:
// werkdagen 09:00 tot 17:30, een raster van 15 minuten, weekend overslaan, tijdzone Europe/Amsterdam.
import { isoWeekday } from '../../src/lib/dates'
import { todayAmsterdam } from './clock'
import type { CalEvent } from './googleApi'

export const TZ = 'Europe/Amsterdam'
export const WORKDAY_START = { h: 9, m: 0 }
export const WORKDAY_END = { h: 17, m: 30 }
const GRID_MS = 15 * 60_000

export interface Interval {
  start: number
  end: number
}

/** Verschil tussen Amsterdam en UTC op dit moment, in milliseconden. */
function offsetMs(at: number): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at))
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value)
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(at / 1000) * 1000
}

/** Een klokslag in Amsterdam (dag + uur + minuut) als echt tijdstip. */
export function amsterdamTime(day: string, h: number, m: number): number {
  const [y, mo, d] = day.split('-').map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, m)
  const first = guess - offsetMs(guess)
  return guess - offsetMs(first) // tweede ronde vangt de zomer-/wintertijdgrens op
}

const ceilGrid = (ms: number) => Math.ceil(ms / GRID_MS) * GRID_MS

const nextDay = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Welke afspraken houden je bezig? Niet: geannuleerd, geweigerd, "beschikbaar" of een gewone hele-dag-melding. */
export function busyFromEvents(events: CalEvent[]): Interval[] {
  const out: Interval[] = []
  for (const e of events) {
    if (e.status === 'cancelled' || e.transparency === 'transparent') continue
    if (e.attendees?.find((a) => a.self)?.responseStatus === 'declined') continue
    if (e.start?.dateTime && e.end?.dateTime) {
      out.push({ start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime) })
    } else if (e.start?.date && e.end?.date && e.eventType === 'outOfOffice') {
      out.push({ start: amsterdamTime(e.start.date, 0, 0), end: amsterdamTime(e.end.date, 0, 0) })
    }
  }
  return out.filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start).sort((a, b) => a.start - b.start)
}

export interface Slot {
  start: Date
  end: Date
  /** De dag van het blok (YYYY-MM-DD, Amsterdam). */
  day: string
}

/** Het eerstvolgende vrije blok van `minutes` minuten, of null als er binnen `daysAhead` dagen niets is. */
export function findFreeSlot(busy: Interval[], now: Date, minutes: number, daysAhead = 14): Slot | null {
  const need = minutes * 60_000
  let day = todayAmsterdam(now)
  for (let i = 0; i <= daysAhead; i++, day = nextDay(day)) {
    if (isoWeekday(day) >= 6) continue
    const dayStart = amsterdamTime(day, WORKDAY_START.h, WORKDAY_START.m)
    const dayEnd = amsterdamTime(day, WORKDAY_END.h, WORKDAY_END.m)
    let cursor = ceilGrid(Math.max(dayStart, now.getTime()))
    for (const b of busy) {
      if (b.end <= cursor || b.start >= dayEnd) continue
      if (b.start - cursor >= need) break
      cursor = Math.max(cursor, ceilGrid(b.end))
    }
    if (dayEnd - cursor >= need) return { start: new Date(cursor), end: new Date(cursor + need), day }
  }
  return null
}
