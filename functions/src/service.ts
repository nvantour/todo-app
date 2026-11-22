import { randomUUID } from 'node:crypto'
import type { AppData, Bucket, NewTodo, Project, Suggestion, Todo } from '../../src/model/types'
import { addDays, nextOccurrence } from '../../src/lib/dates'
import { detectProject } from '../../src/lib/detect'
import { effectiveBucket, todosInBucket } from '../../src/lib/selectors'
import { todayAmsterdam } from './clock'
import { badRequest, notFound } from './errors'
import type { Repo } from './repo'
import type { NewTodoInput, PatchTodoInput, SuggestionInput } from './schemas'

export interface ServiceOptions {
  now?: () => Date
  newId?: () => string
}

/** Zelfde standaardwaarden als `buildTodo()` in src/data/store.ts (dat bestand hangt aan React en kan hier niet gebundeld worden). */
export function buildTodo(input: NewTodo, order: number, id: string, stamp: string): Todo {
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
    id,
    createdAt: stamp,
    updatedAt: stamp,
  }
}

/** Klant herkennen in één of meer stukken tekst (titel, bronlabel, e-mailadres …). */
export function detectClient(texts: (string | undefined)[], projects: Project[]): string | null {
  return detectProject(texts.filter(Boolean).join('\n'), projects)
}

export type TodoFilter =
  | { kind: 'all' }
  | { kind: 'now' }
  | { kind: 'later' }
  | { kind: 'overdue' }
  | { kind: 'upcoming'; days: number }
  | { kind: 'project'; projectId: string | null }

export function parseFilter(raw: string | undefined): TodoFilter {
  if (!raw || raw === 'all') return { kind: 'all' }
  if (raw === 'now' || raw === 'later' || raw === 'overdue') return { kind: raw }
  const up = /^upcoming:(\d{1,3})$/.exec(raw)
  if (up) return { kind: 'upcoming', days: Number(up[1]) }
  const pr = /^project:(.+)$/.exec(raw)
  if (pr) return { kind: 'project', projectId: pr[1] === 'none' ? null : pr[1] }
  throw badRequest('Onbekend filter. Gebruik now, later, overdue, upcoming:<dagen> of project:<id>.', 'bad_filter')
}

export interface CompleteResult {
  todo: Todo
  /** Een terugkerende taak is niet afgevinkt maar doorgeschoven naar de volgende datum. */
  recurred: boolean
  alreadyDone: boolean
}

export class TodoService {
  private now: () => Date
  private newId: () => string

