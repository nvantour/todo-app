import { describe, expect, it } from 'vitest'
import { addDays, describeRecurrence, formatDue, isoWeekday, nextOccurrence } from './dates'

describe('datums', () => {
  it('telt dagen op over een maandgrens', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
  })
  it('kent de weekdag (1 = maandag)', () => {
    expect(isoWeekday('2026-11-18')).toBe(3) // woensdag
    expect(isoWeekday('2026-11-22')).toBe(7) // zondag
  })
  it('toont vandaag, morgen en een weekdag', () => {
    expect(formatDue('2026-11-18', '2026-11-18')).toBe('Vandaag')
    expect(formatDue('2026-11-19', '2026-11-18')).toBe('Morgen')
    expect(formatDue('2026-11-20', '2026-11-18')).toBe('Vrijdag')
  })
})

describe('herhaling', () => {
  const today = '2026-11-18'
  it('dagelijks schuift één dag door', () => {
    expect(nextOccurrence('2026-11-18', { freq: 'day', interval: 1 }, today)).toBe('2026-11-19')
  })
  it('een gemiste herhaling stapelt niet op', () => {
    expect(nextOccurrence('2026-11-02', { freq: 'week', interval: 1 }, today)).toBe('2026-11-23')
  })
  it('wekelijks op meerdere dagen pakt de eerstvolgende', () => {
    const rule = { freq: 'week' as const, interval: 1, weekdays: [1, 4] }
    expect(nextOccurrence('2026-11-16', rule, '2026-11-16')).toBe('2026-11-19')
    expect(nextOccurrence('2026-11-19', rule, '2026-11-19')).toBe('2026-11-23')
  })
  it('maandelijks op de 31e valt terug op de laatste dag', () => {
    expect(nextOccurrence('2027-01-31', { freq: 'month', interval: 1 }, '2027-01-31')).toBe('2027-02-28')
  })
  it('beschrijft de regel in gewone taal', () => {
    expect(describeRecurrence({ freq: 'week', interval: 1, weekdays: [1, 2, 3, 4, 5] })).toBe('Elke werkdag')
    expect(describeRecurrence({ freq: 'month', interval: 3 })).toBe('Elke 3 maanden')
  })
})

describe('werkdagen terugrekenen', () => {
  it('slaat het weekend over', async () => {
    const { subtractWorkdays } = await import('./dates')
    expect(subtractWorkdays('2026-11-23', 3)).toBe('2026-11-18') // maandag -> woensdag ervoor
    expect(subtractWorkdays('2026-11-25', 3)).toBe('2026-11-20') // woensdag -> vrijdag
    expect(subtractWorkdays('2026-11-23', 0)).toBe('2026-11-23')
  })
  it('begint op vrijdag als de afspraak in het weekend valt', async () => {
    const { subtractWorkdays } = await import('./dates')
    expect(subtractWorkdays('2026-11-22', 0)).toBe('2026-11-20') // zondag
    expect(subtractWorkdays('2026-11-21', 1)).toBe('2026-11-19') // zaterdag, 1 werkdag terug vanaf vrijdag
  })
})
