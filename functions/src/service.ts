import { randomUUID } from 'node:crypto'
import type { AppData, Bucket, NewTodo, Project, Reply, ReplyChannel, ReplyStatus, Suggestion, Todo } from '../../src/model/types'
import { mergeReply } from '../../src/data/replies'
import { addDays, nextOccurrence } from '../../src/lib/dates'
import { detectProject } from '../../src/lib/detect'
import { effectiveBucket, todosInBucket } from '../../src/lib/selectors'
import { todayAmsterdam } from './clock'
import { HttpError, badRequest, notFound } from './errors'
import type { Repo } from './repo'
import type { IncomingReplyInput, NewTodoInput, PatchTodoInput, SuggestionInput } from './schemas'

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
    return { todos, projects, suggestions, labels: [], calendarRules: [], discussions: [], statuses: [], replies: [] }
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

  // --- Antwoorden ---

  /** Een ronde van Claude: kaarten aanmaken of bijwerken (zie mergeReply). Zet nooit iets op goedgekeurd. */
  async saveReplies(uid: string, inputs: IncomingReplyInput[]): Promise<Record<'created' | 'updated' | 'reopened' | 'skipped', number>> {
    const [existing, projects] = await Promise.all([this.repo.listReplies(uid), this.repo.listProjects(uid)])
    const counts = { created: 0, updated: 0, reopened: 0, skipped: 0 }
    const stamp = this.stamp()
    for (const input of inputs) {
      const old = existing.find((r) => r.channel === input.channel && r.externalId === input.externalId)
      const projectId = input.projectId ?? old?.projectId ?? detectClient([input.title, input.who, ...input.messages.map((m) => m.author)], projects)
      const { reply, change } = mergeReply(old, { ...input, projectId }, stamp, () => this.newId())
      counts[change]++
      if (change !== 'skipped') await this.repo.saveReply(uid, reply)
    }
    return counts
  }

  async listReplies(uid: string, filter: { status?: ReplyStatus[]; channel?: ReplyChannel[] } = {}): Promise<Reply[]> {
    const all = await this.repo.listReplies(uid)
    return all
      .filter((r) => (!filter.status || filter.status.includes(r.status)) && (!filter.channel || filter.channel.includes(r.channel)))
      .sort((a, b) => (a.approvedAt ?? a.createdAt).localeCompare(b.approvedAt ?? b.createdAt))
  }

  async getReply(uid: string, id: string): Promise<Reply> {
    const r = await this.repo.getReply(uid, id)
    if (!r) throw notFound('Dit antwoord bestaat niet')
    return r
  }

  /**
   * Voortgang van het verzendscript. Alleen deze stappen mogen: goedgekeurd → bezig → verstuurd/mislukt
   * (of meteen mislukt). Zo kan niets buiten de app om een antwoord laten versturen.
   */
  async setReplyResult(uid: string, id: string, status: 'sending' | 'sent' | 'failed', error?: string): Promise<Reply> {
    const r = await this.getReply(uid, id)
    const allowed: Record<string, ReplyStatus[]> = { sending: ['approved'], sent: ['sending'], failed: ['approved', 'sending'] }
    if (!allowed[status].includes(r.status)) throw new HttpError(409, 'bad_transition', `Kan niet van "${r.status}" naar "${status}".`)
    const stamp = this.stamp()
    const next: Reply = { ...r, status, updatedAt: stamp, error: status === 'failed' ? (error ?? 'Versturen mislukt.') : null, sentAt: status === 'sent' ? stamp : r.sentAt }
    await this.repo.saveReply(uid, next)
    return next
  }

  /** Voor de brief en de uitvoer: de effectieve plek (nu/later) van een taak. */
  bucketOf(todo: Todo): Bucket {
    return effectiveBucket(todo, this.today())
  }
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}
