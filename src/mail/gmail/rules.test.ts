import { describe, expect, it } from 'vitest'
import { groupRules, parseAddresses, ruleProblem, sameRule, splitForward, toFilter, toRule, toggleAddress, type RuleSpec } from './rules'

describe('toFilter', () => {
  it('zet afzender, onderwerp en bericht om in Gmail-voorwaarden en stuurt door', () => {
    const spec: RuleSpec = { from: ' @klant.nl ', subject: 'factuur', body: 'betaaltermijn', forward: ' collega@onlinedialogue.com ', skipInbox: false }
    expect(toFilter(spec)).toEqual({
      criteria: { from: '@klant.nl', subject: 'factuur', query: 'betaaltermijn' },
      action: { forward: 'collega@onlinedialogue.com' },
    })
  })

  it('laat lege voorwaarden weg en zet "niet in Nieuw" om in INBOX eraf', () => {
    expect(toFilter({ from: '', subject: 'nieuwsbrief', body: '   ', label: 'Label_7', skipInbox: true })).toEqual({
      criteria: { subject: 'nieuwsbrief' },
      action: { addLabelIds: ['Label_7'], removeLabelIds: ['INBOX'] },
    })
  })
})

describe('toRule', () => {
  it('herkent een regel naar een map', () => {
    const rule = toRule({ id: 'a', criteria: { from: '@klant.nl' }, action: { addLabelIds: ['Label_7'], removeLabelIds: ['INBOX'] } })
    expect(rule.simple).toEqual({ from: '@klant.nl', label: 'Label_7', skipInbox: true })
  })

  it('herkent een doorstuurregel met meerdere voorwaarden', () => {
    const rule = toRule({ id: 'b', criteria: { from: 'convert.com', subject: 'A/B Test Live', query: 'wehkamp' }, action: { forward: 'x@klant.nl' } })
    expect(rule.simple).toEqual({ from: 'convert.com', subject: 'A/B Test Live', body: 'wehkamp', forward: 'x@klant.nl', skipInbox: false })
    expect(rule.summary).toContain('doorsturen naar x@klant.nl')
  })

  it('komt heel terug na heen en weer vertalen', () => {
    const specs: RuleSpec[] = [
      { from: 'a@b.nl', forward: 'c@d.nl', skipInbox: true },
      { subject: 'offerte', body: '"exacte zin"', label: 'Label_1', skipInbox: false },
      { body: 'factuur', label: 'Label_2', forward: 'c@d.nl', skipInbox: false },
    ]
    for (const spec of specs) expect(toRule({ id: 'x', ...toFilter(spec) }).simple).toEqual(spec)
  })

  it('laat filters met rust die meer doen dan de app kan beschrijven', () => {
    // andere voorwaarde
    expect(toRule({ id: '1', criteria: { to: 'mij@x.nl' }, action: { forward: 'c@d.nl' } }).simple).toBeNull()
    expect(toRule({ id: '2', criteria: { from: 'a', hasAttachment: true }, action: { forward: 'c@d.nl' } }).simple).toBeNull()
    // andere actie: als gelezen markeren, ster, prullenbak
    expect(toRule({ id: '3', criteria: { from: 'a' }, action: { forward: 'c@d.nl', removeLabelIds: ['UNREAD'] } }).simple).toBeNull()
    expect(toRule({ id: '4', criteria: { from: 'a' }, action: { addLabelIds: ['STARRED'] } }).simple).toBeNull()
    expect(toRule({ id: '5', criteria: { from: 'a' }, action: { addLabelIds: ['Label_1', 'Label_2'] } }).simple).toBeNull()
    // geen voorwaarde of geen actie
    expect(toRule({ id: '6', action: { forward: 'c@d.nl' } }).simple).toBeNull()
    expect(toRule({ id: '7', criteria: { from: 'a' }, action: { removeLabelIds: ['INBOX'] } }).simple).toBeNull()
  })
})

describe('ruleProblem', () => {
  it('vraagt om minstens één voorwaarde', () => {
    expect(ruleProblem({ forward: 'c@d.nl', skipInbox: false })?.field).toBe('from')
    expect(ruleProblem({ from: '  ', subject: '', label: 'Label_1', skipInbox: false })?.field).toBe('from')
  })

  it('vraagt om een map of een geldig adres', () => {
    expect(ruleProblem({ from: 'a', skipInbox: false })?.field).toBe('label')
    expect(ruleProblem({ from: 'a', forward: '', skipInbox: false })?.field).toBe('forward')
    expect(ruleProblem({ from: 'a', forward: 'geen adres', skipInbox: false })?.field).toBe('forward')
    expect(ruleProblem({ from: 'a', forward: 'a@b', skipInbox: false })?.field).toBe('forward')
  })

  it('keurt een volledige regel goed', () => {
    expect(ruleProblem({ body: 'factuur', forward: 'c@d.nl', skipInbox: false })).toBeNull()
    expect(ruleProblem({ subject: 'x', label: 'Label_1', skipInbox: true })).toBeNull()
  })
})

