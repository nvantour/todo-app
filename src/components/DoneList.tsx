import { useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { store, useAppData } from '../data/store'
import { completedTodos } from '../lib/selectors'
import { formatDue, todayISO } from '../lib/dates'

/** Inklapbare groep onderaan "Taken": wat de laatste 30 dagen is afgevinkt. Terugzetten kan. */
export function DoneList() {
  const data = useAppData()
  const [open, setOpen] = useState(false)
  const today = todayISO()
  const done = completedTodos(data, today)
  if (!done.length) return null

  return (
    <section className="section done">
      <button className="section__head done__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={16} className={open ? 'is-open' : ''} />
        Afgerond <span>{done.length}</span>
      </button>
      {open && <p className="done__note">De laatste 30 dagen</p>}
      {open &&
        done.map((t) => (
          <div key={t.id} className="item is-done-row">
            <button className="check is-done" aria-label={`Terugzetten: ${t.title}`} title="Terugzetten" onClick={() => store.toggleTodo(t.id)}>
              <Check size={12} strokeWidth={3.5} />
            </button>
            <div className="item__body">
              <span className="item__title is-static">{t.title}</span>
              <span className="tag is-plain">{formatDue((t.completedAt ?? '').slice(0, 10), today)}</span>
            </div>
          </div>
        ))}
    </section>
  )
}
