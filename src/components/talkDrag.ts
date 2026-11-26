import { useSyncExternalStore } from 'react'

/**
 * Slepen van punten bij "Om te bespreken", met pointer-events zodat het met muis én vinger werkt
 * (HTML-slepen werkt niet op een iPhone). Je pakt een punt aan het greepje; een zwevende kopie volgt je,
 * een lijntje laat zien waar het landt. Bij de rand van het scherm scrolt de lijst mee.
 */

export interface TalkDrag {
  itemId: string
  /** Groep onder de vinger/muis; null = nergens (loslaten doet dan niets). */
  groupId: string | null
  /** Het punt waarvóór het landt; null = achteraan. */
  beforeId: string | null
}

let state: TalkDrag | null = null
const listeners = new Set<() => void>()

function set(next: TalkDrag | null) {
  if (next && state && next.itemId === state.itemId && next.groupId === state.groupId && next.beforeId === state.beforeId) return
  state = next
  listeners.forEach((l) => l())
}

export function useTalkDrag(): TalkDrag | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement
}

/** Waar landt het punt als je hier loslaat? */
function targetAt(x: number, y: number, itemId: string): Pick<TalkDrag, 'groupId' | 'beforeId'> {
  const group = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-group-id]')
  if (!group) return { groupId: null, beforeId: null }
  const rows = [...group.querySelectorAll<HTMLElement>('[data-item-id]')].filter((r) => r.dataset.itemId !== itemId)
  const before = rows.find((r) => {
    const box = r.getBoundingClientRect()
    return y < box.top + box.height / 2
  })
  return { groupId: group.dataset.groupId ?? null, beforeId: before?.dataset.itemId ?? null }
}

const START_DISTANCE = 4
const EDGE = 64

/** Start op pointerdown van het greepje. `onDrop` krijgt de plek waar losgelaten is. */
export function startTalkDrag(e: React.PointerEvent<HTMLElement>, itemId: string, row: HTMLElement, onDrop: (drop: TalkDrag) => void) {
  if (e.button !== 0) return
  e.preventDefault()
  const grip = e.currentTarget
  const pointerId = e.pointerId
  try {
    grip.setPointerCapture(pointerId)
  } catch {
    /* sommige browsers weigeren dit; slepen werkt dan via window-events */
  }

  const startX = e.clientX
  const startY = e.clientY
  let x = startX
  let y = startY
  let ghost: HTMLElement | null = null
  let offsetX = 0
  let offsetY = 0
  let frame = 0
  const scroller = scrollParent(row)

  function begin() {
    const box = row.getBoundingClientRect()
    offsetX = startX - box.left
    offsetY = startY - box.top
    // De kopie staat in een eigen .block.talk zodat hij dezelfde opmaak houdt
    ghost = document.createElement('div')
    ghost.className = 'block talk talk-ghost'
    ghost.style.width = `${box.width + 32}px`
    ghost.appendChild(row.cloneNode(true))
    document.body.appendChild(ghost)
    document.body.classList.add('is-talk-dragging')
    frame = requestAnimationFrame(tick)
  }

  function place() {
    if (ghost) ghost.style.transform = `translate(${x - offsetX - 16}px, ${y - offsetY}px)`
    set({ itemId, ...targetAt(x, y, itemId) })
  }

  // meescrollen als je bij de boven- of onderrand komt
  function tick() {
    const box = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect()
    const top = Math.max(box.top, 0)
    // op de telefoon ligt de tabbalk over de onderkant van de lijst
    const bar = document.querySelector<HTMLElement>('.tabbar')?.getBoundingClientRect()
    const bottom = Math.min(box.bottom, window.innerHeight, bar && bar.height ? bar.top : Infinity)
    let dy = 0
    if (y < top + EDGE) dy = -Math.ceil(((top + EDGE - y) / EDGE) * 14)
    else if (y > bottom - EDGE) dy = Math.ceil(((y - (bottom - EDGE)) / EDGE) * 14)
    if (dy) {
      scroller.scrollTop += dy
      place()
    }
    frame = requestAnimationFrame(tick)
  }

  function move(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return
    x = ev.clientX
    y = ev.clientY
    if (!ghost) {
      if (Math.hypot(x - startX, y - startY) < START_DISTANCE) return
      begin()
    }
    ev.preventDefault()
    place()
  }

  function stop(drop: boolean) {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', key, true)
    cancelAnimationFrame(frame)
    ghost?.remove()
    document.body.classList.remove('is-talk-dragging')
    const last = state
    set(null)
    if (drop && ghost && last?.groupId) onDrop(last)
  }

  function up(ev: PointerEvent) {
    if (ev.pointerId === pointerId) stop(true)
  }
  function cancel(ev: PointerEvent) {
    if (ev.pointerId === pointerId) stop(false)
  }
  function key(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      stop(false)
    }
  }

  window.addEventListener('pointermove', move, { passive: false })
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', key, true)
}
