import { describe, expect, it } from 'vitest'
import { detectProject } from './detect'
import type { Project } from '../model/types'

const p = (id: string, keywords: string[]): Project => ({ id, name: id, color: '#000', keywords, order: 0, archived: false })
const projects = [p('transavia', ['transavia']), p('rai', ['rai', 'rai amsterdam']), p('sunny', ['sunny cars', 'sunny'])]

describe('klant herkennen', () => {
  it('vindt de klant in een agenda-titel', () => {
    expect(detectProject('QBR Transavia Q4', projects)).toBe('transavia')
  })
  it('matcht alleen hele woorden', () => {
    expect(detectProject('Team trainen in hypotheses', projects)).toBeNull()
    expect(detectProject('Deck voor RAI maken', projects)).toBe('rai')
  })
  it('geeft null zonder klant', () => {
    expect(detectProject('Uren schrijven', projects)).toBeNull()
  })
})
