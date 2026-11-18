import { useSyncExternalStore } from 'react'
import type { AppData, CalendarRule, NewTodo, Project, Suggestion, Todo } from '../model/types'
import { detectProject } from '../lib/detect'
import { seedData } from './seed'
import { buildProject, buildRule, buildTodo, nowISO, todoFromSuggestion, toggleChanges } from './logic'

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
}

const KEY = 'todo-app:v2'

export function createLocalStore(): Store {
  let data: AppData = load()
  const listeners = new Set<() => void>()

  function load(): AppData {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) return JSON.parse(raw) as AppData
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
}

export function useAppData(): AppData {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
