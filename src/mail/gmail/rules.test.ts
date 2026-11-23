import { describe, expect, it } from 'vitest'
import { ruleProblem, toFilter, toRule, type RuleSpec } from './rules'

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
