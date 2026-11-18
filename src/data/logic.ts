import type { Label, NewTodo, Project, Suggestion, Todo, CalendarRule } from '../model/types'
import { nextOccurrence, todayISO } from '../lib/dates'

// Gedeelde regels voor beide opslagvormen (lokaal en Firestore), zodat ze zich gelijk gedragen.

export const newId = () => crypto.randomUUID()
export const nowISO = () => new Date().toISOString()

export function buildTodo(input: NewTodo, order: number): Todo {
  const stamp = nowISO()
  return {
    note: '',
    done: false,
    completedAt: null,
    due: null,
    dueTime: null,
    bucket: 'now',
    projectId: null,
    labelIds: [],
    subtasks: [],
    estimateMin: null,
    recurrence: null,
    source: { type: 'manual' },
    calendarEventId: null,
    order,
    ...input,
    id: newId(),
    createdAt: stamp,
    updatedAt: stamp,
  }
}

export function buildRule(input: Partial<CalendarRule> = {}): CalendarRule {
  return { match: '', titleTemplate: '{titel} voorbereiden', workdaysBefore: 3, enabled: true, ...input, id: newId() }
}

export function buildProject(input: Pick<Project, 'name' | 'color'> & Partial<Project>, order: number): Project {
  return { keywords: [input.name.trim().toLowerCase()], order, archived: false, ...input, id: newId() }
}

/** Wat er verandert als je een taak afvinkt of terugzet. Terugkerend: schuift door naar de volgende datum. */
export function toggleChanges(todo: Todo): Partial<Todo> {
  if (!todo.done && todo.recurrence) {
    return {
      due: nextOccurrence(todo.due ?? todayISO(), todo.recurrence),
      subtasks: todo.subtasks.map((s) => ({ ...s, done: false })),
    }
  }
  return { done: !todo.done, completedAt: todo.done ? null : nowISO() }
}

export function todoFromSuggestion(s: Suggestion, order: number): Todo {
  return buildTodo({ title: s.title, note: s.note, due: s.due, projectId: s.projectId, bucket: s.bucket, source: s.source }, order)
}

// Documenten uit Firestore kunnen door andere tools zijn aangemaakt met alleen een paar velden
// (bv. Helder Mail schrijft alleen title + source). Vul de rest met standaardwaarden aan.

type Raw = Record<string, unknown>

export function normalizeTodo(id: string, raw: Raw): Todo {
  const base = buildTodo({ title: '' }, 0)
  return { ...base, ...(raw as Partial<Todo>), id, source: { ...base.source, ...((raw.source as object) ?? {}) } as Todo['source'] }
}

export function normalizeProject(id: string, raw: Raw): Project {
  return { name: '', color: '#8e8a96', keywords: [], order: 0, archived: false, ...(raw as Partial<Project>), id }
}

export function normalizeSuggestion(id: string, raw: Raw): Suggestion {
  return {
    title: '', note: '', due: null, projectId: null, bucket: 'now', reason: '', status: 'open', createdAt: nowISO(),
    ...(raw as Partial<Suggestion>),
    id,
    source: { type: 'api', ...((raw.source as object) ?? {}) } as Suggestion['source'],
  }
}

export function normalizeLabel(id: string, raw: Raw): Label {
  return { name: '', color: '#8e8a96', ...(raw as Partial<Label>), id }
}

export function normalizeRule(id: string, raw: Raw): CalendarRule {
  return { match: '', titleTemplate: '{titel}', workdaysBefore: 0, enabled: true, ...(raw as Partial<CalendarRule>), id }
}
