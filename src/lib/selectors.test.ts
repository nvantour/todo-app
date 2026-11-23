import { describe, expect, it } from 'vitest'
import type { AppData, Discussion, DiscussionItem, Todo } from '../model/types'
import { buildTodo } from '../data/logic'
import { dayGroup, discussionsWithOpenItems, moveToGroup } from './selectors'
import { sourceHref } from './sources'

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
const data = (discussions: Discussion[]): AppData => ({ todos: [], projects: [], labels: [], suggestions: [], calendarRules: [], discussions, statuses: [], replies: [] })

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


// 2026-11-25 is een woensdag; de week begint op maandag 2026-11-23.
const wed = '2026-11-25'
const t = (over: Partial<Todo> = {}): Todo => ({ ...buildTodo({ title: 't' }, 0), ...over })

describe('Vandaag en Deze week', () => {
  it('zonder datum: zelf gekozen; geparkeerd vorige week = weer Vandaag', () => {
    expect(dayGroup(t(), wed)).toBe('today')
    expect(dayGroup(t({ weekOf: '2026-11-23' }), wed)).toBe('week')
    expect(dayGroup(t({ weekOf: '2026-11-16' }), wed)).toBe('today')
    expect(dayGroup(t({ bucket: 'later' }), wed)).toBe('later')
  })
  it('de datum is leidend', () => {
    expect(dayGroup(t({ due: '2026-11-24' }), wed)).toBe('today') // gisteren
    expect(dayGroup(t({ due: wed, weekOf: '2026-11-23' }), wed)).toBe('today')
    expect(dayGroup(t({ due: '2026-11-26' }), wed)).toBe('week') // donderdag
    expect(dayGroup(t({ due: '2026-11-29', bucket: 'later' }), wed)).toBe('week') // zondag
    expect(dayGroup(t({ due: '2026-11-30' }), wed)).toBe('later') // volgende week
  })
  it('slepen zonder datum zet alleen de groep', () => {
    expect(moveToGroup(t(), 'week', wed)).toEqual({ bucket: 'now', weekOf: '2026-11-23' })
    expect(moveToGroup(t({ weekOf: '2026-11-23' }), 'today', wed)).toEqual({ bucket: 'now', weekOf: null })
    expect(moveToGroup(t({ bucket: 'later' }), 'later', wed)).toBeNull()
  })
  it('slepen schuift de datum mee', () => {
    expect(moveToGroup(t({ due: '2026-11-27' }), 'today', wed)).toEqual({ bucket: 'now', weekOf: null, due: wed })
    expect(moveToGroup(t({ due: wed, dueTime: '10:00' }), 'week', wed)).toEqual({ bucket: 'now', weekOf: '2026-11-23', due: null, dueTime: null })
    expect(moveToGroup(t({ due: '2026-11-27' }), 'later', wed)).toEqual({ bucket: 'later', weekOf: null, due: null, dueTime: null })
    expect(moveToGroup(t({ due: '2026-12-02' }), 'week', wed)).toEqual({ bucket: 'now', weekOf: '2026-11-23', due: null, dueTime: null })
  })
  it('een herhalende taak houdt haar datum en blijft staan', () => {
    expect(moveToGroup(t({ due: wed, recurrence: { freq: 'day', interval: 1 } as Todo['recurrence'] }), 'week', wed)).toBeNull()
  })
})

describe('bronlink afleiden', () => {
  it('bestaande link gaat voor', () => {
    expect(sourceHref({ type: 'mail', url: 'https://x.nl', externalId: 'gmail:1a1f7b865a9a444d' })).toBe('https://x.nl')
  })
  it('Gmail-id opent de thread in de Mail-tab', () => {
    expect(sourceHref({ type: 'mail', externalId: 'gmail:1a1f7b865a9a444d' })).toBe('/mail#mail-1a1f7b865a9a444d')
    expect(sourceHref({ type: 'mail', externalId: '1a1fdc59d9b9b2f0' })).toBe('/mail#mail-1a1fdc59d9b9b2f0')
  })
  it('Chat-bericht opent de space; een eigen id blijft tekst', () => {
    expect(sourceHref({ type: 'chat', externalId: 'spaces/AAA/messages/BBB' })).toBe('https://mail.google.com/mail/u/0/#chat/space/AAA')
    expect(sourceHref({ type: 'chat', externalId: 'terug-van-vakantie:transavia' })).toBeUndefined()
  })
})
