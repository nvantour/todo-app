import { useSyncExternalStore } from 'react'

// Welk paneel open staat (taakdetail, klantenbeheer, zoeken). Eén klein gedeeld object,
// zodat elke plek in de app een paneel kan openen zonder props door te geven.

export interface Overlays {
  detailId: string | null
  clients: boolean
  search: boolean
}

let state: Overlays = { detailId: null, clients: false, search: false }
const listeners = new Set<() => void>()

function set(patch: Partial<Overlays>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export const openDetail = (id: string) => set({ detailId: id, clients: false, search: false })
export const closeDetail = () => set({ detailId: null })
export const openClients = () => set({ clients: true, detailId: null, search: false })
export const closeClients = () => set({ clients: false })
export const openSearch = () => set({ search: true, detailId: null, clients: false })
export const closeSearch = () => set({ search: false })

export function useOverlays(): Overlays {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
