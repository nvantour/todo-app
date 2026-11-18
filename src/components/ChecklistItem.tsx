import { useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpToLine, CalendarPlus, Check, MoreHorizontal, Repeat, StickyNote } from 'lucide-react'
import type { Project, Todo } from '../model/types'
import { store } from '../data/store'
import { describeRecurrence, formatDue, todayISO } from '../lib/dates'
import { effectiveBucket } from '../lib/selectors'
import { SOURCE_ICON } from '../lib/sources'
import { openDetail } from '../ui/overlays'

interface Props {
  todo: Todo
  project?: Project
  /** In een klant-blok is de klantnaam overbodig. */
  hideProject?: boolean
  /** Toon een stip als de taak "om niet te vergeten" is (voor het raster). */
  markLater?: boolean
}

export function ChecklistItem({ todo, project, hideProject, markLater }: Props) {
  const [completing, setCompleting] = useState(false)
  const dateInput = useRef<HTMLInputElement>(null)
  const today = todayISO()
  const SourceIcon = SOURCE_ICON[todo.source.type]
  const bucket = effectiveBucket(todo, today)

  function complete() {
    if (completing) return
    setCompleting(true)
    window.setTimeout(() => {
      store.toggleTodo(todo.id)
      setCompleting(false)
    }, 380)
  }

  // Tekst bewerk je zoals in Notes: klik erin en typ. Leeg maken = weggooien.
  function saveTitle(el: HTMLElement) {
    const title = (el.textContent ?? '').trim()
    if (!title) store.deleteTodo(todo.id)
    else if (title !== todo.title) store.updateTodo(todo.id, { title })
  }

  return (
    <div
      id={`todo-${todo.id}`}
      className={`item${completing ? ' is-completing' : ''}${markLater && bucket === 'later' ? ' is-later' : ''}`}
      // klik naast de tekst en de knoppen opent het detail
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button, input, .item__title, a')) openDetail(todo.id)
      }}
    >
      <button className={`check${completing ? ' is-done' : ''}`} aria-label={`Afvinken: ${todo.title}`} onClick={complete}>
        <Check size={12} strokeWidth={3.5} />
      </button>

      <div className="item__body">
        <span
          className="item__title"
          role="textbox"
          aria-label="Taak"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={(e) => saveTitle(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              e.currentTarget.textContent = todo.title
              e.currentTarget.blur()
            }
          }}
        >
          {todo.title}
        </span>

        <span className="item__tags">
          {project && !hideProject && (
            <span className="tag" style={{ '--c': project.color } as React.CSSProperties}>
              <i />
              {project.name}
            </span>
          )}
          {SourceIcon && (
            <span className="tag is-source" title={todo.source.label}>
              <SourceIcon size={12} />
              <span>{todo.source.label}</span>
            </span>
          )}
          {todo.recurrence && (
            <span className="tag is-plain" title={describeRecurrence(todo.recurrence)}>
              <Repeat size={12} />
            </span>
          )}
          {todo.note && (
            <span className="tag is-plain" title="Heeft een notitie">
              <StickyNote size={12} />
            </span>
          )}
        </span>
      </div>

      <div className="item__side">
        <button className="item__move" aria-label={`Meer over: ${todo.title}`} title="Details" onClick={() => openDetail(todo.id)}>
          <MoreHorizontal size={15} />
        </button>
        <button
          className="item__move"
          aria-label={todo.bucket === 'now' ? 'Naar niet vergeten' : 'Naar nu doen'}
          title={todo.bucket === 'now' ? 'Naar “Om niet te vergeten”' : 'Naar “Om nu te doen”'}
          onClick={() => store.updateTodo(todo.id, { bucket: todo.bucket === 'now' ? 'later' : 'now' })}
        >
          {todo.bucket === 'now' ? <ArrowDownToLine size={15} /> : <ArrowUpToLine size={15} />}
        </button>
        <button
          className={`date${todo.due ? (todo.due < today ? ' is-overdue' : todo.due === today ? ' is-today' : ' is-set') : ''}`}
          aria-label={todo.due ? `Datum: ${formatDue(todo.due, today)}` : 'Datum kiezen'}
          title="Datum kiezen"
          onClick={() => dateInput.current?.showPicker()}
        >
          {todo.due ? [formatDue(todo.due, today), todo.dueTime].filter(Boolean).join(' ') : <CalendarPlus size={15} />}
          <input
            ref={dateInput}
            type="date"
            tabIndex={-1}
            aria-hidden
            value={todo.due ?? ''}
            onChange={(e) => store.updateTodo(todo.id, { due: e.target.value || null })}
          />
        </button>
      </div>
    </div>
  )
}
