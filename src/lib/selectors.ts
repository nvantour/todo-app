import type { AppData, Bucket, Discussion, Todo } from '../model/types'
import { openItemCount } from '../data/logic'
import { addDays, todayISO, weekEnd, weekStart } from './dates'

/** Eerst op datum (zonder datum achteraan), daarna op eigen volgorde. */
const byDueThenOrder = (a: Todo, b: Todo) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.order - b.order

export function openTodos(data: AppData): Todo[] {
  return data.todos.filter((t) => !t.done)
}

/**
 * Waar een taak getoond wordt. Een taak "om niet te vergeten" waarvan de
 * datum is aangebroken, schuift vanzelf naar "om nu te doen".
 */
export function effectiveBucket(todo: Todo, today = todayISO()): Bucket {
  return todo.bucket === 'now' || (todo.due !== null && todo.due <= today) ? 'now' : 'later'
}

/** De drie groepen op Vandaag en Taken. */
export type DayGroup = 'today' | 'week' | 'later'

/**
 * In welke groep een open taak staat. De datum is leidend: vandaag of eerder = Vandaag,
 * later deze week (t/m zondag) = Deze week, daarna = Om niet te vergeten (schuift vanzelf op als de dag komt).
 * Zonder datum: wat je zelf koos; "Deze week" geldt alleen in de week waarin je de taak daar neerzette.
 */
export function dayGroup(todo: Todo, today = todayISO()): DayGroup {
  if (todo.due !== null) {
    if (todo.due <= today) return 'today'
    return todo.due <= weekEnd(today) ? 'week' : 'later'
  }
  if (todo.bucket === 'later') return 'later'
  return todo.weekOf === weekStart(today) ? 'week' : 'today'
}

export function todosInGroup(data: AppData, group: DayGroup, today = todayISO()): Todo[] {
  return openTodos(data)
    .filter((t) => dayGroup(t, today) === group)
    .sort(byDueThenOrder)
}

/**
 * Wat er verandert als je een taak naar een groep sleept, of null als dat niet kan.
 * Past de datum niet bij de nieuwe groep, dan schuift die mee: naar Vandaag wordt de datum vandaag,
 * naar Deze week of Om niet te vergeten gaat de datum eraf. Een herhalende taak houdt haar ritme en blijft staan.
 */
export function moveToGroup(todo: Todo, group: DayGroup, today = todayISO()): Partial<Todo> | null {
  if (dayGroup(todo, today) === group) return null
  const due = todo.due
  const end = weekEnd(today)
  const fits = due === null || (group === 'today' ? due <= today : group === 'week' ? due > today && due <= end : due > end)
  if (!fits && todo.recurrence) return null
  if (group === 'today') return { bucket: 'now', weekOf: null, ...(fits ? {} : { due: today }) }
  const clearDue: Partial<Todo> = fits ? {} : { due: null, dueTime: null }
  if (group === 'week') return { bucket: 'now', weekOf: weekStart(today), ...clearDue }
  return { bucket: 'later', weekOf: null, ...clearDue }
}

export function todosInBucket(data: AppData, bucket: Bucket, today = todayISO()): Todo[] {
  return openTodos(data)
    .filter((t) => effectiveBucket(t, today) === bucket)
    .sort(byDueThenOrder)
}

/** Open taken van één klant (null = zonder klant), "nu" bovenaan. */
export function todosForProject(data: AppData, projectId: string | null, today = todayISO()): Todo[] {
  const rank = (t: Todo) => (effectiveBucket(t, today) === 'now' ? 0 : 1)
  return openTodos(data)
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => rank(a) - rank(b) || byDueThenOrder(a, b))
}

/** Bespreekgroepen met minstens één open punt (kopjes tellen niet), in de eigen volgorde. */
export function discussionsWithOpenItems(data: AppData): { discussion: Discussion; open: number }[] {
  return [...data.discussions]
    .sort((a, b) => a.order - b.order)
    .map((discussion) => ({ discussion, open: openItemCount(discussion) }))
    .filter((d) => d.open > 0)
}

export function openSuggestions(data: AppData) {
  return data.suggestions.filter((s) => s.status === 'open')
}

/** Wat de laatste 30 dagen is afgevinkt, het laatst afgevinkt bovenaan. */
export function completedTodos(data: AppData, today = todayISO(), days = 30): Todo[] {
  const limit = addDays(today, -days)
  return data.todos
    .filter((t) => t.done && t.completedAt !== null && t.completedAt.slice(0, 10) >= limit)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
}

/** Zoekt in open taken: alle woorden moeten voorkomen in titel, notitie of klantnaam. */
export function searchTodos(data: AppData, query: string): Todo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const nameOf = (id: string | null) => data.projects.find((p) => p.id === id)?.name ?? ''
  return openTodos(data).filter((t) => {
    const hay = `${t.title} ${t.note} ${nameOf(t.projectId)}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
