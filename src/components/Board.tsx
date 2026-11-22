import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import type { TaskStatus, Todo } from '../model/types'
import { store, useAppData } from '../data/store'
import { addStatus, boardColumns, canDeleteStatus, deleteStatus, FINISHED_DAYS, moveChanges, moveStatus, renameStatus, statusList, statusOf } from '../data/board'
import { formatDue } from '../lib/dates'
import { openDetail } from '../ui/overlays'
import { AddLine } from './AddLine'

/** Taak naar een kolom zetten; Finished = afvinken (een terugkerende taak schuift dan door). */
function moveTo(todo: Todo, target: TaskStatus) {
  const { toggle, patch } = moveChanges(todo, target)
  if (Object.keys(patch).length) store.updateTodo(todo.id, patch)
  if (toggle) store.toggleTodo(todo.id)
}

/** Kanban-bord bij Taken: een kolom per status, slepen of de keuzelijst op de kaart om te wisselen. */
export function Board() {
  const data = useAppData()
  const columns = boardColumns(data)
  const list = statusList(data)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const project = (id: string | null) => data.projects.find((p) => p.id === id)

  function drop(statusId: string) {
    const todo = data.todos.find((t) => t.id === dragging)
    const target = list.find((s) => s.id === statusId)
    if (todo && target && statusOf(todo, list) !== statusId) moveTo(todo, target)
    setDragging(null)
    setOver(null)
  }

  function add() {
    const next = addStatus(list, newName)
    if (!next) return
    store.setStatuses(next)
    setNewName('')
  }

  return (
    <div className="board" aria-label="Bord">
      {columns.map(({ status, todos }) => (
        <section
          key={status.id}
          className={`board__col${over === status.id && dragging ? ' is-over' : ''}`}
          aria-label={status.name}
          onDragOver={(e) => {
            if (!dragging) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (over !== status.id) setOver(status.id)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            drop(status.id)
          }}
        >
          <ColumnHead status={status} count={todos.length} list={list} />
          {status.kind === 'done' && <p className="board__hint">Afgevinkt, laatste {FINISHED_DAYS} dagen</p>}
          <div className="board__cards">
            {todos.map((t) => {
              const p = project(t.projectId)
              return (
                <article
                  key={t.id}
                  className={`card${t.done ? ' is-done' : ''}${dragging === t.id ? ' is-dragging' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    setDragging(t.id)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', t.id)
                  }}
                  onDragEnd={() => {
                    setDragging(null)
                    setOver(null)
                  }}
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('select')) openDetail(t.id)
                  }}
                >
                  <div className="card__title">{t.title}</div>
                  <div className="card__meta">
                    {p && (
                      <span className="tag" style={{ '--c': p.color } as React.CSSProperties}>
                        <i />
                        {p.name}
                      </span>
                    )}
                    {t.due && !t.done && <span className="tag is-plain">{formatDue(t.due)}</span>}
                    <select
                      className="card__status"
                      aria-label={`Status van ${t.title}`}
                      value={statusOf(t, list)}
                      onChange={(e) => {
                        const target = list.find((s) => s.id === e.target.value)
                        if (target) moveTo(t, target)
                      }}
                    >
                      {list.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </article>
              )
            })}
          </div>
          {status.kind === 'open' && <AddLine defaults={{ bucket: 'now', statusId: status.id }} placeholder="Nieuwe taak" />}
        </section>
      ))}

      <form
        className="board__col board__new"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nieuwe status, bv. Wacht op klant" aria-label="Nieuwe status" autoComplete="off" />
        <button type="submit" className="btn" disabled={!newName.trim()}>
          <Plus size={15} /> Status
        </button>
      </form>
    </div>
  )
}

/** Kop van een kolom: naam (klik om te hernoemen), aantal, verplaatsen en verwijderen. */
function ColumnHead({ status, count, list }: { status: TaskStatus; count: number; list: TaskStatus[] }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(status.name)
  const open = list.filter((s) => s.kind === 'open')
  const index = open.findIndex((s) => s.id === status.id)

  function save() {
    setEditing(false)
    if (name.trim() && name.trim() !== status.name) store.setStatuses(renameStatus(list, status.id, name))
    else setName(status.name)
  }

  function remove() {
    const msg = count
      ? `Status “${status.name}” verwijderen? De ${count} ${count === 1 ? 'taak gaat' : 'taken gaan'} naar “${open.find((s) => s.id !== status.id)?.name}”.`
      : `Status “${status.name}” verwijderen?`
    if (window.confirm(msg)) store.setStatuses(deleteStatus(list, status.id))
  }

  return (
    <header className="board__head">
      {editing ? (
        <input
          className="board__rename"
          value={name}
          autoFocus
          aria-label="Naam van de status"
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setName(status.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <button className="board__name" onClick={() => setEditing(true)} title="Klik om te hernoemen">
          {status.name}
        </button>
      )}
      <span className="board__count">{count}</span>
      {status.kind === 'open' && (
        <span className="board__tools">
          <button className="icon-btn" aria-label={`${status.name} naar links`} disabled={index <= 0} onClick={() => store.setStatuses(moveStatus(list, status.id, -1))}>
            <ChevronLeft size={15} />
          </button>
          <button className="icon-btn" aria-label={`${status.name} naar rechts`} disabled={index >= open.length - 1} onClick={() => store.setStatuses(moveStatus(list, status.id, 1))}>
            <ChevronRight size={15} />
          </button>
          {canDeleteStatus(list, status.id) && (
            <button className="icon-btn" aria-label={`${status.name} verwijderen`} onClick={remove}>
              <Trash2 size={14} />
            </button>
          )}
        </span>
      )}
    </header>
  )
}
