import { collection, connectFirestoreEmulator, deleteDoc, doc, getFirestore, initializeFirestore, onSnapshot, persistentLocalCache, persistentMultipleTabManager, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import type { AppData, Todo } from '../model/types'
import { detectProject } from '../lib/detect'
import type { Store } from './store'
import { buildDiscussion, buildProject, buildRule, buildTodo, normalizeDiscussion, normalizeLabel, normalizeProject, normalizeRule, normalizeSuggestion, normalizeTodo, nowISO, preparePatch, todoFromSuggestion, toggleChanges } from './logic'
import { seedProjects } from './seed'
import { normalizeStatus } from './board'
import { getFirebaseApp } from './session'

export interface FirestoreStore extends Store {
  /** Klaar zodra de eerste gegevens binnen zijn (of na een korte wachttijd als je offline bent). */
  ready: Promise<void>
  dispose(): void
}

let db: Firestore | null = null
function getDb(): Firestore {
  if (db) return db
  const app = getFirebaseApp()
  try {
    // Offline-cache die ook met meerdere tabbladen werkt. Datums zijn tekst, dus geen Timestamps.
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }), ignoreUndefinedProperties: true })
  } catch {
    db = getFirestore(app) // al geïnitialiseerd (bv. door hot reload)
    return db
  }
  // alleen tijdens ontwikkeling: tegen de lokale Firestore-emulator werken, bv. VITE_FIRESTORE_EMULATOR=localhost:8080
  const emulator = import.meta.env.DEV ? (import.meta.env.VITE_FIRESTORE_EMULATOR as string | undefined) : undefined
  if (emulator) {
    const [host, port] = emulator.split(':')
    connectFirestoreEmulator(db, host, Number(port))
  }
  return db
}

const fail = (what: string) => (e: unknown) => console.error(`Opslaan mislukt (${what})`, e)

