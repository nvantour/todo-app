import type { CalendarRule, Discussion, DiscussionItem, Label, NewTodo, Project, Suggestion, Todo } from '../model/types'
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
// (bv. een koppeling schrijft alleen title + source). Vul de rest met standaardwaarden aan.

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

// ---------- Om te bespreken ----------

/** Afgevinkte punten blijven zo lang bewaard (maar zijn direct onzichtbaar). */
export const DISCUSSION_KEEP_DAYS = 14

/** Een regel die eindigt op een dubbele punt is een tussenkopje. */
export const isHeading = (text: string) => text.trim().endsWith(':')

export function buildDiscussionItem(text: string): DiscussionItem {
  return { id: newId(), text: text.trim(), done: false, doneAt: null }
}

export function buildDiscussion(title: string, projectId: string | null, order: number): Discussion {
  const stamp = nowISO()
  return { id: newId(), title: cleanDiscussionTitle(title), projectId, items: [], order, createdAt: stamp, updatedAt: stamp }
}

/** "Maxeda:" wordt "Maxeda". */
export const cleanDiscussionTitle = (title: string) => title.trim().replace(/:+$/, '').trim()

/** Splitst getypte of geplakte tekst in losse punten (lege regels vallen weg). */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]\s+)/, '').trim())
    .filter(Boolean)
}

/** Vinkt een punt af (of zet het terug). Tussenkopjes en onbekende id's blijven ongemoeid. */
export function toggleDiscussionItem(items: DiscussionItem[], id: string, now = nowISO()): DiscussionItem[] {
  return items.map((i) => (i.id === id && !isHeading(i.text) ? { ...i, done: !i.done, doneAt: i.done ? null : now } : i))
}

/** Gooit punten weg die al langer dan `days` dagen zijn afgevinkt. */
export function pruneDoneItems(items: DiscussionItem[], now = Date.now(), days = DISCUSSION_KEEP_DAYS): DiscussionItem[] {
  const limit = now - days * 86_400_000
  return items.filter((i) => !(i.done && i.doneAt && new Date(i.doneAt).getTime() < limit))
}

/** Wat de lijst laat zien: alles wat nog niet is afgevinkt. */
export const visibleItems = (d: Discussion) => d.items.filter((i) => !i.done)

/** Het aantal echte punten (zonder tussenkopjes) dat nog besproken moet worden. */
export const openItemCount = (d: Discussion) => visibleItems(d).filter((i) => !isHeading(i.text)).length

export function normalizeDiscussion(id: string, raw: Raw): Discussion {
  const base = { title: '', projectId: null, order: 0, createdAt: nowISO(), updatedAt: nowISO() }
  const items = Array.isArray(raw.items) ? (raw.items as Partial<DiscussionItem>[]) : []
  return {
    ...base,
    ...(raw as Partial<Discussion>),
    id,
    items: items.map((i) => ({ id: i.id ?? newId(), text: i.text ?? '', done: Boolean(i.done), doneAt: i.doneAt ?? null })),
  }
}

/** Opruimen bij het opslaan: oude afgevinkte punten verdwijnen, de titel wordt netjes. */
export function preparePatch(patch: Partial<Discussion>): Partial<Discussion> {
  return {
    ...patch,
    ...(patch.items ? { items: pruneDoneItems(patch.items) } : {}),
    ...(patch.title !== undefined ? { title: cleanDiscussionTitle(patch.title) } : {}),
  }
}

/**
 * Zet punt `itemId` in groep `toId`, vóór punt `beforeId` (null = achteraan).
 * Geeft per groep die verandert de nieuwe puntenlijst terug; leeg als er niets verandert.
 */
export function moveDiscussionItem(discussions: Discussion[], itemId: string, toId: string, beforeId: string | null): Record<string, DiscussionItem[]> {
  const from = discussions.find((d) => d.items.some((i) => i.id === itemId))
  const to = discussions.find((d) => d.id === toId)
  if (!from || !to || beforeId === itemId) return {}
  const item = from.items.find((i) => i.id === itemId)!
  const rest = from.items.filter((i) => i.id !== itemId)
  const target = from.id === to.id ? rest : to.items
  const index = beforeId ? target.findIndex((i) => i.id === beforeId) : target.length
  if (index < 0) return {}
  const next = [...target.slice(0, index), item, ...target.slice(index)]
  if (from.id !== to.id) return { [to.id]: next, [from.id]: rest }
  return next.some((i, k) => i.id !== from.items[k].id) ? { [from.id]: next } : {}
}

/** Eén plek omhoog (-1) of omlaag (1) tussen de zichtbare punten van de groep; voor de pijltjestoetsen. */
export function stepDiscussionItem(discussions: Discussion[], groupId: string, itemId: string, dir: -1 | 1): Record<string, DiscussionItem[]> {
  const group = discussions.find((d) => d.id === groupId)
  if (!group) return {}
  const shown = visibleItems(group)
  const k = shown.findIndex((i) => i.id === itemId)
  if (k < 0) return {}
  if (dir === -1) return k === 0 ? {} : moveDiscussionItem(discussions, itemId, groupId, shown[k - 1].id)
  return k === shown.length - 1 ? {} : moveDiscussionItem(discussions, itemId, groupId, shown[k + 2]?.id ?? null)
}
