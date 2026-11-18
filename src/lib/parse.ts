import type { Project, Recurrence } from '../model/types'
import { addDays, isoWeekday, parseISODate, toISODate, todayISO } from './dates'
import { detectProject } from './detect'

export interface ParsedTodo {
  title: string
  due: string | null
  dueTime: string | null
  recurrence: Recurrence | null
  projectId: string | null
}

// Nederlandse woorden die we herkennen ---------------------------------------

const WEEKDAYS = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']
const WD = WEEKDAYS.join('|')
const MONTHS: Record<string, number> = {
  januari: 1, jan: 1, februari: 2, feb: 2, maart: 3, mrt: 3, april: 4, apr: 4, mei: 5, juni: 6, jun: 6,
  juli: 7, jul: 7, augustus: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10,
  november: 11, nov: 11, december: 12, dec: 12,
}
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')
const NUMBER_WORDS: Record<string, number> = { een: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10 }
const NUM = `\\d+|${Object.keys(NUMBER_WORDS).join('|')}`
const UNITS = 'dagen|dag|weken|week|maanden|maand|jaren|jaar'
// Voorzetsels vlak voor een datum horen bij de datum ("voor vrijdag") en gaan dus mee uit de titel.
const PREP = '(?:(?:op|voor|per|tegen|uiterlijk|deze|aanstaande|komende)\\s+)?'

/** Hele woorden, ook met letters als é of ë (\b werkt alleen voor ASCII). */
const word = (pattern: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu')

const toNumber = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUMBER_WORDS[s.toLowerCase()])
const unitFreq = (u: string): Recurrence['freq'] => {
  const x = u.toLowerCase()
  return x.startsWith('dag') ? 'day' : x.startsWith('week') || x.startsWith('weken') ? 'week' : x.startsWith('maand') ? 'month' : 'year'
}
const weekdayNumber = (name: string) => WEEKDAYS.indexOf(name.toLowerCase()) + 1

interface Cut {
  text: string
  /** Wat er uit de tekst is gehaald, of null als er niets gevonden is. */
  found: RegExpMatchArray | null
}

/** Haalt de eerste treffer uit de tekst en laat de rest staan. */
function cut(text: string, re: RegExp): Cut {
  const found = text.match(re)
  if (!found || found.index === undefined) return { text, found: null }
  return { text: `${text.slice(0, found.index)} ${text.slice(found.index + found[0].length)}`, found }
}

