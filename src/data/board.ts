import type { AppData, TaskStatus, Todo } from '../model/types'
import { addDays, todayISO } from '../lib/dates'
import { newId } from './logic'

// Het bord bij Taken: kolommen (statussen) en waar een taak staat.
// Afgevinkt hangt aan de ene 'done'-status, zodat lijst en bord nooit uit de pas lopen.

/** Vaste id's, zodat taken ernaar kunnen verwijzen voordat de statussen zijn opgeslagen. */
export const DEFAULT_STATUSES: TaskStatus[] = [
  { id: 'todo', name: 'To do', kind: 'open', order: 0 },
  { id: 'doing', name: 'In progress', kind: 'open', order: 1 },
  { id: 'done', name: 'Finished', kind: 'done', order: 2 },
]

/** Hoeveel dagen afgevinkte taken in de Finished-kolom blijven staan. */
export const FINISHED_DAYS = 14

/** De statussen in volgorde; zonder opgeslagen statussen de standaard. Altijd precies één 'done'. */
export function statusList(data: Pick<AppData, 'statuses'>): TaskStatus[] {
  const saved = [...(data.statuses ?? [])].sort((a, b) => a.order - b.order)
  if (!saved.length || !saved.some((s) => s.kind === 'done') || !saved.some((s) => s.kind === 'open')) return DEFAULT_STATUSES
  return saved
}

export const doneStatus = (list: TaskStatus[]) => list.find((s) => s.kind === 'done')!
export const firstOpen = (list: TaskStatus[]) => list.find((s) => s.kind === 'open')!

/** In welke kolom een taak staat. */
export function statusOf(todo: Todo, list: TaskStatus[]): string {
  if (todo.done) return doneStatus(list).id
  const own = list.find((s) => s.id === todo.statusId)
  return own && own.kind === 'open' ? own.id : firstOpen(list).id
}

const byDueThenOrder = (a: Todo, b: Todo) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.order - b.order

/** Kolommen met hun taken: alle open taken, plus wat de laatste FINISHED_DAYS dagen is afgevinkt. */
export function boardColumns(data: AppData, today = todayISO()): { status: TaskStatus; todos: Todo[] }[] {
  const list = statusList(data)
  const limit = addDays(today, -FINISHED_DAYS)
  const visible = data.todos.filter((t) => !t.done || (t.completedAt !== null && t.completedAt.slice(0, 10) >= limit))
  return list.map((status) => {
    const todos = visible.filter((t) => statusOf(t, list) === status.id)
    todos.sort(status.kind === 'done' ? (a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') : byDueThenOrder)
    return { status, todos }
  })
}

/**
 * Wat er verandert als je een taak naar een kolom zet.
 * - naar 'done': afvinken (via toggle, zodat een terugkerende taak doorschuift)
 * - naar een open kolom: die status, en een afgevinkte taak gaat weer open
 */
export function moveChanges(todo: Todo, target: TaskStatus): { toggle: boolean; patch: Partial<Todo> } {
  if (target.kind === 'done') return { toggle: !todo.done, patch: {} }
  return { toggle: false, patch: { statusId: target.id, ...(todo.done ? { done: false, completedAt: null } : {}) } }
}

/** Nieuwe status vóór Finished. Lege naam = niets. */
export function addStatus(list: TaskStatus[], name: string): TaskStatus[] | null {
  const clean = name.trim()
  if (!clean) return null
  const open = list.filter((s) => s.kind === 'open')
  const done = doneStatus(list)
  const added: TaskStatus = { id: newId(), name: clean, kind: 'open', order: 0 }
  return [...open, added, done].map((s, i) => ({ ...s, order: i }))
}

export function renameStatus(list: TaskStatus[], id: string, name: string): TaskStatus[] {
  const clean = name.trim()
  return clean ? list.map((s) => (s.id === id ? { ...s, name: clean } : s)) : list
}

/** Verwijderen kan niet voor Finished en niet voor de laatste open status. Taken vallen terug naar de eerste open status. */
export function canDeleteStatus(list: TaskStatus[], id: string): boolean {
  const s = list.find((x) => x.id === id)
  return !!s && s.kind === 'open' && list.filter((x) => x.kind === 'open').length > 1
}

export function deleteStatus(list: TaskStatus[], id: string): TaskStatus[] {
  if (!canDeleteStatus(list, id)) return list
  return list.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i }))
}

/** Een open status een plek naar links (-1) of rechts (+1); Finished blijft achteraan. */
export function moveStatus(list: TaskStatus[], id: string, delta: -1 | 1): TaskStatus[] {
  const open = list.filter((s) => s.kind === 'open')
  const i = open.findIndex((s) => s.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= open.length) return list
  ;[open[i], open[j]] = [open[j], open[i]]
  return [...open, doneStatus(list)].map((s, k) => ({ ...s, order: k }))
}

export function normalizeStatus(id: string, raw: Record<string, unknown>): TaskStatus {
  return {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Status',
    kind: raw.kind === 'done' ? 'done' : 'open',
    order: typeof raw.order === 'number' ? raw.order : 0,
  }
}
