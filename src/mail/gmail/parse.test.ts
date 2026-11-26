import { describe, expect, it } from 'vitest'
import { bodyText, type Part } from './parse'

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_')
const part = (bytes: Uint8Array, charset: string): Part => ({
  mimeType: 'text/plain',
  headers: [{ name: 'Content-Type', value: `text/plain; charset="${charset}"` }],
  body: { data: b64url(bytes), size: bytes.length },
})

describe('tekens in de mail', () => {
  it('leest UTF-8 goed, ook als de kopregel iso-8859-1 noemt (Gmail zet de tekst om)', () => {
    expect(bodyText(part(new TextEncoder().encode('Maïté had een vraag'), 'iso-8859-1'))).toBe('Maïté had een vraag')
  })
  it('valt terug op het genoemde tekenset als de bytes geen UTF-8 zijn', () => {
    // "Maïté" in Latin-1: ï = 0xEF, é = 0xE9
    expect(bodyText(part(Uint8Array.from([0x4d, 0x61, 0xef, 0x74, 0xe9]), 'iso-8859-1'))).toBe('Maïté')
  })
})