  constructor(
    public repo: Repo,
    opts: ServiceOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date())
    this.newId = opts.newId ?? randomUUID
  }

  today(): string {
    return todayAmsterdam(this.now())
  }
  stamp(): string {
    return this.now().toISOString()
  }

  private async data(uid: string): Promise<AppData> {
    const [todos, projects, suggestions] = await Promise.all([
      this.repo.listTodos(uid),
      this.repo.listProjects(uid),
      this.repo.listSuggestions(uid),
    ])
    return { todos, projects, suggestions, labels: [], calendarRules: [], discussions: [] }
  }

  async listProjects(uid: string): Promise<Project[]> {
    return (await this.repo.listProjects(uid)).filter((p) => !p.archived).sort((a, b) => a.order - b.order)
  }

  async listTodos(uid: string, filter: TodoFilter = { kind: 'all' }, limit?: number): Promise<Todo[]> {
    const data = await this.data(uid)
    const today = this.today()
    const open = data.todos.filter((t) => !t.done)
    const byDue = (a: Todo, b: Todo) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.order - b.order
    let out: Todo[]
    switch (filter.kind) {
      case 'all':
        out = open.sort(byDue)
        break
      case 'now':
        out = todosInBucket(data, 'now', today)
        break
      case 'later':
        out = todosInBucket(data, 'later', today)
        break
      case 'overdue':
        out = open.filter((t) => t.due !== null && t.due < today).sort(byDue)
        break
      case 'upcoming': {
        const end = addDays(today, filter.days)
        out = open.filter((t) => t.due !== null && t.due > today && t.due <= end).sort(byDue)
        break
      }
      case 'project':
        out = open.filter((t) => t.projectId === filter.projectId).sort(byDue)
        break
    }
    return limit ? out.slice(0, limit) : out
  }

  async getTodo(uid: string, id: string): Promise<Todo> {
    const t = await this.repo.getTodo(uid, id)
    if (!t) throw notFound('Deze taak bestaat niet')
    return t
  }

  async addTodo(uid: string, input: NewTodoInput, projects?: Project[]): Promise<Todo> {
    const [existing, projs] = await Promise.all([this.repo.listTodos(uid), projects ?? this.repo.listProjects(uid)])
    const order = Math.max(0, ...existing.map((t) => t.order)) + 1
    const projectId = input.projectId ?? detectClient([input.title, input.source?.label], projs)
    const { source, ...rest } = input
    const todo = buildTodo({ ...stripUndefined(rest), projectId, source: source ?? { type: 'api' } }, order, this.newId(), this.stamp())
    await this.repo.saveTodo(uid, todo)
    return todo
  }

  async updateTodo(uid: string, id: string, patch: PatchTodoInput): Promise<Todo> {
    const todo = await this.getTodo(uid, id)
    const { done, ...fields } = patch
    let next: Todo = { ...todo, ...stripUndefined(fields), updatedAt: this.stamp() }
    if (done === true) return (await this.completeTodo(uid, id, next)).todo
    if (done === false && todo.done) next = { ...next, done: false, completedAt: null }
    await this.repo.saveTodo(uid, next)
    return next
  }

  /** Zelfde gedrag als de app: een terugkerende taak schuift door, een gewone wordt afgevinkt. */
  async completeTodo(uid: string, id: string, base?: Todo): Promise<CompleteResult> {
    const todo = base ?? (await this.getTodo(uid, id))
    if (todo.done) return { todo, recurred: false, alreadyDone: true }
    const stamp = this.stamp()
    let next: Todo
    let recurred = false
    if (todo.recurrence) {
      recurred = true
      next = {
        ...todo,
        due: nextOccurrence(todo.due ?? this.today(), todo.recurrence, this.today()),
        subtasks: todo.subtasks.map((s) => ({ ...s, done: false })),
        updatedAt: stamp,
      }
    } else {
      next = { ...todo, done: true, completedAt: stamp, updatedAt: stamp }
    }
    await this.repo.saveTodo(uid, next)
    return { todo: next, recurred, alreadyDone: false }
  }

  async suggest(uid: string, input: SuggestionInput): Promise<{ created: boolean; duplicateOf?: 'suggestion' | 'todo'; suggestion?: Suggestion; todo?: Todo }> {
    const { source } = input
    if (source.externalId) {
      const same = (s: { type: string; externalId?: string }) => s.type === source.type && s.externalId === source.externalId
      const [suggestions, todos] = await Promise.all([this.repo.listSuggestions(uid), this.repo.listTodos(uid)])
      const dupS = suggestions.find((s) => same(s.source))
      if (dupS) return { created: false, duplicateOf: 'suggestion', suggestion: dupS }
      const dupT = todos.find((t) => same(t.source))
      if (dupT) return { created: false, duplicateOf: 'todo', todo: dupT }
    }
    const projects = await this.repo.listProjects(uid)
    const suggestion: Suggestion = {
      id: this.newId(),
      title: input.title,
      note: input.note ?? '',
      due: input.due ?? null,
      projectId: input.projectId ?? detectClient([input.title, source.label], projects),
      bucket: (input.bucket ?? 'later') as Bucket,
      source,
      reason: input.reason ?? '',
      status: 'open',
      createdAt: this.stamp(),
    }
    await this.repo.saveSuggestion(uid, suggestion)
    return { created: true, suggestion }
  }

  /** Voor de brief en de uitvoer: de effectieve plek (nu/later) van een taak. */
  bucketOf(todo: Todo): Bucket {
    return effectiveBucket(todo, this.today())
  }
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}
