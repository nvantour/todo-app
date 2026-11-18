import { useSyncExternalStore } from 'react'

// Of de sheet open is, en welke knop de sheet "host": er zijn twee knoppen
// (zijbalk en dock) maar maar één sheet.

interface UiState {
  open: boolean
  hostId: string | null
}

let state: UiState = { open: false, hostId: null }
const listeners = new Set<() => void>()

function set(next: UiState) {
  state = next
  listeners.forEach((l) => l())
}

export function openVoice(): void {
  if (!state.open) set({ ...state, open: true })
}
export function closeVoice(): void {
  if (state.open) set({ ...state, open: false })
}
export function claimHost(id: string): void {
  if (state.hostId === null) set({ ...state, hostId: id })
}
export function releaseHost(id: string): void {
  if (state.hostId === id) set({ ...state, hostId: null })
}

export function useVoiceUi(): UiState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