describe('meerdere doorstuuradressen', () => {
  it('leest adressen gescheiden door komma, puntkomma of spatie en haalt dubbele eruit', () => {
    expect(parseAddresses(' a@x.nl, b@y.nl;c@z.nl  A@X.nl ')).toEqual(['a@x.nl', 'b@y.nl', 'c@z.nl'])
    expect(parseAddresses('   ')).toEqual([])
  })

  it('zet een adres erbij en haalt het weer weg', () => {
    expect(toggleAddress('', 'a@x.nl')).toBe('a@x.nl')
    expect(toggleAddress('a@x.nl', 'b@y.nl')).toBe('a@x.nl, b@y.nl')
    expect(toggleAddress('a@x.nl, b@y.nl', 'A@X.nl')).toBe('b@y.nl')
  })

  it('maakt één regel per adres, elk met dezelfde voorwaarden', () => {
    const parts = splitForward({ subject: 'A/B Test Live', forward: 'a@x.nl, b@y.nl', skipInbox: true })
    expect(parts).toEqual([
      { subject: 'A/B Test Live', forward: 'a@x.nl', skipInbox: true },
      { subject: 'A/B Test Live', forward: 'b@y.nl', skipInbox: true },
    ])
    expect(parts.map((p) => toFilter(p).action)).toEqual([
      { removeLabelIds: ['INBOX'], forward: 'a@x.nl' },
      { removeLabelIds: ['INBOX'], forward: 'b@y.nl' },
    ])
    // een regel naar een map blijft één regel
    expect(splitForward({ from: 'a', label: 'Label_1', skipInbox: false })).toHaveLength(1)
  })

  it('keurt een lijst met een fout adres af en noemt welk', () => {
    expect(ruleProblem({ from: 'a', forward: 'a@x.nl, b@y.nl', skipInbox: false })).toBeNull()
    expect(ruleProblem({ from: 'a', forward: 'a@x.nl, geenadres', skipInbox: false })?.message).toContain('geenadres')
    expect(ruleProblem({ from: 'a', forward: ' , ', skipInbox: false })?.field).toBe('forward')
  })

  it('herkent een regel die al bestaat, los van hoofdletters in het adres', () => {
    expect(sameRule({ subject: 'x', forward: 'A@x.nl', skipInbox: false }, { subject: 'x', forward: 'a@X.nl', skipInbox: false })).toBe(true)
    expect(sameRule({ subject: 'x', forward: 'a@x.nl', skipInbox: false }, { subject: 'x', forward: 'b@x.nl', skipInbox: false })).toBe(false)
    expect(sameRule({ subject: 'x', forward: 'a@x.nl', skipInbox: false }, { subject: 'y', forward: 'a@x.nl', skipInbox: false })).toBe(false)
  })

  it('zet doorstuurregels met dezelfde voorwaarden samen op één rij', () => {
    const rows = groupRules([
      toRule({ id: '1', criteria: { subject: 'A/B Test Live' }, action: { forward: 'a@x.nl' } }),
      toRule({ id: '2', criteria: { from: '@nieuwsbrief.nl' }, action: { addLabelIds: ['Label_2'] } }),
      toRule({ id: '3', criteria: { subject: 'A/B Test Live' }, action: { forward: 'b@y.nl' } }),
      toRule({ id: '4', criteria: { subject: 'A/B Test Live' }, action: { forward: 'c@z.nl', removeLabelIds: ['INBOX'] } }),
      toRule({ id: '5', criteria: { from: 'a', hasAttachment: true }, action: { forward: 'a@x.nl' } }),
      toRule({ id: '6', criteria: { from: '@nieuwsbrief.nl' }, action: { addLabelIds: ['Label_2'] } }),
    ])
    expect(rows.map((r) => r.ids)).toEqual([['1', '3'], ['2'], ['4'], ['5'], ['6']])
    expect(rows[0].forwards).toEqual(['a@x.nl', 'b@y.nl'])
    expect(rows[0].simple).toEqual({ subject: 'A/B Test Live', skipInbox: false })
    expect(rows[2].forwards).toEqual(['c@z.nl'])  // "niet in Nieuw" is een andere regel
    expect(rows[3].simple).toBeNull()             // meer dan de app kan beschrijven: blijft apart
    expect(rows[1].forwards).toEqual([])          // twee gelijke map-regels blijven twee rijen
  })
})
