import { useEffect, useRef, useState } from 'react'
import { CalendarPlus, Database, ExternalLink, Trash2, X } from 'lucide-react'
import type { Recurrence, Todo } from '../model/types'
import { store, useAppData } from '../data/store'
import { attachAirtable } from '../data/airtable'
import { apiCall, hasServer } from '../data/server'
import { useSession } from '../data/session'
import { parseAirtableUrl } from '../lib/airtable'
import { describeRecurrence, todayISO } from '../lib/dates'
import { effectiveBucket } from '../lib/selectors'
import { SOURCE_ICON, SOURCE_NAME, isInternal } from '../lib/sources'
import { SourceLink } from './SourceLink'
import { closeDetail, useOverlays } from '../ui/overlays'
import { Panel } from './Panel'

/** Vaste keuzes voor herhaling, in gewone taal. Alles wat daarbuiten valt, blijft als eigen regel staan. */
const PRESETS: Array<{ key: string; rule: Recurrence }> = [
  { key: 'day', rule: { freq: 'day', interval: 1 } },
  { key: 'workdays', rule: { freq: 'week', interval: 1, weekdays: [1, 2, 3, 4, 5] } },
  { key: 'week', rule: { freq: 'week', interval: 1 } },
  { key: 'twoweeks', rule: { freq: 'week', interval: 2 } },
  { key: 'month', rule: { freq: 'month', interval: 1 } },
  { key: 'year', rule: { freq: 'year', interval: 1 } },
]

const sameRule = (a: Recurrence, b: Recurrence) =>
  a.freq === b.freq && a.interval === b.interval && (a.weekdays ?? []).join() === (b.weekdays ?? []).join()

function recurrenceKey(rule: Recurrence | null): string {
  if (!rule) return 'none'
  return PRESETS.find((p) => sameRule(p.rule, rule))?.key ?? 'custom'
}

export function TaskDetail() {
  const { detailId } = useOverlays()
  const todo = useAppData().todos.find((t) => t.id === detailId)
  if (!todo) return null
  return <DetailPanel key={todo.id} todo={todo} />
}

function DetailPanel({ todo }: { todo: Todo }) {
  const data = useAppData()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const today = todayISO()
  const patch = (p: Partial<Todo>) => store.updateTodo(todo.id, p)

  const SourceIcon = SOURCE_ICON[todo.source.type]
  const showSource = todo.source.type !== 'manual'
  const sourceLabel = todo.source.label || SOURCE_NAME[todo.source.type]
  const recKey = recurrenceKey(todo.recurrence)

  function setRecurrence(key: string) {
    if (key === 'custom') return
    const rule = PRESETS.find((p) => p.key === key)?.rule ?? null
    // een herhaling heeft een startdatum nodig
    patch({ recurrence: rule, ...(rule && !todo.due ? { due: today } : {}) })
  }

  return (
    <Panel
      title="Taak"
      onClose={closeDetail}
      footer={
        confirmDelete ? (
          <div className="confirm">
            <span>Deze taak echt verwijderen?</span>
            <button className="btn is-danger" onClick={() => { store.deleteTodo(todo.id); closeDetail() }}>
              Ja, verwijder
            </button>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              Nee
            </button>
          </div>
        ) : (
          <button className="btn is-quiet-danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={15} /> Verwijderen
          </button>
        )
      }
    >
      <TextField label="Titel" value={todo.title} onSave={(title) => title.trim() && patch({ title: title.trim() })} />
      <TextField label="Notitie" multiline value={todo.note} placeholder="Typ hier een notitie" onSave={(note) => patch({ note })} />

      <label className="field">
        <span>Klant</span>
        <select value={todo.projectId ?? ''} onChange={(e) => patch({ projectId: e.target.value || null })}>
          <option value="">Geen klant (Overig)</option>
          {data.projects
            .filter((p) => !p.archived || p.id === todo.projectId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archived ? ' (gearchiveerd)' : ''}
              </option>
            ))}
        </select>
      </label>

      <div className="field-row">
        <label className="field">
          <span>Datum</span>
          <span className="field__with-clear">
            <input type="date" value={todo.due ?? ''} onChange={(e) => patch({ due: e.target.value || null, ...(e.target.value ? {} : { dueTime: null }) })} />
            {todo.due && (
              <button className="icon-btn" aria-label="Datum wissen" onClick={() => patch({ due: null, dueTime: null })}>
                <X size={15} />
              </button>
            )}
          </span>
        </label>
        <label className="field">
          <span>Tijd</span>
          <input
            type="time"
            value={todo.dueTime ?? ''}
            disabled={!todo.due}
            onChange={(e) => patch({ dueTime: e.target.value || null })}
          />
        </label>
      </div>

      <label className="field">
        <span>Herhalen</span>
        <select value={recKey} onChange={(e) => setRecurrence(e.target.value)}>
          <option value="none">Niet herhalen</option>
          <option value="day">Elke dag</option>
          <option value="workdays">Elke werkdag</option>
          <option value="week">Elke week</option>
          <option value="twoweeks">Elke 2 weken</option>
          <option value="month">Elke maand</option>
          <option value="year">Elk jaar</option>
          {recKey === 'custom' && todo.recurrence && <option value="custom">{describeRecurrence(todo.recurrence)}</option>}
        </select>
      </label>

      <div className="field">
        <span>Wanneer</span>
        <div className="seg" role="group" aria-label="Wanneer">
          <button className={todo.bucket === 'now' ? 'is-on' : ''} onClick={() => patch({ bucket: 'now' })}>
            Vandaag
          </button>
          <button className={todo.bucket === 'later' ? 'is-on' : ''} onClick={() => patch({ bucket: 'later' })}>
            Om niet te vergeten
          </button>
        </div>
        {todo.bucket === 'later' && effectiveBucket(todo, today) === 'now' && (
          <small>De datum is aangebroken, dus de taak staat nu bij “Vandaag”.</small>
        )}
      </div>

      <ScheduleField todo={todo} />

      {showSource && (
        <div className="field">
          <span>Bron</span>
          {todo.source.url ? (
            <SourceLink source={todo.source} className="source-link">
              {SourceIcon && <SourceIcon size={14} />}
              {sourceLabel}
              {!isInternal(todo.source.url) && <ExternalLink size={13} />}
            </SourceLink>
          ) : (
            <span className="source-link is-plain">
              {SourceIcon && <SourceIcon size={14} />}
              {sourceLabel}
            </span>
          )}
        </div>
      )}
      <AirtableField todo={todo} />
    </Panel>
  )
}

