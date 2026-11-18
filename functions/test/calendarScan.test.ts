import { describe, expect, it } from 'vitest'
import { applyRules } from '../src/rules'
import { ensureDefaultRules, DEFAULT_RULE } from '../src/rules'
import { judgeable, planCandidates, prepDue, runCalendarScan, toScanEvents, type PrepJudge } from '../src/calendarScan'
import { TODAY, UID, projects } from './helpers'
import { scanSetup, timed } from './sources.helpers'

const rule = (over: Partial<typeof DEFAULT_RULE> = {}) => ({ ...DEFAULT_RULE, ...over })

describe('regels toepassen', () => {
  it('rekent werkdagen terug over een weekend', () => {
    // maandag 30 november, 3 werkdagen ervoor = woensdag 25 november
    const [hit] = applyRules([rule()], 'QBR Wehkamp', '2026-11-30', TODAY)
    expect(hit.due).toBe('2026-11-25')
    expect(hit.title).toBe('QBR Wehkamp voorbereiden')
  })
  it('begint vandaag als de afspraak dichterbij is dan de regel vraagt', () => {
    expect(applyRules([rule()], 'qbr intern', '2026-11-19', TODAY)[0].due).toBe(TODAY)
  })
  it('negeert uitgezette regels, lege woorden en afspraken zonder het woord', () => {
    expect(applyRules([rule({ enabled: false })], 'QBR', '2026-11-30', TODAY)).toEqual([])
    expect(applyRules([rule({ match: '  ' })], 'QBR', '2026-11-30', TODAY)).toEqual([])
    expect(applyRules([rule()], 'Weekly', '2026-11-30', TODAY)).toEqual([])
  })
  it('vult {titel} in het sjabloon in', () => {
    const [hit] = applyRules([rule({ titleTemplate: 'Slides voor {titel} maken' })], 'QBR Keesing', '2026-12-01', TODAY)
    expect(hit.title).toBe('Slides voor QBR Keesing maken')
  })
  it('prepDue gaat nooit voor vandaag', () => {
    expect(prepDue('2026-11-19', 2, TODAY)).toBe(TODAY)
    expect(prepDue('2026-11-30', 1, TODAY)).toBe('2026-11-27')
  })
})

describe('afspraken filteren', () => {
  it('slaat geannuleerde, geweigerde en andere soorten over; houdt terugkerende vast', () => {
    const events = toScanEvents(
      [
        timed('ok', 'QBR Wehkamp', '2026-11-30T09:00:00+01:00'),
        timed('geannuleerd', 'QBR oud', '2026-11-30T09:00:00+01:00', { status: 'cancelled' }),
        timed('geweigerd', 'QBR geweigerd', '2026-11-30T09:00:00+01:00', { attendees: [{ email: 'nino@onlinedialogue.com', self: true, responseStatus: 'declined' }] }),
        timed('afwezig', 'Vakantie', '2026-11-30T09:00:00+01:00', { eventType: 'outOfOffice' }),
        timed('herhaald', 'QBR reeks', '2026-11-30T09:00:00+01:00', { recurringEventId: 'serie' }),
        { id: 'zonder-titel', start: { date: '2026-11-30' } },
        { id: 'hele-dag', summary: 'QBR dag', start: { date: '2026-12-01' } },
      ],
      'onlinedialogue.com',
    )
    expect(events.map((e) => e.id)).toEqual(['ok', 'herhaald', 'hele-dag'])
    expect(events[1].recurring).toBe(true)
    expect(events[2].time).toBeNull()
  })
  it('zet de dag om naar Amsterdam en laat de eigen domeinen buiten de klantherkenning', () => {
    const [e] = toScanEvents(
      [timed('a', 'Overleg', '2026-11-30T23:30:00Z', { attendees: [{ email: 'piet@keesing.com' }, { email: 'collega@onlinedialogue.com' }, { email: 'zaal@resource', resource: true }] })],
      'onlinedialogue.com',
    )
    expect(e.day).toBe('2026-12-01') // 00:30 in Nederland
    expect(e.externalEmails).toEqual(['piet@keesing.com'])
    expect(e.attendeeCount).toBe(2)
  })
})

describe('plannen en Haiku-advies', () => {
  const ev = (id: string, title: string, over = {}) => ({ id, title, day: '2026-12-01', time: '10:00', recurring: false, free: false, externalEmails: [], attendeeCount: 2, ...over })

  it('laat Haiku alleen kijken naar eenmalige afspraken die geen regel raken', () => {
    const list = [ev('a', 'QBR Wehkamp'), ev('b', 'Workshop'), ev('c', 'Weekly', { recurring: true }), ev('d', 'Lunch', { free: true })]
    expect(judgeable(list, [rule()], TODAY).map((e) => e.id)).toEqual(['b'])
  })

  it('maakt kandidaten uit regels en advies, en negeert advies voor onbekende afspraken', () => {
    const list = [ev('a', 'QBR Wehkamp'), ev('b', 'Workshop Keesing', { externalEmails: ['piet@keesing.com'] })]
    const cands = planCandidates({
      events: list,
      rules: [rule()],
      projects,
      today: TODAY,
      advice: [
        { id: 'b', title: 'Workshop voorbereiden', workdaysBefore: 2, reason: 'Hij geeft de workshop.' },
        { id: 'a', title: 'Dubbel', workdaysBefore: 1, reason: 'x' }, // a heeft al een regel
        { id: 'weg', title: 'Onbekend', workdaysBefore: 1, reason: 'x' },
      ],
    })
    expect(cands.map((c) => [c.externalId, c.title, c.due, c.projectId])).toEqual([
      ['a', 'QBR Wehkamp voorbereiden', '2026-11-26', 'wehkamp'],
      ['b', 'Workshop voorbereiden', '2026-11-27', 'keesing'],
    ])
    expect(cands[1].reason).toMatch(/Claude denkt/)
  })

  it('geeft twee regels op één afspraak elk een eigen sleutel', () => {
    const cands = planCandidates({
      events: [ev('a', 'QBR Wehkamp')],
      rules: [rule(), rule({ id: 'x', match: 'wehkamp', titleTemplate: 'Cijfers ophalen' })],
      projects,
      today: TODAY,
      advice: [],
    })
    expect(cands.map((c) => c.externalId)).toEqual(['a', 'a#x'])
  })
})

