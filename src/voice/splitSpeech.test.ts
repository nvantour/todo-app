import { describe, expect, it } from 'vitest'
import { splitSpeech } from './splitSpeech'

describe('splitSpeech', () => {
  it('splitst op "en" met een datumwoord erna', () => {
    expect(splitSpeech('bel de developer van Keesing en morgen het deck voor Wehkamp afmaken')).toEqual([
      'Bel de developer van Keesing',
      'Morgen het deck voor Wehkamp afmaken',
    ])
  })

  it('splitst op "en" als er minstens drie woorden volgen', () => {
    expect(splitSpeech('mail de klant terug en offerte voor Maxeda aanpassen')).toEqual([
      'Mail de klant terug',
      'Offerte voor Maxeda aanpassen',
    ])
  })

  it('laat "en" tussen twee namen met rust', () => {
    expect(splitSpeech('mail Wehkamp en Keesing')).toEqual(['Mail Wehkamp en Keesing'])
    expect(splitSpeech('uren schrijven en versturen')).toEqual(['Uren schrijven en versturen'])
  })

  it('splitst op komma, puntkomma en punt', () => {
    expect(splitSpeech('deck maken voor Wehkamp, uren invullen voor Keesing; factuur Mantel versturen')).toEqual([
      'Deck maken voor Wehkamp',
      'Uren invullen voor Keesing',
      'Factuur Mantel versturen',
    ])
    expect(splitSpeech('Bel Jan terug. Mail de agenda rond.')).toEqual(['Bel Jan terug', 'Mail de agenda rond'])
  })

  it('splitst op "daarnaast" en "verder"', () => {
    expect(splitSpeech('rapport nakijken daarnaast presentatie oefenen')).toEqual(['Rapport nakijken', 'Presentatie oefenen'])
  })

  it('splitst een opsomming met cijfers', () => {
    expect(splitSpeech('1. offerte sturen 2. deck afmaken')).toEqual(['Offerte sturen', 'Deck afmaken'])
  })

  it('geeft een lege lijst bij stilte', () => {
    expect(splitSpeech('')).toEqual([])
    expect(splitSpeech('   ')).toEqual([])
  })

  it('houdt een korte losse taak heel', () => {
    expect(splitSpeech('deck afmaken')).toEqual(['Deck afmaken'])
  })
})
