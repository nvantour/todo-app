import { describe, expect, it } from 'vitest'
import type { AppData, Discussion, DiscussionItem } from '../model/types'
import { discussionsWithOpenItems } from './selectors'

const item = (id: string, text: string, done = false): DiscussionItem => ({ id, text, done, doneAt: done ? '2026-11-22T09:00:00.000Z' : null })
const group = (id: string, order: number, items: DiscussionItem[]): Discussion => ({
  id,
  title: id,
  projectId: null,
  items,
  order,
  createdAt: '2026-11-22T09:00:00.000Z',
  updatedAt: '2026-11-22T09:00:00.000Z',
})
const data = (discussions: Discussion[]): AppData => ({ todos: [], projects: [], labels: [], suggestions: [], calendarRules: [], discussions })

describe('bespreekgroepen voor Vandaag', () => {
  it('toont alleen groepen met open punten, in eigen volgorde', () => {
    const result = discussionsWithOpenItems(
      data([
        group('Wehkamp', 2, [item('a', 'Planning'), item('b', 'Designs', true)]),
        group('Leeg', 0, [item('c', 'Klaar', true)]),
        group('Team', 1, [item('d', 'Agenda:'), item('e', 'Q1'), item('f', 'Budget')]),
      ]),
    )
    expect(result.map((r) => [r.discussion.id, r.open])).toEqual([
      ['Team', 2],
      ['Wehkamp', 1],
    ])
  })
  it('telt een groep met alleen een kopje niet mee', () => {
    expect(discussionsWithOpenItems(data([group('Kop', 0, [item('a', 'Later:')])]))).toEqual([])
  })
})
