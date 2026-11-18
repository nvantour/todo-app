import { useSyncExternalStore } from 'react'
import { createFirestoreStore, type FirestoreStore } from './firestoreStore'
import { getSession, subscribeSession } from './session'
import { setBackend } from './store'

// Koppelt de inlogstatus aan de opslag: ingelogd = Firestore van die gebruiker,
// zonder Firebase-config = lokale opslag (blijft de standaard in store.ts).

export interface Connection {
  /** local = geen inlog nodig; loading = even wachten; signedOut = inlogscherm; ready = data staat klaar. */
  status: 'local' | 'loading' | 'signedOut' | 'ready'
}

let state: Connection = { status: 'loading' }
const listeners = new Set<() => void>()
let current: { uid: string; store: FirestoreStore } | null = null

function set(status: Connection['status']) {
  if (state.status === status) return
  state = { status }
  listeners.forEach((l) => l())
}

function sync() {
  const s = getSession()
  if (s.status === 'local') return set('local')
  if (s.status === 'loading') return set('loading')
  if (s.status === 'signedOut' || !s.user) {
    current?.store.dispose()
    current = null
    return set('signedOut')
  }
  if (current?.uid === s.user.uid) return
  current?.store.dispose()
  const mine = { uid: s.user.uid, store: createFirestoreStore(s.user.uid) }
  current = mine
  setBackend(mine.store)
  set('loading')
  void mine.store.ready.then(() => {
    if (current === mine) set('ready')
  })
}

subscribeSession(sync)
sync()

export function useConnection(): Connection {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
