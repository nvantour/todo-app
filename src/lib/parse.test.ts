import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from './parse'
import type { Project } from '../model/types'

// Vaste dag: woensdag 18 november 2026.
const TODAY = '2026-11-18'
const p = (id: string, keywords: string[]): Project => ({ id, name: id, color: '#000', keywords, order: 0, archived: false })
const projects = [p('wehkamp', ['wehkamp']), p('rai', ['rai', 'rai amsterdam']), p('sunny', ['sunny cars', 'sunny'])]
const parse = (text: string) => parseQuickAdd(text, projects, TODAY)

describe('datum', () => {
  it('vandaag, morgen en overmorgen', () => {
    expect(parse('Bellen vandaag')).toMatchObject({ title: 'Bellen', due: '2026-11-18' })
    expect(parse('Bellen morgen')).toMatchObject({ title: 'Bellen', due: '2026-11-19' })
    expect(parse('Bellen overmorgen')).toMatchObject({ title: 'Bellen', due: '2026-11-20' })
  })
  it('weekdag: de eerstvolgende, nooit vandaag', () => {
    expect(parse('Deck maken vrijdag').due).toBe('2026-11-20')
    expect(parse('Deck maken woensdag').due).toBe('2026-11-25')
    expect(parse('Deck maken maandag').due).toBe('2026-11-23')
  })
  it('voorzetsel voor de datum gaat mee uit de titel', () => {
    expect(parse('Deck afmaken voor vrijdag')).toMatchObject({ title: 'Deck afmaken', due: '2026-11-20' })
    expect(parse('Offerte sturen op 15 december')).toMatchObject({ title: 'Offerte sturen', due: '2026-12-15' })
  })
  it('volgende week', () => {
    expect(parse('Plannen volgende week')).toMatchObject({ title: 'Plannen', due: '2026-11-25' })
    expect(parse('Plannen volgende week maandag').due).toBe('2026-11-23')
    expect(parse('Plannen volgende week vrijdag').due).toBe('2026-11-27')
  })
  it('over x dagen, weken en maanden (ook in woorden)', () => {
    expect(parse('Opvolgen over 3 dagen')).toMatchObject({ title: 'Opvolgen', due: '2026-11-21' })
    expect(parse('Opvolgen over 2 weken').due).toBe('2026-12-02')
    expect(parse('Opvolgen over een week').due).toBe('2026-11-25')
    expect(parse('Opvolgen over 1 maand').due).toBe('2026-12-18')
  })
  it('dag en maand in woorden', () => {
    expect(parse('QBR 15 april')).toMatchObject({ title: 'QBR', due: '2027-04-15' })
    expect(parse('QBR 15 apr 2028').due).toBe('2028-04-15')
    expect(parse('QBR 2 december').due).toBe('2026-12-02')
  })
  it('een dag die dit jaar al voorbij is, wordt volgend jaar; vandaag blijft vandaag', () => {
    expect(parse('Iets 17 november').due).toBe('2027-11-17')
    expect(parse('Iets 18 november').due).toBe('2026-11-18')
  })
  it('cijferdatums', () => {
    expect(parse('Iets 15-4').due).toBe('2027-04-15')
    expect(parse('Iets 15-04-2027')).toMatchObject({ title: 'Iets', due: '2027-04-15' })
    expect(parse('Iets 3/12').due).toBe('2026-12-03')
    expect(parse('Iets 3-12-27').due).toBe('2027-12-03')
  })
  it('onmogelijke datums worden niet herkend', () => {
    expect(parse('Iets 31 februari')).toMatchObject({ title: 'Iets 31 februari', due: null })
    expect(parse('Iets 32-1')).toMatchObject({ due: null })
  })
  it('laat getallen met streepjes in een code met rust', () => {
    expect(parse('Ticket 2026-11-19 bekijken').due).toBeNull()
    expect(parse('Versie 1.2.3 testen').due).toBeNull()
  })
  it('zonder datum blijft due leeg', () => {
    expect(parse('Uren schrijven')).toMatchObject({ title: 'Uren schrijven', due: null, dueTime: null, recurrence: null })
  })
  it('hele woorden: "morgens" of "overmorgen" worden niet verward', () => {
    expect(parse('Ochtendroutine morgens opzetten').due).toBeNull()
  })
})

describe('tijd', () => {
  it('"om 14:00"', () => {
    expect(parse('Call met Wehkamp morgen om 14:00')).toMatchObject({ title: 'Call met Wehkamp', due: '2026-11-19', dueTime: '14:00' })
  })
  it('"14u", "14u30", "om 9.30", "om 3 uur"', () => {
    expect(parse('Lunch 12u').dueTime).toBe('12:00')
    expect(parse('Lunch morgen 12u30')).toMatchObject({ title: 'Lunch', dueTime: '12:30' })
    expect(parse('Lunch om 9.30').dueTime).toBe('09:30')
    expect(parse('Lunch om 3 uur').dueTime).toBe('03:00')
  })
  it('tijd zonder datum geeft alleen een tijd', () => {
    expect(parse('Bellen om 16:15')).toMatchObject({ title: 'Bellen', due: null, dueTime: '16:15' })
  })
  it('ongeldige tijd wordt genegeerd', () => {
    expect(parse('Iets om 25:00').dueTime).toBeNull()
  })
})

