import type { Recurrence } from '../model/types'

const pad = (n: number) => String(n).padStart(2, '0')

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Leest 'YYYY-MM-DD' als lokale dag (niet als UTC). */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now)
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseISODate(a).getTime() - parseISODate(b).getTime()) / 86_400_000)
}

/** 1 = maandag … 7 = zondag. */
export function isoWeekday(iso: string): number {
  return parseISODate(iso).getDay() || 7
}

/** Maandag van de week waarin `iso` valt. */
export function weekStart(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso))
}

export function formatDue(iso: string, today: string = todayISO()): string {
  const diff = diffDays(iso, today)
  if (diff === 0) return 'Vandaag'
  if (diff === 1) return 'Morgen'
  if (diff === -1) return 'Gisteren'
  const d = parseISODate(iso)
  if (diff > 1 && diff < 7) return capitalize(d.toLocaleDateString('nl-NL', { weekday: 'long' }))
  const sameYear = d.getFullYear() === parseISODate(today).getFullYear()
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

export function formatLongDate(iso: string): string {
  return capitalize(parseISODate(iso).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }))
}

export function formatEstimate(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} u ${m}` : `${h} u`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function addMonths(iso: string, months: number): string {
  const d = parseISODate(iso)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return toISODate(d)
}

/**
 * De eerstvolgende datum van een terugkerende todo, altijd ná vandaag
 * (een gemiste herhaling stapelt dus niet op).
 */
export function nextOccurrence(due: string, rule: Recurrence, today: string = todayISO()): string {
  const interval = Math.max(1, rule.interval)
  let next = due
  for (let guard = 0; guard < 5000; guard++) {
    next = step(next, rule, interval)
    if (next > today) return next
  }
  return next
}

function step(from: string, rule: Recurrence, interval: number): string {
  switch (rule.freq) {
    case 'day':
      return addDays(from, interval)
    case 'month':
      return addMonths(from, interval)
    case 'year':
      return addMonths(from, 12 * interval)
    case 'week': {
      const days = rule.weekdays?.length ? [...rule.weekdays].sort((a, b) => a - b) : [isoWeekday(from)]
      const current = isoWeekday(from)
      const later = days.find((d) => d > current)
      if (later) return addDays(from, later - current)
      // naar de eerste gekozen dag van de volgende (interval-)week
      return addDays(from, 7 * interval - (current - days[0]))
    }
  }
}

const WEEKDAYS = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']

export function describeRecurrence(rule: Recurrence): string {
  const n = rule.interval
  if (rule.freq === 'week' && rule.weekdays?.length) {
    const names = rule.weekdays.map((d) => WEEKDAYS[d - 1])
    if (rule.weekdays.join() === '1,2,3,4,5' && n === 1) return 'Elke werkdag'
    return `${n === 1 ? 'Elke' : `Elke ${n} weken op`} ${names.join(', ')}`
  }
  const unit = { day: ['dag', 'dagen'], week: ['week', 'weken'], month: ['maand', 'maanden'], year: ['jaar', 'jaar'] }[rule.freq]
  return n === 1 ? `Elke ${unit[0]}` : `Elke ${n} ${unit[1]}`
}

/** Valt de dag in het weekend, dan de vrijdag ervoor; anders dezelfde dag. */
export function lastWorkdayOnOrBefore(iso: string): string {
  const wd = isoWeekday(iso)
  return wd === 7 ? addDays(iso, -2) : wd === 6 ? addDays(iso, -1) : iso
}

/**
 * Rekent `n` werkdagen terug (maandag t/m vrijdag; feestdagen tellen als gewone werkdag).
 * Voorbeeld: 3 werkdagen voor maandag 23 nov is woensdag 18 nov. Valt de dag zelf in het weekend,
 * dan telt de vrijdag ervoor als begin.
 */
export function subtractWorkdays(iso: string, n: number): string {
  let day = lastWorkdayOnOrBefore(iso)
  let left = Math.max(0, Math.round(n))
  while (left > 0) {
    day = lastWorkdayOnOrBefore(addDays(day, -1))
    left--
  }
  return day
}