function isValidDate(y: number, m: number, d: number): boolean {
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

/** Dag + maand zonder jaar: de eerstvolgende keer dat die dag voorkomt (vandaag telt mee). */
function dayMonth(d: number, m: number, today: string): string | null {
  const year = parseISODate(today).getFullYear()
  for (const y of [year, year + 1]) {
    if (!isValidDate(y, m, d)) continue
    const iso = toISODate(new Date(y, m - 1, d))
    if (iso >= today) return iso
  }
  return null
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

// Herhaling ------------------------------------------------------------------

function findRecurrence(text: string): { text: string; rule: Recurrence } | null {
  const attempts: Array<[RegExp, (m: RegExpMatchArray) => Recurrence]> = [
    [word('(?:elke|iedere)\\s+werkdag|werkdagelijks'), () => ({ freq: 'week', interval: 1, weekdays: [1, 2, 3, 4, 5] })],
    [word(`(?:elke|iedere)\\s+(${NUM})\\s+(${UNITS})`), (m) => ({ freq: unitFreq(m[2]), interval: toNumber(m[1]) || 1 })],
    [
      // "elke maandag", "elke maandag en donderdag", "elke maandag, woensdag en vrijdag"
      word(`(?:elke|iedere)\\s+((?:${WD})(?:(?:\\s*,\\s*|\\s+en\\s+)(?:${WD}))*)`),
      (m) => {
        const days = [...new Set((m[1].match(new RegExp(WD, 'giu')) ?? []).map(weekdayNumber))].sort((a, b) => a - b)
        return { freq: 'week', interval: 1, weekdays: days }
      },
    ],
    [word('(?:elke|iedere)\\s+dag|dagelijks'), () => ({ freq: 'day', interval: 1 })],
    [word('(?:elke|iedere)\\s+week|wekelijks'), () => ({ freq: 'week', interval: 1 })],
    [word('(?:elke|iedere)\\s+maand|maandelijks'), () => ({ freq: 'month', interval: 1 })],
    [word('(?:elke|iedere)\\s+jaar|jaarlijks'), () => ({ freq: 'year', interval: 1 })],
  ]
  for (const [re, build] of attempts) {
    const { text: rest, found } = cut(text, re)
    if (found) return { text: rest, rule: build(found) }
  }
  return null
}

/** Eerste dag vanaf vandaag (vandaag telt mee) die bij de herhaling past. */
function firstFittingDay(rule: Recurrence, today: string): string {
  if (rule.freq === 'week' && rule.weekdays?.length) {
    for (let i = 0; i < 7; i++) {
      const day = addDays(today, i)
      if (rule.weekdays.includes(isoWeekday(day))) return day
    }
  }
  return today
}

// Tijd -----------------------------------------------------------------------

function findTime(text: string): { text: string; time: string } | null {
  const attempts: Array<[RegExp, (m: RegExpMatchArray) => [string, string | undefined]]> = [
    // "om 14:00", "om 14.30"
    [word('om\\s+(\\d{1,2})[:.](\\d{2})'), (m) => [m[1], m[2]]],
    // "14:00" zonder "om"
    [new RegExp('(?<![\\p{L}\\p{N}:.])(\\d{1,2}):(\\d{2})(?![\\p{L}\\p{N}:])', 'iu'), (m) => [m[1], m[2]]],
    // "om 14u", "om 14u30", "om 3 uur"
    [word('om\\s+(\\d{1,2})\\s*(?:u|uur)(?:\\s*(\\d{2}))?'), (m) => [m[1], m[2]]],
    // "14u", "14u30"
    [word('(\\d{1,2})u(?:ur)?(\\d{2})?'), (m) => [m[1], m[2]]],
  ]
  for (const [re, parts] of attempts) {
    const { text: rest, found } = cut(text, re)
    if (!found) continue
    const [h, min] = parts(found)
    const hour = Number(h)
    const minute = Number(min ?? 0)
    if (hour > 23 || minute > 59) continue
    return { text: rest, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
  }
  return null
}

// Datum ----------------------------------------------------------------------

function nextWeekday(weekday: number, today: string): string {
  // eerstvolgende, dus vandaag telt niet mee (zelfde keuze als cleanup.py)
  const diff = (weekday - isoWeekday(today) + 7) % 7 || 7
  return addDays(today, diff)
}

function addToDate(today: string, n: number, unit: string): string {
  const freq = unitFreq(unit)
  if (freq === 'day') return addDays(today, n)
  if (freq === 'week') return addDays(today, 7 * n)
  const d = parseISODate(today)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + (freq === 'month' ? n : 12 * n))
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  return toISODate(d)
}

function findDate(text: string, today: string): { text: string; due: string } | null {
  const attempts: Array<[RegExp, (m: RegExpMatchArray) => string | null]> = [
    [word(`${PREP}overmorgen`), () => addDays(today, 2)],
    [word(`${PREP}morgen`), () => addDays(today, 1)],
    [word(`${PREP}vandaag`), () => today],
    [
      // "volgende week vrijdag" = die dag in de week hierna
      word(`${PREP}volgende\\s+week\\s+(${WD})`),
      (m) => {
        const monday = addDays(today, 1 - isoWeekday(today) + 7)
        return addDays(monday, weekdayNumber(m[1]) - 1)
      },
    ],
    [word(`${PREP}volgende\\s+week`), () => addDays(today, 7)],
    [word(`over\\s+(${NUM})\\s+(${UNITS})`), (m) => addToDate(today, toNumber(m[1]) || 0, m[2])],
    [word(`${PREP}(?:volgende\\s+)?(${WD})`), (m) => nextWeekday(weekdayNumber(m[1]), today)],
    [
      // "15 april", "15 apr 2027"
      word(`${PREP}(\\d{1,2})\\s+(${MONTH_RE})(?:\\s+(\\d{4}))?`),
      (m) => {
        const d = Number(m[1])
        const mo = MONTHS[m[2].toLowerCase()]
        if (m[3]) return isValidDate(Number(m[3]), mo, d) ? toISODate(new Date(Number(m[3]), mo - 1, d)) : null
        return dayMonth(d, mo, today)
      },
    ],
    [
      // "15-4", "15-04-2027", "15/4", "15-4-27"; niet midden in een ander getal
      new RegExp(`(?<![\\p{L}\\p{N}\\-/.])${PREP}(\\d{1,2})[-/](\\d{1,2})(?:[-/](\\d{4}|\\d{2}))?(?![\\p{L}\\p{N}]|[-/.]\\d)`, 'iu'),
      (m) => {
        const d = Number(m[1])
        const mo = Number(m[2])
        if (m[3]) {
          const y = fullYear(m[3])
          return isValidDate(y, mo, d) ? toISODate(new Date(y, mo - 1, d)) : null
        }
        return dayMonth(d, mo, today)
      },
    ],
  ]
  for (const [re, calc] of attempts) {
    const { text: rest, found } = cut(text, re)
    if (!found) continue
    const due = calc(found)
    if (due) return { text: rest, due }
  }
  return null
}

// Opschonen ------------------------------------------------------------------

/** Alleen wat door het weghalen is blijven hangen: dubbele spaties, losse komma's of streepjes aan de rand. */
function tidy(text: string): string {
  const t = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:])/g, '$1')
    .trim()
    .replace(/^[\s,;:]+/, '')
    .replace(/[\s,;:]+$/, '')
    .replace(/(^|\s)[-–—]+$/, '')
    .replace(/^[-–—]+(\s|$)/, '')
    .trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Leest een Nederlandse zin als taak: titel, datum, tijd, herhaling en klant.
 * De herkende woorden gaan uit de titel; de klantnaam blijft staan.
 */
export function parseQuickAdd(text: string, projects: Project[], today: string = todayISO()): ParsedTodo {
  const original = text.trim()
  let rest = original

  let recurrence: Recurrence | null = null
  const rec = findRecurrence(rest)
  if (rec) {
    rest = rec.text
    recurrence = rec.rule
  }

  let dueTime: string | null = null
  const time = findTime(rest)
  if (time) {
    rest = time.text
    dueTime = time.time
  }

  let due: string | null = null
  const date = findDate(rest, today)
  if (date) {
    rest = date.text
    due = date.due
  }

  if (recurrence && !due) due = firstFittingDay(recurrence, today)

  const title = tidy(rest)
  const projectId = detectProject(original, projects)
  // Bestond de zin alleen uit datumwoorden ("morgen"), dan is dat zelf de titel.
  if (!title) return { title: tidy(original), due: null, dueTime: null, recurrence: null, projectId }
  return { title, due, dueTime, recurrence, projectId }
}
