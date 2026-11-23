import { describe, expect, it } from 'vitest'
import type { AppData, TaskStatus, Todo } from '../model/types'
import { DEFAULT_STATUSES, addStatus, boardColumns, canDeleteStatus, deleteStatus, moveChanges, moveStatus, renameStatus, statusList, statusOf } from './board'
import { buildTodo } from './logic'

const todo = (over: Partial<Todo> = {}): Todo => ({ ...buildTodo({ title: 't' }, 0), ...over })
const data = (todos: Todo[], statuses: TaskStatus[] = []): AppData => ({ todos, projects: [], labels: [], suggestions: [], calendarRules: [], discussions: [], statuses, replies: [] })
const [todoS, doing, done] = DEFAULT_STATUSES

describe('bord: statussen', () => {
  it('zonder opgeslagen statussen: To do, In progress, Finished', () => {
    expect(statusList(data([])).map((s) => s.name)).toEqual(['To do', 'In progress', 'Finished'])
  })
  it('een kapotte opgeslagen lijst (zonder Finished) valt terug op de standaard', () => {
    expect(statusList(data([], [{ id: 'x', name: 'X', kind: 'open', order: 0 }]))).toBe(DEFAULT_STATUSES)
  })
  it('nieuwe status komt vóór Finished', () => {
    const next = addStatus(DEFAULT_STATUSES, ' Wacht op klant ')!
    expect(next.map((s) => s.name)).toEqual(['To do', 'In progress', 'Wacht op klant', 'Finished'])
    expect(next.map((s) => s.order)).toEqual([0, 1, 2, 3])
    expect(addStatus(DEFAULT_STATUSES, '  ')).toBeNull()
  })
  it('hernoemen negeert een lege naam', () => {
    expect(renameStatus(DEFAULT_STATUSES, 'doing', 'Bezig')[1].name).toBe('Bezig')
    expect(renameStatus(DEFAULT_STATUSES, 'doing', ' ')).toBe(DEFAULT_STATUSES)
  })
  it('Finished en de laatste open status kun je niet verwijderen', () => {
    expect(canDeleteStatus(DEFAULT_STATUSES, 'done')).toBe(false)
    expect(canDeleteStatus(DEFAULT_STATUSES, 'doing')).toBe(true)
    const one = deleteStatus(DEFAULT_STATUSES, 'doing')
    expect(one.map((s) => s.id)).toEqual(['todo', 'done'])
    expect(canDeleteStatus(one, 'todo')).toBe(false)
  })
  it('verplaatsen houdt Finished achteraan', () => {
    expect(moveStatus(DEFAULT_STATUSES, 'doing', -1).map((s) => s.id)).toEqual(['doing', 'todo', 'done'])
    expect(moveStatus(DEFAULT_STATUSES, 'doing', 1)).toBe(DEFAULT_STATUSES)
  })
})

describe('bord: waar staat een taak', () => {
  it('geen of onbekende status = To do; afgevinkt = Finished', () => {
    expect(statusOf(todo(), DEFAULT_STATUSES)).toBe('todo')
    expect(statusOf(todo({ statusId: 'weg' }), DEFAULT_STATUSES)).toBe('todo')
    expect(statusOf(todo({ statusId: 'doing' }), DEFAULT_STATUSES)).toBe('doing')
    expect(statusOf(todo({ statusId: 'doing', done: true }), DEFAULT_STATUSES)).toBe('done')
  })
  it('een taak in een verwijderde status valt terug naar de eerste open status', () => {
    const list = deleteStatus(addStatus(DEFAULT_STATUSES, 'Wacht')!, addStatus(DEFAULT_STATUSES, 'Wacht')![2].id)
    expect(statusOf(todo({ statusId: 'onbekend' }), list)).toBe('todo')
  })
  it('Finished toont alleen de laatste 14 dagen', () => {
    const cols = boardColumns(
      data([todo({ title: 'oud', done: true, completedAt: '2026-10-01T10:00:00Z' }), todo({ title: 'net', done: true, completedAt: '2026-11-21T10:00:00Z' }), todo({ title: 'open' })]),
      '2026-11-22',
    )
    expect(cols.find((c) => c.status.id === 'done')!.todos.map((t) => t.title)).toEqual(['net'])
    expect(cols.find((c) => c.status.id === 'todo')!.todos.map((t) => t.title)).toEqual(['open'])
  })
})

describe('bord: verplaatsen', () => {
  it('naar Finished = afvinken via toggle', () => {
    expect(moveChanges(todo(), done)).toEqual({ toggle: true, patch: {} })
    expect(moveChanges(todo({ done: true }), done)).toEqual({ toggle: false, patch: {} })
  })
  it('naar een open kolom: status zetten, afgevinkte taak weer open', () => {
    expect(moveChanges(todo(), doing)).toEqual({ toggle: false, patch: { statusId: 'doing' } })
    expect(moveChanges(todo({ done: true, completedAt: 'x' }), todoS)).toEqual({ toggle: false, patch: { statusId: 'todo', done: false, completedAt: null } })
  })
})
