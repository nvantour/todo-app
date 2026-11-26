// Aantal ongelezen threads in Nieuw (Gmail INBOX), voor achter "Mail" in het menu.
// Werkt ook als de Mail-tab niet open is: elke minuut opnieuw zolang de app zichtbaar is,
// en meteen bij terugkeren naar de app. De Mail-tab geeft zijn eigen telling ook door (setMailUnread).

import { useSyncExternalStore } from 'react'
import { checkAccess } from './gmail/auth'
import { labelCounts } from './gmail/api'

const EVERY = 60_000

let count: number | null = null
let busy = false
let lastAt = 0
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

/** Nieuwe telling doorgeven (ook vanuit de Mail-tab zelf, die vaker telt). */
export function setMailUnread(n: number | null | undefined) {
  if (n === undefined) return
  lastAt = Date.now()
  if (n === count) return
  count = n
  listeners.forEach((l) => l())
}

async function refresh(force = false) {
  if (busy || (!force && Date.now() - lastAt < 10_000)) return
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  busy = true
  try {
    const access = await checkAccess()
    if (!access.ok) { setMailUnread(null); return }
    const c = await labelCounts(access.email, ['INBOX'], ['INBOX'])
    setMailUnread(c.INBOX ?? null)
  } catch { /* volgende ronde opnieuw; het menu werkt gewoon zonder aantal */ } finally { busy = false }
}

const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }

function subscribe(l: () => void) {
  listeners.add(l)
  if (listeners.size === 1) {
    void refresh(true)
    timer = setInterval(() => void refresh(), EVERY)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
  }
  return () => {
    listeners.delete(l)
    if (listeners.size === 0) {
      if (timer) clearInterval(timer)
      timer = null
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }
}

/** Aantal ongelezen in Nieuw; null zolang het niet bekend is of de mail niet gekoppeld is. */
export const useMailUnread = () => useSyncExternalStore(subscribe, () => count, () => null)