describe('herhaling', () => {
  it('elke dag en dagelijks', () => {
    expect(parse('Inbox leegmaken elke dag')).toMatchObject({
      title: 'Inbox leegmaken',
      recurrence: { freq: 'day', interval: 1 },
      due: '2026-11-18',
    })
    expect(parse('Inbox leegmaken dagelijks').recurrence).toEqual({ freq: 'day', interval: 1 })
  })
  it('elke werkdag: op een weekdag vandaag, in het weekend maandag', () => {
    const r = parse('Uren schrijven elke werkdag om 17:00')
    expect(r).toMatchObject({ title: 'Uren schrijven', dueTime: '17:00', due: '2026-11-18' })
    expect(r.recurrence).toEqual({ freq: 'week', interval: 1, weekdays: [1, 2, 3, 4, 5] })
    expect(parseQuickAdd('Uren schrijven elke werkdag', [], '2026-11-21').due).toBe('2026-11-23') // zaterdag
  })
  it('elke maandag: eerstvolgende passende dag, vandaag telt mee', () => {
    expect(parse('Weekplanning elke maandag')).toMatchObject({
      title: 'Weekplanning',
      due: '2026-11-23',
      recurrence: { freq: 'week', interval: 1, weekdays: [1] },
    })
    expect(parse('Standup elke woensdag').due).toBe('2026-11-18')
  })
  it('meerdere weekdagen', () => {
    const r = parse('Sporten elke maandag en donderdag')
    expect(r.title).toBe('Sporten')
    expect(r.recurrence).toEqual({ freq: 'week', interval: 1, weekdays: [1, 4] })
    expect(r.due).toBe('2026-11-19')
    expect(parse('Sporten elke vrijdag, maandag en woensdag').recurrence?.weekdays).toEqual([1, 3, 5])
  })
  it('elke 2 weken, elke 3 dagen, elke twee maanden', () => {
    expect(parse('Review elke 2 weken')).toMatchObject({ title: 'Review', recurrence: { freq: 'week', interval: 2 }, due: '2026-11-18' })
    expect(parse('Gieten elke 3 dagen').recurrence).toEqual({ freq: 'day', interval: 3 })
    expect(parse('Rapport elke twee maanden').recurrence).toEqual({ freq: 'month', interval: 2 })
  })
  it('wekelijks, maandelijks, elke maand, jaarlijks', () => {
    expect(parse('Back-up wekelijks').recurrence).toEqual({ freq: 'week', interval: 1 })
    expect(parse('Factuur maandelijks').recurrence).toEqual({ freq: 'month', interval: 1 })
    expect(parse('Factuur elke maand').recurrence).toEqual({ freq: 'month', interval: 1 })
    expect(parse('Verzekering jaarlijks').recurrence).toEqual({ freq: 'year', interval: 1 })
  })
  it('een eigen datum wint van de eerstvolgende passende dag', () => {
    expect(parse('Factuur maandelijks vanaf 1 december')).toMatchObject({ due: '2026-12-01', recurrence: { freq: 'month', interval: 1 } })
    expect(parse('Weekplanning elke maandag vanaf overmorgen').due).toBe('2026-11-20')
  })
})

describe('klant en titel', () => {
  it('de klantnaam blijft in de titel staan', () => {
    expect(parse('Wehkamp deck morgen')).toMatchObject({ title: 'Wehkamp deck', projectId: 'wehkamp', due: '2026-11-19' })
    expect(parse('Deck voor RAI Amsterdam vrijdag')).toMatchObject({ title: 'Deck voor RAI Amsterdam', projectId: 'rai' })
  })
  it('geen klant geeft null', () => {
    expect(parse('Uren schrijven').projectId).toBeNull()
  })
  it('streepjes, komma\'s en hoofdletters in de rest blijven staan', () => {
    expect(parse('A/B-test PDP: hypotheses, varianten en QA - morgen')).toMatchObject({
      title: 'A/B-test PDP: hypotheses, varianten en QA',
      due: '2026-11-19',
    })
    expect(parse('review CRO-plan van Sunny Cars, daarna mailen vrijdag').title).toBe('Review CRO-plan van Sunny Cars, daarna mailen')
  })
  it('alleen de eerste letter wordt hoofdletter', () => {
    expect(parse('maak OKR-deck voor Q1 morgen').title).toBe('Maak OKR-deck voor Q1')
  })
  it('een zin die alleen uit een datumwoord bestaat, houdt dat woord als titel', () => {
    expect(parse('morgen')).toMatchObject({ title: 'Morgen', due: null })
  })
  it('lege invoer', () => {
    expect(parse('   ')).toMatchObject({ title: '', due: null })
  })
  it('combinatie van alles', () => {
    expect(parse('Sunny Cars rapport nakijken elke vrijdag om 16u')).toEqual({
      title: 'Sunny Cars rapport nakijken',
      due: '2026-11-20',
      dueTime: '16:00',
      recurrence: { freq: 'week', interval: 1, weekdays: [5] },
      projectId: 'sunny',
    })
  })
})
