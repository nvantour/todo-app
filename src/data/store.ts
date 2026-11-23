import { useSyncExternalStore } from 'react'
import type { AppData, CalendarRule, Discussion, NewTodo, Project, Reply, Suggestion, TaskStatus, Todo } from '../model/types'
import { detectProject } from '../lib/detect'
import { seedData } from './seed'
import { buildDiscussion, buildProject, buildRule, buildTodo, nowISO, preparePatch, todoFromSuggestion, toggleChanges } from './logic'

// Blijft hier beschikbaar: docs/koppelingen.md verwijst naar buildTodo() in dit bestand.
export { buildTodo }

/**
 * De ene deur naar de data. Schermen praten alleen met deze interface;
 * daaronder zit de lokale opslag (zonder Firebase-config, voor ontwerp en
 * ontwikkeling) of Firestore (live sync tussen apparaten).
 */
export interface Store {
  subscribe(listener: () => void): () => void
  getSnapshot(): AppData
  addTodo(input: NewTodo): string
  updateTodo(id: string, patch: Partial<Todo>): void
  /** Vinkt af of zet terug. Een terugkerende todo schuift door naar de volgende datum. */
  toggleTodo(id: string): void
  deleteTodo(id: string): void
  addProject(input: Pick<Project, 'name' | 'color'> & Partial<Project>): string
  updateProject(id: string, patch: Partial<Project>): void
  acceptSuggestion(id: string): void
  dismissSuggestion(id: string): void
  /** Regels voor de agenda-scan (Instellingen). */
  addRule(input?: Partial<CalendarRule>): string
  updateRule(id: string, patch: Partial<CalendarRule>): void
  deleteRule(id: string): void
  /** "Om te bespreken": een groep met punten. De klant wordt uit de naam herkend. */
  addDiscussion(title: string): string
  updateDiscussion(id: string, patch: Partial<Discussion>): void
  deleteDiscussion(id: string): void
  /** Kolommen van het bord: de hele lijst in één keer (toevoegen, hernoemen, verwijderen, volgorde). */
  setStatuses(list: TaskStatus[]): void
  /** Tab Antwoorden: tekst aanpassen, status zetten (vinkje, negeren). Nieuwe kaarten komen van de server. */
  updateReply(id: string, patch: Partial<Reply>): void
}

const KEY = 'todo-app:v2'

