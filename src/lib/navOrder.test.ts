import { describe, expect, it } from 'vitest'
import { NAV_IDS, moveBy, moveTo, normalizeOrder, type NavId } from './navOrder'

describe('menuvolgorde', () => {
  it('valt terug op de standaard bij niets of rommel', () => {
    expect(normalizeOrder(null)).toEqual([...NAV_IDS])
    expect(normalizeOrder('kapot')).toEqual([...NAV_IDS])
  })
  it('houdt de eigen volgorde, laat onbekende en dubbele weg en zet nieuwe achteraan', () => {
    expect(normalizeOrder(['mail', 'oud', 'vandaag', 'mail'])).toEqual(['mail', 'vandaag', 'taken', 'bespreken', 'voorstellen', 'meetings', 'antwoorden', 'klanten'])
  })
  it('slepen naar beneden zet het item achter het doel', () => {
    const order: NavId[] = ['vandaag', 'taken', 'bespreken', 'meetings']
    expect(moveTo(order, 'vandaag', 'bespreken')).toEqual(['taken', 'bespreken', 'vandaag', 'meetings'])
  })
  it('slepen naar boven zet het item voor het doel', () => {
    const order: NavId[] = ['vandaag', 'taken', 'bespreken', 'meetings']
    expect(moveTo(order, 'meetings', 'taken')).toEqual(['vandaag', 'meetings', 'taken', 'bespreken'])
    expect(moveTo(order, 'taken', 'taken')).toBe(order)
  })
  it('een plek omhoog of omlaag, niet voorbij de rand', () => {
    const order: NavId[] = ['vandaag', 'taken', 'mail']
    expect(moveBy(order, 'taken', -1)).toEqual(['taken', 'vandaag', 'mail'])
    expect(moveBy(order, 'mail', 1)).toBe(order)
    expect(moveBy(order, 'vandaag', -1)).toBe(order)
  })
})