const MINUTES = [30, 60, 90, 120]

/** Zoekt in de agenda het eerstvolgende vrije blok en zet daar een afspraak voor deze taak. */
function ScheduleField({ todo }: { todo: Todo }) {
  const session = useSession()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  if (!hasServer() || session.status !== 'signedIn' || todo.done) return null

  async function plan(minutes: number) {
    setBusy(true)
    setNote(null)
    try {
      const r = await apiCall<{ start: string; afterDue: boolean }>(`/todos/${encodeURIComponent(todo.id)}/schedule`, {
        method: 'POST',
        body: JSON.stringify({ minutes, replace: Boolean(todo.calendarEventId) }),
      })
      const at = new Date(r.start).toLocaleString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
      setNote({ text: `Ingepland: ${at}, ${minutes} minuten.${r.afterDue ? ' Let op: dit is na de datum van de taak.' : ''}`, bad: false })
      setOpen(false)
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field">
      <span>Agenda</span>
      {todo.calendarEventId && !note && <small>Deze taak staat al in je agenda.</small>}
      {!open ? (
        <button className="btn" onClick={() => setOpen(true)} disabled={busy}>
          <CalendarPlus size={15} /> {todo.calendarEventId ? 'Opnieuw inplannen' : 'Plan in agenda'}
        </button>
      ) : (
        <div className="seg" role="group" aria-label="Hoe lang">
          {MINUTES.map((m) => (
            <button key={m} onClick={() => void plan(m)} disabled={busy}>
              {m} min
            </button>
          ))}
        </div>
      )}
      {busy && <p className="schedule__note">Vrij moment zoeken…</p>}
      {note && (
        <p className={`schedule__note${note.bad ? ' is-error' : ''}`} role="status">
          {note.text}
        </p>
      )}
    </div>
  )
}

/** Een Airtable-link plakken: wordt de bron van de taak, met de naam van het record erbij als de server dat kan ophalen. */
function AirtableField({ todo }: { todo: Todo }) {
  const [text, setText] = useState('')
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  async function add(raw = text) {
    if (!raw.trim()) return
    const ref = parseAirtableUrl(raw)
    if (!ref) {
      setNote({ text: 'Dit is geen link naar een Airtable-record.', bad: true })
      return
    }
    setBusy(true)
    const r = await attachAirtable(todo.id, ref)
    setBusy(false)
    setText('')
    setNote({ text: r === 'named' ? 'Link toegevoegd met de naam van het record.' : 'Link toegevoegd.', bad: false })
  }

  return (
    <div className="field">
      <span>{todo.source.type === 'airtable' ? 'Andere Airtable-link' : 'Airtable-link'}</span>
      <span className="field-inline">
        <input
          value={text}
          placeholder="Plak hier een link naar een record"
          inputMode="url"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            // een geplakte link wordt meteen toegevoegd
            const pasted = e.clipboardData.getData('text')
            if (parseAirtableUrl(pasted)) {
              e.preventDefault()
              void add(pasted)
            }
          }}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <button className="btn" onClick={() => void add()} disabled={busy || !text.trim()}>
          <Database size={15} /> Toevoegen
        </button>
      </span>
      {note && (
        <small style={note.bad ? { color: 'var(--danger)' } : undefined} role="status">
          {note.text}
        </small>
      )}
    </div>
  )
}

interface TextFieldProps {
  label: string
  value: string
  onSave: (value: string) => void
  multiline?: boolean
  placeholder?: string
}

/** Typen is lokaal; opgeslagen wordt bij het verlaten van het veld of het sluiten van het paneel (niet per toetsslag). */
function TextField({ label, value, onSave, multiline, placeholder }: TextFieldProps) {
  const [text, setText] = useState(value)
  const latest = useRef(value)
  const saved = useRef(value)
  const save = useRef(onSave)

  useEffect(() => {
    save.current = onSave
  })
  // paneel dicht met onopgeslagen tekst: alsnog bewaren
  useEffect(
    () => () => {
      if (latest.current !== saved.current) save.current(latest.current)
    },
    [],
  )

  function commit() {
    if (latest.current === saved.current) return
    saved.current = latest.current
    onSave(latest.current)
  }
  const change = (v: string) => {
    latest.current = v
    setText(v)
  }

  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea rows={4} value={text} placeholder={placeholder} onChange={(e) => change(e.target.value)} onBlur={commit} />
      ) : (
        <input value={text} placeholder={placeholder} onChange={(e) => change(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      )}
    </label>
  )
}
