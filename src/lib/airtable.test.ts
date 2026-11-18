import { describe, expect, it } from 'vitest'
import { findAirtableUrl, parseAirtableUrl } from './airtable'

const REC = 'rec1234567890abcd'

describe('parseAirtableUrl', () => {
  it('leest base, tabel en record uit een volledige link', () => {
    const r = parseAirtableUrl(`https://airtable.com/appAAAAAAAAAAAAAA/tblBBBBBBBBBBBBBB/viwCCCCCCCCCCCCCC/${REC}?blocks=hide`)
    expect(r).toMatchObject({ baseId: 'appAAAAAAAAAAAAAA', tableId: 'tblBBBBBBBBBBBBBB', recordId: REC })
  })
  it('werkt ook zonder tabel (interface-link)', () => {
    const r = parseAirtableUrl(`https://airtable.com/appAAAAAAAAAAAAAA/pagDDDDDDDDDDDDDD/${REC}`)
    expect(r).toMatchObject({ baseId: 'appAAAAAAAAAAAAAA', tableId: null, recordId: REC })
  })
  it('weigert links zonder record en andere sites', () => {
    expect(parseAirtableUrl('https://airtable.com/appAAAAAAAAAAAAAA/tblBBBBBBBBBBBBBB')).toBeNull()
    expect(parseAirtableUrl(`https://example.com/appAAAAAAAAAAAAAA/${REC}`)).toBeNull()
    expect(parseAirtableUrl('geen link')).toBeNull()
  })
})

describe('findAirtableUrl', () => {
  it('haalt de link uit een zin en laat de rest over', () => {
    const r = findAirtableUrl(`bekijk dit https://airtable.com/appAAAAAAAAAAAAAA/tblBBBBBBBBBBBBBB/${REC} morgen`)
    expect(r?.ref.recordId).toBe(REC)
    expect(r?.rest).toBe('bekijk dit morgen')
  })
  it('geeft null zonder Airtable-link', () => {
    expect(findAirtableUrl('bel piet morgen')).toBeNull()
  })
})
