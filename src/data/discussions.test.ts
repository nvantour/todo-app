import { describe, expect, it } from 'vitest'
import type { DiscussionItem } from '../model/types'
import { cleanDiscussionTitle, isHeading, normalizeDiscussion, openItemCount, preparePatch, pruneDoneItems, splitLines, toggleDiscussionItem } from './logic'

const item = (id: string, text: string, done = false, doneAt: string | null = null): DiscussionItem => ({ id, text, done, doneAt })

describe('tussenkopje herkennen', () => {
  it('eindigt op een dubbele punt', () => {
    expect(isHeading('Planning:')).toBe(true)
    expect(isHeading('  AI Feature:  ')).toBe(true)
    expect(isHeading('Planning')).toBe(false)
    expect(isHeading('Eerst: dit en dan dat')).toBe(false)
  })
  it('haalt de dubbele punt uit een groepsnaam', () => {
    expect(cleanDiscussionTitle(' Maxeda: ')).toBe('Maxeda')
  })
})

describe('punt afvinken', () => {
  it('vinkt af met tijdstip en zet terug', () => {
    const done = toggleDiscussionItem([item('a', 'Surveys')], 'a', '2026-11-18T10:00:00.000Z')
    expect(done[0]).toMatchObject({ done: true, doneAt: '2026-11-18T10:00:00.000Z' })
    expect(toggleDiscussionItem(done, 'a')[0]).toMatchObject({ done: false, doneAt: null })
  })
  it('laat tussenkopjes en andere punten met rust', () => {
    const list = [item('h', 'Planning:'), item('a', 'PDP')]
    expect(toggleDiscussionItem(list, 'h')).toEqual(list)
    expect(toggleDiscussionItem(list, 'a')[0]).toEqual(list[0])
  })
  it('telt alleen open punten, geen tussenkopjes', () => {
    const d = normalizeDiscussion('x', { items: [item('h', 'Planning:'), item('a', 'PDP'), item('b', 'Pop-ups', true, 'x')] })
    expect(openItemCount(d)).toBe(1)
  })
})

describe('opruimen na 14 dagen', () => {
  const now = new Date('2026-11-18T12:00:00Z').getTime()
  const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString()
  it('gooit alleen oud afgevinkte punten weg', () => {
    const list = [item('old', 'oud', true, daysAgo(15)), item('new', 'nieuw', true, daysAgo(13)), item('open', 'open')]
    expect(pruneDoneItems(list, now).map((i) => i.id)).toEqual(['new', 'open'])
  })
  it('gebeurt bij het opslaan van de punten', () => {
    const patch = preparePatch({ items: [item('old', 'oud', true, '2000-01-01T00:00:00.000Z'), item('open', 'open')] })
    expect(patch.items?.map((i) => i.id)).toEqual(['open'])
  })
})

describe('tekst splitsen en oude data', () => {
  it('maakt van meerdere regels meerdere punten', () => {
    expect(splitLines('• Surveys\n\n- Prio testen\r\n  Analyse testen ')).toEqual(['Surveys', 'Prio testen', 'Analyse testen'])
  })
  it('vult ontbrekende velden aan', () => {
    const d = normalizeDiscussion('id1', { title: 'Wehkamp' })
    expect(d).toMatchObject({ id: 'id1', title: 'Wehkamp', projectId: null, items: [] })
  })
})