export function createLocalStore(): Store {
  let data: AppData = load()
  const listeners = new Set<() => void>()

  function load(): AppData {
    try {
      const raw = localStorage.getItem(KEY)
      // oudere opslag heeft nog geen 'discussions': val terug op een lege lijst
      if (raw) {
        const saved = JSON.parse(raw) as Partial<AppData>
        return { ...(saved as AppData), discussions: saved.discussions ?? [], statuses: saved.statuses ?? [], replies: saved.replies ?? [] }
      }
    } catch {
      /* opslag niet beschikbaar: start met voorbeelddata */
    }
    return seedData()
  }

  function commit(next: AppData) {
    data = next
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
    } catch {
      /* alleen in geheugen */
    }
    listeners.forEach((l) => l())
  }

  const nextOrder = () => Math.max(0, ...data.todos.map((t) => t.order)) + 1

  const patchTodo = (id: string, patch: Partial<Todo>) =>
    commit({ ...data, todos: data.todos.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: nowISO() } : t)) })

  const patchSuggestion = (id: string, status: Suggestion['status']) =>
    commit({ ...data, suggestions: data.suggestions.map((s) => (s.id === id ? { ...s, status } : s)) })

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => data,

    addTodo(input) {
      // klant automatisch herkennen als die niet is meegegeven
      const projectId = input.projectId ?? detectProject(input.title, data.projects)
      const todo = buildTodo({ ...input, projectId }, nextOrder())
      commit({ ...data, todos: [...data.todos, todo] })
      return todo.id
    },
    updateTodo: patchTodo,

    toggleTodo(id) {
      const todo = data.todos.find((t) => t.id === id)
      if (todo) patchTodo(id, toggleChanges(todo))
    },

    deleteTodo(id) {
      commit({ ...data, todos: data.todos.filter((t) => t.id !== id) })
    },

    addProject(input) {
      const project = buildProject(input, data.projects.length)
      commit({ ...data, projects: [...data.projects, project] })
      return project.id
    },
    updateProject(id, patch) {
      commit({ ...data, projects: data.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
    },

    acceptSuggestion(id) {
      const s = data.suggestions.find((x) => x.id === id)
      if (!s) return
      commit({
        ...data,
        todos: [...data.todos, todoFromSuggestion(s, nextOrder())],
        suggestions: data.suggestions.map((x) => (x.id === id ? { ...x, status: 'accepted' } : x)),
      })
    },
    dismissSuggestion: (id) => patchSuggestion(id, 'dismissed'),

    addRule(input) {
      const rule = buildRule(input)
      commit({ ...data, calendarRules: [...data.calendarRules, rule] })
      return rule.id
    },
    updateRule(id, patch) {
      commit({ ...data, calendarRules: data.calendarRules.map((r) => (r.id === id ? { ...r, ...patch, id } : r)) })
    },
    deleteRule(id) {
      commit({ ...data, calendarRules: data.calendarRules.filter((r) => r.id !== id) })
    },

    addDiscussion(title) {
      const order = Math.max(-1, ...data.discussions.map((d) => d.order)) + 1
      const discussion = buildDiscussion(title, detectProject(title, data.projects), order)
      commit({ ...data, discussions: [...data.discussions, discussion] })
      return discussion.id
    },
    updateDiscussion(id, patch) {
      commit({
        ...data,
        discussions: data.discussions.map((d) => (d.id === id ? { ...d, ...preparePatch(patch), id, updatedAt: nowISO() } : d)),
      })
    },
    deleteDiscussion(id) {
      commit({ ...data, discussions: data.discussions.filter((d) => d.id !== id) })
    },
    setStatuses(list) {
      commit({ ...data, statuses: list })
    },
    updateReply(id, patch) {
      commit({ ...data, replies: data.replies.map((r) => (r.id === id ? { ...r, ...patch, id, updatedAt: nowISO() } : r)) })
    },
  }
}


// De schermen gebruiken altijd `store`; welke opslag daaronder zit, wisselt met setBackend().
// Standaard is dat de lokale opslag; na inloggen wordt het Firestore.
let backend: Store = createLocalStore()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
let unsubscribeBackend = backend.subscribe(notify)

export function setBackend(next: Store) {
  if (next === backend) return
  unsubscribeBackend()
  backend = next
  unsubscribeBackend = next.subscribe(notify)
  notify()
}

export const store: Store = {
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => backend.getSnapshot(),
  addTodo: (input) => backend.addTodo(input),
  updateTodo: (id, patch) => backend.updateTodo(id, patch),
  toggleTodo: (id) => backend.toggleTodo(id),
  deleteTodo: (id) => backend.deleteTodo(id),
  addProject: (input) => backend.addProject(input),
  updateProject: (id, patch) => backend.updateProject(id, patch),
  acceptSuggestion: (id) => backend.acceptSuggestion(id),
  dismissSuggestion: (id) => backend.dismissSuggestion(id),
  addRule: (input) => backend.addRule(input),
  updateRule: (id, patch) => backend.updateRule(id, patch),
  deleteRule: (id) => backend.deleteRule(id),
  addDiscussion: (title) => backend.addDiscussion(title),
  updateDiscussion: (id, patch) => backend.updateDiscussion(id, patch),
  deleteDiscussion: (id) => backend.deleteDiscussion(id),
  setStatuses: (list) => backend.setStatuses(list),
  updateReply: (id, patch) => backend.updateReply(id, patch),
}

export function useAppData(): AppData {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
