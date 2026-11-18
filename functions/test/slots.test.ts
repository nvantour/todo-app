import { describe, expect, it } from 'vitest'
import { amsterdamTime, busyFromEvents, findFreeSlot } from '../src/slots'
import { timed } from './sources.helpers'

// woensdag 18 november 2026, 11:00 in Nederland (wintertijd, UTC+1)
const NOW = new Date('2026-11-18T10:00:00Z')
const at = (day: string, hm: string) => amsterdamTime(day, Number(hm.slice(0, 2)), Number(hm.slice(3)))
const iv = (day: string, a: string, b: string) => ({ start: at(day, a), end: at(day, b) })
const hm = (d: Date) => new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)

describe('amsterdamTime', () => {
  it('kent winter- en zomertijd', () => {
    expect(new Date(at('2026-11-18', '09:00')).toISOString()).toBe('2026-11-18T08:00:00.000Z')
    expect(new Date(at('2026-07-15', '09:00')).toISOString()).toBe('2026-07-15T07:00:00.000Z')
    expect(new Date(at('2026-03-29', '09:00')).toISOString()).toBe('2026-03-29T07:00:00.000Z') // net na de omschakeling
  })
})

describe('vrije blokken zoeken', () => {
  it('begint vandaag na nu, afgerond op een kwartier', () => {
    const s = findFreeSlot([], new Date('2026-11-18T10:07:00Z'), 60)!
    expect(hm(s.start)).toBe('11:15')
    expect(hm(s.end)).toBe('12:15')
    expect(s.day).toBe('2026-11-18')
  })

  it('springt over drukke tijden heen', () => {
    const s = findFreeSlot([iv('2026-11-18', '11:00', '12:30'), iv('2026-11-18', '12:45', '13:30')], NOW, 60)!
    expect(hm(s.start)).toBe('13:30')
  })

  it('past in een gat dat net groot genoeg is', () => {
    const s = findFreeSlot([iv('2026-11-18', '11:00', '12:00'), iv('2026-11-18', '13:00', '17:30')], NOW, 60)!
    expect(hm(s.start)).toBe('12:00')
    expect(hm(s.end)).toBe('13:00')
  })

  it('gaat naar de volgende werkdag als vandaag vol zit en slaat het weekend over', () => {
    const friday = new Date('2026-11-20T10:00:00Z')
    const s = findFreeSlot([iv('2026-11-20', '11:00', '17:30')], friday, 30)!
    expect(s.day).toBe('2026-11-23') // maandag
    expect(hm(s.start)).toBe('09:00')
  })

  it('begint op een zaterdag pas maandag', () => {
    const s = findFreeSlot([], new Date('2026-11-21T10:00:00Z'), 30)!
    expect(s.day).toBe('2026-11-23')
  })

  it('geeft null als er in de komende dagen niets past', () => {
    expect(findFreeSlot([iv('2026-11-18', '00:00', '23:59')], new Date('2026-11-18T10:00:00Z'), 600, 0)).toBeNull()
  })

  it('een blok dat niet meer voor 17:30 past, schuift naar morgen', () => {
    const s = findFreeSlot([], new Date('2026-11-18T16:00:00Z'), 60)! // 17:00 in Nederland
    expect(s.day).toBe('2026-11-19')
  })
})

describe('bezet uit de agenda', () => {
  it('telt afspraken met tijd, niet de geannuleerde, geweigerde of vrije', () => {
    const busy = busyFromEvents([
      timed('a', 'Overleg', '2026-11-18T13:00:00+01:00'),
      timed('b', 'Geannuleerd', '2026-11-18T14:00:00+01:00', { status: 'cancelled' }),
      timed('c', 'Geweigerd', '2026-11-18T15:00:00+01:00', { attendees: [{ self: true, responseStatus: 'declined' }] }),
      timed('d', 'Vrij', '2026-11-18T16:00:00+01:00', { transparency: 'transparent' }),
      { id: 'e', summary: 'Verjaardag', start: { date: '2026-11-18' }, end: { date: '2026-11-19' } },
      { id: 'f', summary: 'Vrij genomen', eventType: 'outOfOffice', start: { date: '2026-11-19' }, end: { date: '2026-11-20' } },
    ])
    expect(busy).toHaveLength(2)
    expect(new Date(busy[0].start).toISOString()).toBe('2026-11-18T12:00:00.000Z')
    expect(findFreeSlot(busy, new Date('2026-11-19T08:00:00Z'), 60)!.day).toBe('2026-11-20') // 19 november is vrij genomen
  })
})
