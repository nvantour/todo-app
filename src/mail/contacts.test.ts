import { describe, expect, it } from 'vitest'
import { buildContacts, insertContact, matchContacts, tokenAt } from './contacts'

const NOW = Date.parse('2026-11-24T10:00:00Z')
const rows = [
  { from: 'Nino <nino@od.com>', to: 'Eda Yilmaz <eda.yilmaz@klant.nl>, "Bakker, Jan" <jan@klant.nl>', cc: '', date: NOW - 86_400_000, sent: true },
  { from: 'Eduard de Vries <eduard@ander.nl>', to: 'nino@od.com', cc: '', date: NOW - 200 * 86_400_000, sent: false },
  { from: 'Google <no-reply@accounts.google.com>', to: 'nino@od.com', cc: '', date: NOW, sent: false },
]

describe('adressen aanvullen', () => {
  const list = buildContacts(rows, 'nino@od.com', NOW)
  it('bouwt een adresboek zonder jezelf en zonder no-reply', () => {
    expect(list.map((c) => c.email)).toEqual(['eda.yilmaz@klant.nl', 'jan@klant.nl', 'eduard@ander.nl'])
  })
  it('"eda" vindt Eda eerst (gemaild, recent), dan Eduard', () => {
    expect(matchContacts(list, 'ed').map((c) => c.name)).toEqual(['Eda Yilmaz', 'Eduard de Vries'])
    expect(matchContacts(list, 'eda')[0].email).toBe('eda.yilmaz@klant.nl')
    expect(matchContacts(list, 'yil')[0].email).toBe('eda.yilmaz@klant.nl')
    expect(matchContacts(list, 'jan')[0].name).toBe('Bakker, Jan')
  })
  it('vervangt alleen het getypte stuk en zet een komma erachter', () => {
    const eda = list[0]
    expect(insertContact('eda', 3, eda)).toEqual({ value: 'Eda Yilmaz <eda.yilmaz@klant.nl>, ', caret: 34 })
    const v = 'jan@klant.nl, ed'
    expect(insertContact(v, v.length, eda).value).toBe('jan@klant.nl, Eda Yilmaz <eda.yilmaz@klant.nl>, ')
    expect(insertContact('x', 1, list[1]).value).toBe('"Bakker, Jan" <jan@klant.nl>, ')
  })
  it('het stuk na de laatste komma telt, ook na een naam met komma tussen aanhalingstekens', () => {
    expect(tokenAt('"Bakker, Jan" <jan@klant.nl>, ed', 33).text).toBe('ed')
  })
})