export function createFirestoreStore(uid: string): FirestoreStore {
  const firestore = getDb()
  const col = (name: keyof AppData) => collection(firestore, 'users', uid, name)
  const ref = (name: keyof AppData, id: string) => doc(firestore, 'users', uid, name, id)

  let data: AppData = { todos: [], projects: [], labels: [], suggestions: [], calendarRules: [], discussions: [], statuses: [] }
  const listeners = new Set<() => void>()
  const loaded = new Set<string>()
  let seeded = false
  let resolveReady: () => void = () => {}
  const ready = new Promise<void>((r) => (resolveReady = r))
  // offline met een lege cache? Na 3 seconden toch openen (met wat er is)
  const timer = window.setTimeout(resolveReady, 3000)

  function listen<K extends keyof AppData>(name: K, map: (id: string, raw: Record<string, unknown>) => AppData[K][number]) {
    return onSnapshot(
      col(name),
      // metadata mee: zo merken we ook dat de server bevestigt dat een lijst leeg is (nodig voor de eerste login)
      { includeMetadataChanges: true },
      (snap) => {
        let items = snap.docs.map((d) => map(d.id, d.data())) as AppData[K]
        if (name === 'projects' || name === 'discussions' || name === 'statuses') items = [...(items as { order: number }[])].sort((a, b) => a.order - b.order) as AppData[K]
        data = { ...data, [name]: items }

        // Eerste login: alleen de klantenlijst aanmaken. Pas als de server bevestigt dat er niets is,
        // zodat een apparaat met een lege cache niet de lijst van een ander apparaat overschrijft.
        if (name === 'projects' && snap.empty && !snap.metadata.fromCache && !seeded) {
          seeded = true
          const batch = writeBatch(firestore)
          for (const p of seedProjects()) batch.set(ref('projects', p.id), p)
          batch.commit().catch(fail('klanten'))
        }

        if (!snap.metadata.fromCache || !snap.empty) loaded.add(name)
        if (loaded.size === LISTS) resolveReady()
        listeners.forEach((l) => l())
      },
      (err) => {
        console.error(`Lezen mislukt (${name})`, err)
        loaded.add(name)
        if (loaded.size === LISTS) resolveReady()
      },
    )
  }

  // aantal lijsten waar we op wachten voordat de app opent
  const LISTS = 7
  const unsubs = [
    listen('todos', normalizeTodo),
    listen('projects', normalizeProject),
    listen('labels', normalizeLabel),
    listen('suggestions', normalizeSuggestion),
    listen('calendarRules', normalizeRule),
    listen('discussions', normalizeDiscussion),
    listen('statuses', normalizeStatus),
  ]

  const nextOrder = () => Math.max(0, ...data.todos.map((t) => t.order)) + 1
  const patchTodo = (id: string, patch: Partial<Todo>) => {
    const { id: _ignored, ...rest } = patch
    void _ignored
    updateDoc(ref('todos', id), { ...rest, updatedAt: nowISO() }).catch(fail('taak'))
  }

  return {
    ready,
    dispose() {
      window.clearTimeout(timer)
      unsubs.forEach((u) => u())
      listeners.clear()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => data,

    addTodo(input) {
      const projectId = input.projectId ?? detectProject(input.title, data.projects)
      const newRef = doc(col('todos'))
      const todo = { ...buildTodo({ ...input, projectId }, nextOrder()), id: newRef.id }
      setDoc(newRef, todo).catch(fail('taak'))
      return todo.id
    },
    updateTodo: patchTodo,
    toggleTodo(id) {
      const todo = data.todos.find((t) => t.id === id)
      if (todo) patchTodo(id, toggleChanges(todo))
    },
    deleteTodo(id) {
      deleteDoc(ref('todos', id)).catch(fail('taak'))
    },

    addProject(input) {
      const newRef = doc(col('projects'))
      const project = { ...buildProject(input, data.projects.length), id: newRef.id }
      setDoc(newRef, project).catch(fail('klant'))
      return project.id
    },
    updateProject(id, patch) {
      const { id: _ignored, ...rest } = patch
      void _ignored
      updateDoc(ref('projects', id), rest).catch(fail('klant'))
    },

    acceptSuggestion(id) {
      const s = data.suggestions.find((x) => x.id === id)
      if (!s) return
      const newRef = doc(col('todos'))
      const todo = { ...todoFromSuggestion(s, nextOrder()), id: newRef.id }
      const batch = writeBatch(firestore)
      batch.set(newRef, todo)
      batch.update(ref('suggestions', id), { status: 'accepted' })
      batch.commit().catch(fail('voorstel'))
    },
    dismissSuggestion(id) {
      updateDoc(ref('suggestions', id), { status: 'dismissed' }).catch(fail('voorstel'))
    },

    addRule(input) {
      const newRef = doc(col('calendarRules'))
      const rule = { ...buildRule(input), id: newRef.id }
      setDoc(newRef, rule).catch(fail('regel'))
      return rule.id
    },
    updateRule(id, patch) {
      const { id: _ignored, ...rest } = patch
      void _ignored
      updateDoc(ref('calendarRules', id), rest).catch(fail('regel'))
    },
    deleteRule(id) {
      deleteDoc(ref('calendarRules', id)).catch(fail('regel'))
    },

    addDiscussion(title) {
      const newRef = doc(col('discussions'))
      const order = Math.max(-1, ...data.discussions.map((d) => d.order)) + 1
      const discussion = { ...buildDiscussion(title, detectProject(title, data.projects), order), id: newRef.id }
      setDoc(newRef, discussion).catch(fail('groep'))
      return discussion.id
    },
    updateDiscussion(id, patch) {
      const { id: _ignored, ...rest } = preparePatch(patch)
      void _ignored
      updateDoc(ref('discussions', id), { ...rest, updatedAt: nowISO() }).catch(fail('groep'))
    },
    deleteDiscussion(id) {
      deleteDoc(ref('discussions', id)).catch(fail('groep'))
    },
    setStatuses(list) {
      // hele lijst in één keer: nieuwe/gewijzigde zetten, verdwenen statussen weghalen
      const batch = writeBatch(firestore)
      for (const s of list) batch.set(ref('statuses', s.id), s)
      for (const old of data.statuses) if (!list.some((s) => s.id === old.id)) batch.delete(ref('statuses', old.id))
      batch.commit().catch(fail('statussen'))
    },
  }
}
