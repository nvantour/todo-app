import { useSyncExternalStore } from 'react'

/** De pagina's in het hoofdmenu. Instellingen en Zoeken staan vast en tellen hier niet mee. */
export const NAV_IDS = ['vandaag', 'taken', 'bespreken', 'voorstellen', 'meetings', 'mail', 'klanten'] as const
export type NavId = (typeof NAV_IDS)[number]

/** Hoeveel menu-items op de telefoon in de onderbalk passen; de rest staat onder "Meer". */
export const MOBILE_TABS = 4

const KEY = 'todo-app:nav-order'
const listeners = new Set<() => void>()

/**
 * Maakt van een opgeslagen volgorde een geldige: onbekende of dubbele items vallen weg,
 * nieuwe pagina's (die er bij het opslaan nog niet waren) komen achteraan.
 */
export function normalizeOrder(saved: unknown): NavId[] {
  const known = new Set<string>(NAV_IDS)
  const seen = new Set<string>()
  const out: NavId[] = []
  if (Array.isArray(saved)) {
    for (const id of saved) {
      if (typeof id === 'string' && known.has(id) && !seen.has(id)) {
        seen.add(id)
        out.push(id as NavId)
      }
    }
  }
  for (const id of NAV_IDS) if (!seen.has(id)) out.push(id)
  return out
}

/** Zet `id` op de plek van `targetId` (slepen) en schuift de rest op. */
export function moveTo(order: NavId[], id: NavId, targetId: NavId): NavId[] {
  if (id === targetId) return order
  const without = order.filter((x) => x !== id)
  const at = order.indexOf(targetId)
  const from = order.indexOf(id)
  // naar beneden slepen: achter het doel; naar boven: ervoor
  const index = without.indexOf(targetId) + (from < at ? 1 : 0)
  return [...without.slice(0, index), id, ...without.slice(index)]
}

/** Eén plek omhoog (-1) of omlaag (+1); aan de rand gebeurt niets. */
export function moveBy(order: NavId[], id: NavId, delta: -1 | 1): NavId[] {
  const i = order.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= order.length) return order
  const next = [...order]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

let cache: NavId[] | null = null

export function getNavOrder(): NavId[] {
  if (cache) return cache
  let saved: unknown = null
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    /* opslag niet beschikbaar of kapot: standaardvolgorde */
  }
  cache = normalizeOrder(saved)
  return cache
}

export function setNavOrder(order: NavId[]) {
  cache = normalizeOrder(order)
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* alleen voor deze sessie */
  }
  listeners.forEach((l) => l())
}

export function resetNavOrder() {
  cache = [...NAV_IDS]
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* niets te wissen */
  }
  listeners.forEach((l) => l())
}

export function useNavOrder(): NavId[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getNavOrder,
  )
}
