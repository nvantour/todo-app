import { describe, expect, it } from 'vitest'
import type { DiscussionItem } from '../model/types'
import { cleanDiscussionTitle, isHeading, moveDiscussionItem, normalizeDiscussion, openItemCount, preparePatch, pruneDoneItems, splitLines, stepDiscussionItem, toggleDiscussionItem } from './logic'

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

describe('punten verplaatsen', () => {
  const group = (id: string, items: DiscussionItem[]) => ({ id, title: id, projectId: null, items, order: 0, createdAt: '', updatedAt: '' })
  const ids = (items: DiscussionItem[] | undefined) => items?.map((i) => i.id)
  const a = () => group('A', [item('a1', 'Een'), item('a2', 'Twee'), item('a3', 'Drie')])
  const b = () => group('B', [item('b1', 'Vier')])

  it('herordent binnen een groep', () => {
    expect(ids(moveDiscussionItem([a(), b()], 'a3', 'A', 'a1').A)).toEqual(['a3', 'a1', 'a2'])
    expect(ids(moveDiscussionItem([a(), b()], 'a1', 'A', null).A)).toEqual(['a2', 'a3', 'a1'])
    expect(ids(moveDiscussionItem([a(), b()], 'a1', 'A', 'a3').A)).toEqual(['a2', 'a1', 'a3'])
  })

  it('doet niets als de plek gelijk blijft', () => {
    expect(moveDiscussionItem([a(), b()], 'a1', 'A', 'a2')).toEqual({})
    expect(moveDiscussionItem([a(), b()], 'a1', 'A', 'a1')).toEqual({})
    expect(moveDiscussionItem([a(), b()], 'a3', 'A', null)).toEqual({})
  })

  it('verplaatst naar een andere groep, en terug', () => {
    const out = moveDiscussionItem([a(), b()], 'a2', 'B', 'b1')
    expect(ids(out.A)).toEqual(['a1', 'a3'])
    expect(ids(out.B)).toEqual(['a2', 'b1'])
    const back = moveDiscussionItem([group('A', out.A), group('B', out.B)], 'a2', 'A', null)
    expect(ids(back.A)).toEqual(['a1', 'a3', 'a2'])
    expect(ids(back.B)).toEqual(['b1'])
  })

  it('kan naar een lege groep', () => {
    expect(ids(moveDiscussionItem([a(), group('C', [])], 'a1', 'C', null).C)).toEqual(['a1'])
  })

  it('negeert onbekende punten of groepen', () => {
    expect(moveDiscussionItem([a()], 'x', 'A', null)).toEqual({})
    expect(moveDiscussionItem([a()], 'a1', 'X', null)).toEqual({})
    expect(moveDiscussionItem([a(), b()], 'a1', 'B', 'a2')).toEqual({})
  })

  it('pijltjes slaan afgevinkte punten over', () => {
    const g = group('A', [item('a1', 'Een'), item('d', 'Klaar', true, '2026-11-26'), item('a2', 'Twee')])
    expect(ids(stepDiscussionItem([g], 'A', 'a2', -1).A)).toEqual(['a2', 'a1', 'd'])
    expect(ids(stepDiscussionItem([g], 'A', 'a1', 1).A)).toEqual(['d', 'a2', 'a1'])
    expect(stepDiscussionItem([g], 'A', 'a1', -1)).toEqual({})
    expect(stepDiscussionItem([g], 'A', 'a2', 1)).toEqual({})
  })
})