describe('runCalendarScan', () => {
  const events = () => [
    timed('e1', 'QBR Wehkamp', '2026-11-30T10:00:00+01:00', { attendees: [{ email: 'piet@wehkamp.nl' }] }),
    timed('e2', 'Workshop Keesing', '2026-12-02T10:00:00+01:00', { attendees: [{ email: 'anna@keesing.com' }] }),
    timed('e3', 'Lunch', '2026-12-02T12:00:00+01:00'),
    timed('e4', 'QBR te ver weg', '2027-03-01T10:00:00+01:00'),
  ]
  const judge: PrepJudge = async (list) => list.filter((e) => e.id === 'e2').map((e) => ({ id: e.id, title: 'Workshop voorbereiden', workdaysBefore: 2, reason: 'Hij geeft hem.' }))

  it('maakt voorstellen (nooit taken) met bron, en ontdubbelt bij herhaald scannen', async () => {
    const ctx = scanSetup({ events: events() })
    const deps = { repo: ctx.repo, service: ctx.service, google: ctx.google, ai: judge }
    const first = await runCalendarScan(deps, UID)
    expect(first).toMatchObject({ found: 2, created: 2 })
    const second = await runCalendarScan(deps, UID)
    expect(second).toMatchObject({ found: 2, created: 0, duplicates: 2 })

    const sug = await ctx.repo.listSuggestions(UID)
    expect(sug).toHaveLength(2)
    expect(await ctx.repo.listTodos(UID)).toHaveLength(0)
    const qbr = sug.find((s) => s.source.externalId === 'e1')!
    expect(qbr).toMatchObject({ title: 'QBR Wehkamp voorbereiden', due: '2026-11-25', projectId: 'wehkamp', status: 'open' })
    expect(qbr.source).toMatchObject({ type: 'calendar', label: 'QBR Wehkamp · 30 nov', url: 'https://calendar.google.com/event?eid=e1' })
    expect(sug.find((s) => s.source.externalId === 'e2')).toMatchObject({ title: 'Workshop voorbereiden', due: '2026-11-30', projectId: 'keesing' })
    expect((await ctx.repo.getState(UID)).lastCalendarScan).toMatchObject({ found: 2, created: 0 })
  })

  it('een afgewezen voorstel komt bij de volgende scan niet terug', async () => {
    const ctx = scanSetup({ events: events() })
    const deps = { repo: ctx.repo, service: ctx.service, google: ctx.google, ai: null }
    await runCalendarScan(deps, UID)
    const [s] = await ctx.repo.listSuggestions(UID)
    await ctx.repo.saveSuggestion(UID, { ...s, status: 'dismissed' })
    expect((await runCalendarScan(deps, UID)).created).toBe(0)
  })

  it('werkt met alleen regels als Haiku een fout geeft', async () => {
    const ctx = scanSetup({ events: events() })
    const errors: unknown[] = []
    const r = await runCalendarScan({ repo: ctx.repo, service: ctx.service, google: ctx.google, ai: async () => { throw new Error('stuk') }, onError: (e) => errors.push(e) }, UID)
    expect(r.created).toBe(1)
    expect(errors).toHaveLength(1)
  })

  it('weigert zonder agenda-toestemming en onthoudt de fout', async () => {
    const ctx = scanSetup({ events: events(), scopes: [] })
    await expect(runCalendarScan({ repo: ctx.repo, service: ctx.service, google: ctx.google, ai: null }, UID)).rejects.toMatchObject({ code: 'google_scope_missing' })
    expect((await ctx.repo.getState(UID)).lastCalendarScan?.error).toMatch(/toestemming/)
  })

  it('maakt de standaardregel één keer aan en respecteert een lege lijst daarna', async () => {
    const ctx = scanSetup({ events: [] })
    await ensureDefaultRules(ctx.repo, UID)
    expect((await ctx.repo.listCalendarRules(UID)).map((r) => r.match)).toEqual(['QBR'])
    ctx.repo.rules.set(UID, []) // de gebruiker verwijdert hem
    await ensureDefaultRules(ctx.repo, UID)
    expect(await ctx.repo.listCalendarRules(UID)).toEqual([])
  })
})
