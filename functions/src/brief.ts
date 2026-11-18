import type { Project, Suggestion, Todo } from '../../src/model/types'
import { addDays, formatDue, formatLongDate } from '../../src/lib/dates'
import { effectiveBucket, todosInBucket } from '../../src/lib/selectors'
import type { TodoService } from './service'

export interface BriefTodo {
  id: string
  title: string
  due: string | null
  dueTime: string | null
  bucket: 'now' | 'later'
  project: string | null
  source: string | null
}

export interface Brief {
  date: string
  dateLabel: string
  /** Om nu te doen (inclusief achterstallig en wat vandaag moet). */
  now: BriefTodo[]
  /** Taken met vandaag als datum. */
  today: BriefTodo[]
  /** Taken met een datum in de komende 3 dagen (na vandaag). */
  upcoming: BriefTodo[]
  overdue: BriefTodo[]
  suggestions: { id: string; title: string; reason: string; source: string | null; project: string | null }[]
  text: string
}

const UPCOMING_DAYS = 3

export async function buildBrief(service: TodoService, uid: string): Promise<Brief> {
  const [todos, projects, suggestions] = await Promise.all([
    service.repo.listTodos(uid),
    service.repo.listProjects(uid),
    service.repo.listSuggestions(uid),
  ])
  const today = service.today()
  const names = new Map<string, string>(projects.map((p: Project) => [p.id, p.name]))
  const open = todos.filter((t) => !t.done)
  const byDue = (a: Todo, b: Todo) =>
    (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') || a.order - b.order
  const lean = (t: Todo): BriefTodo => ({
    id: t.id,
    title: t.title,
    due: t.due,
    dueTime: t.dueTime,
    bucket: effectiveBucket(t, today),
    project: t.projectId ? (names.get(t.projectId) ?? null) : null,
    source: t.source.label ?? null,
  })

  const now = todosInBucket({ todos, projects, suggestions, labels: [], calendarRules: [] }, 'now', today).map(lean)
  const overdue = open.filter((t) => t.due !== null && t.due < today).sort(byDue).map(lean)
  const dueToday = open.filter((t) => t.due === today).sort(byDue).map(lean)
  const end = addDays(today, UPCOMING_DAYS)
  const upcoming = open.filter((t) => t.due !== null && t.due > today && t.due <= end).sort(byDue).map(lean)
  const openSuggestions = suggestions
    .filter((s: Suggestion) => s.status === 'open')
    .map((s) => ({ id: s.id, title: s.title, reason: s.reason, source: s.source.label ?? null, project: s.projectId ? (names.get(s.projectId) ?? null) : null }))

  const brief: Brief = {
    date: today,
    dateLabel: formatLongDate(today),
    now,
    today: dueToday,
    upcoming,
    overdue,
    suggestions: openSuggestions,
    text: '',
  }
  brief.text = briefText(brief, today)
  return brief
}

function line(t: BriefTodo, today: string): string {
  const bits = [t.project, t.due ? `${formatDue(t.due, today).toLowerCase()}${t.dueTime ? ` ${t.dueTime}` : ''}` : null].filter(Boolean)
  return `- ${t.title}${bits.length ? ` (${bits.join(', ')})` : ''}`
}

/** Korte, leesbare tekst in gewoon Nederlands. */
export function briefText(b: Brief, today: string): string {
  const out: string[] = [b.dateLabel]
  const section = (title: string, items: BriefTodo[]) => {
    if (items.length) out.push('', `${title} (${items.length}):`, ...items.map((t) => line(t, today)))
  }
  section('Achterstallig', b.overdue)
  section('Vandaag', b.today)
  section(`Komende ${UPCOMING_DAYS} dagen`, b.upcoming)
  const shown = new Set([...b.overdue, ...b.today, ...b.upcoming].map((t) => t.id))
  section('Verder om nu te doen', b.now.filter((t) => !shown.has(t.id)))
  if (b.suggestions.length) {
    out.push('', `Voorstellen om te beoordelen (${b.suggestions.length}):`)
    for (const s of b.suggestions) out.push(`- ${s.title}${s.source ? ` (${s.source})` : ''}`)
  }
  if (out.length === 1) out.push('', 'Niets open. Lekker rustig.')
  return out.join('\n')
}
