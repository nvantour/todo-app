import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Loader2, Mic, RotateCcw, Square, Trash2, X } from 'lucide-react'
import { store, useAppData } from '../data/store'
import { formatDue } from '../lib/dates'
import type { Project } from '../model/types'
import { analyse, type Analysis, type Draft } from './capture'
import { apiBase } from './capabilities'
import { isBusy, type VoiceErrorKind } from './voiceMachine'
import { useVoice } from './useVoice'

const ERRORS: Record<VoiceErrorKind, string> = {
  denied: 'De microfoon is geblokkeerd. Zet hem aan in de instellingen van je browser of telefoon en probeer het opnieuw.',
  'no-mic': 'Ik vind geen microfoon. Sluit er een aan of typ je taken hieronder.',
  offline: 'Geen verbinding. Probeer het opnieuw zodra je online bent, of typ je taken hieronder.',
  silence: 'Ik heb niets gehoord. Probeer het nog een keer, of typ je taken hieronder.',
  unsupported: 'Inspreken werkt hier niet. Typ je taken hieronder, dan sorteer ik ze.',
  failed: 'Het uitschrijven is mislukt. Probeer het opnieuw of typ je taken hieronder.',
}

const FOCUSABLE = 'button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function VoiceSheet({ onClose }: { onClose: () => void }) {
  const data = useAppData()
  const projects = data.projects.filter((p) => !p.archived)
  const { state, mode, start, stop, cancel, retry, setText } = useVoice()
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [analysing, setAnalysing] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)

  // meteen beginnen met luisteren; sluiten laat de microfoon los (de hook ruimt zelf op)
  useEffect(() => {
    if (mode !== 'none') start()
  }, [mode, start])

  // opening: focus naar het venster, bij sluiten terug naar waar je was
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => before?.focus?.()
  }, [])

  const text = state.text
  const done = state.status === 'done'

  // Klaar met praten: laat de tekst splitsen en herkennen.
  useEffect(() => {
    if (!done || !text.trim()) return
    let alive = true
    setAnalysing(true)
    analyse(text, projects).then((result) => {
      if (!alive) return
      setAnalysis(result)
      setDrafts(result.drafts)
      setAnalysing(false)
    })
    return () => {
      alive = false
    }
    // alleen opnieuw als de gehoorde tekst verandert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, text])

  function submitTyped() {
    if (!text.trim() || analysing) return
    setAnalysing(true)
    analyse(text, projects).then((result) => {
      setAnalysis(result)
      setDrafts(result.drafts)
      setAnalysing(false)
    })
  }

  function again() {
    setAnalysis(null)
    setDrafts([])
    setAnalysing(false)
    if (mode === 'none') cancel()
    else start()
  }

  function addAll() {
    drafts
      .filter((d) => d.title.trim())
      .forEach((d) =>
        store.addTodo({
          title: d.title.trim(),
          due: d.due,
          dueTime: d.dueTime,
          recurrence: d.recurrence,
          projectId: d.projectId,
          bucket: d.bucket,
          source: { type: 'voice' },
        }),
      )
    onClose()
  }

  const patch = (key: string, p: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)))

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !dialog.current) return
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const reviewing = analysis !== null && !analysing

  return (
    <div className="vs-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="vs"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vs-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="vs__head">
          <h2 id="vs-title">{reviewing ? 'Dit heb ik gehoord' : 'Inspreken'}</h2>
          <button type="button" className="vs-icon" aria-label="Sluiten" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {reviewing ? (
          <Review
            analysis={analysis}
            drafts={drafts}
            projects={projects}
            heard={text}
            patch={patch}
            remove={(key) => setDrafts((ds) => ds.filter((d) => d.key !== key))}
            onAgain={again}
            onAdd={addAll}
          />
        ) : (
          <Capture
            state={state}
            mode={mode}
            analysing={analysing}
            onToggle={() => (isBusy(state.status) ? stop() : start())}
            onRetry={retry}
            onText={setText}
            onSubmit={submitTyped}
          />
        )}
      </div>
    </div>
  )
}

function statusLine(status: ReturnType<typeof useVoice>['state']['status'], mode: string, analysing: boolean): string {
  if (analysing) return 'Ik zoek de taken erin…'
  switch (status) {
    case 'requesting':
      return 'Microfoon aanzetten…'
    case 'listening':
      return 'Ik luister. Tik als je klaar bent.'
    case 'finishing':
      return 'Even afronden…'
    case 'transcribing':
      return 'Even uitschrijven…'
    default:
      return mode === 'none' ? 'Typ je taken hieronder.' : 'Tik op de microfoon en vertel je taken.'
  }
}

function Capture(props: {
  state: ReturnType<typeof useVoice>['state']
  mode: ReturnType<typeof useVoice>['mode']
  analysing: boolean
  onToggle: () => void
  onRetry: () => void
  onText: (t: string) => void
  onSubmit: () => void
}) {
  const { state, mode, analysing } = props
  const busy = isBusy(state.status) || analysing
  const live = state.status === 'listening' || state.status === 'finishing'
  const working = state.status === 'requesting' || state.status === 'transcribing' || analysing
  const shown = [state.text, state.interim].filter(Boolean).join(' ')

  return (
    <div className="vs__body">
      {mode !== 'none' && (
        <>
          <button
            type="button"
            className={`vs-mic${live ? ' is-live' : ''}`}
            aria-label={live ? 'Stoppen met opnemen' : 'Beginnen met opnemen'}
            aria-pressed={live}
            disabled={state.status === 'transcribing' || analysing}
            onClick={props.onToggle}
          >
            {working ? <Loader2 size={30} className="vs-spin" /> : live ? <Square size={26} fill="currentColor" /> : <Mic size={32} />}
          </button>
          <p className="vs-status" role="status" aria-live="polite">
            {statusLine(state.status, mode, analysing)}
          </p>
        </>
      )}
      {mode === 'none' && state.status !== 'error' && <p className="vs-status">{statusLine(state.status, mode, analysing)}</p>}

      {state.error && (
        <div className="vs-error" role="alert">
          <p>{ERRORS[state.error]}</p>
          {state.error !== 'unsupported' && mode !== 'none' && (
            <button type="button" className="vs-btn" onClick={props.onRetry}>
              <RotateCcw size={15} /> Opnieuw proberen
            </button>
          )}
        </div>
      )}

      {live ? (
        <div className="vs-live" aria-live="off">
          {shown || <span className="vs-hint">Bijvoorbeeld: bel de developer van Keesing en morgen het deck voor Wehkamp afmaken</span>}
        </div>
      ) : (
        <textarea
          className="vs-text"
          rows={3}
          value={state.text}
          disabled={state.status === 'transcribing' || analysing}
          onChange={(e) => props.onText(e.target.value)}
          placeholder="Of typ hier je taken, meerdere mag"
          aria-label="Tekst van je taken"
        />
      )}

      {!live && (
        <div className="vs__foot">
          <button type="button" className="vs-btn is-primary" disabled={busy || !state.text.trim()} onClick={props.onSubmit}>
            Taken maken
          </button>
        </div>
      )}
    </div>
  )
}

function Review(props: {
  analysis: Analysis
  drafts: Draft[]
  projects: Project[]
  heard: string
  patch: (key: string, p: Partial<Draft>) => void
  remove: (key: string) => void
  onAgain: () => void
  onAdd: () => void
}) {
  const { drafts, projects } = props
  const ready = drafts.filter((d) => d.title.trim()).length

  return (
    <div className="vs__body">
      <p className="vs-heard">“{props.heard}”</p>

      {drafts.length === 0 ? (
        <p className="vs-status">Ik heb geen taken herkend. Probeer het nog een keer.</p>
      ) : (
        <ul className="vs-list">
          {drafts.map((d) => {
            const project = projects.find((p) => p.id === d.projectId)
            return (
              <li key={d.key} className="vs-row">
                <input
                  className="vs-row__title"
                  value={d.title}
                  onChange={(e) => props.patch(d.key, { title: e.target.value })}
                  aria-label="Titel van de taak"
                  autoComplete="off"
                />
                <div className="vs-row__meta">
                  <label className={`vs-chip${project ? ' is-set' : ''}`}>
                    <span className="vs-dot" style={{ background: project?.color ?? 'var(--p4)' }} />
                    <span>{project?.name ?? 'Geen klant'}</span>
                    <select
                      aria-label="Klant"
                      value={d.projectId ?? ''}
                      onChange={(e) => props.patch(d.key, { projectId: e.target.value || null })}
                    >
                      <option value="">Geen klant</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className={`vs-chip${d.due ? ' is-set' : ''}`}>
                    <CalendarDays size={14} />
                    <span>{d.due ? `${formatDue(d.due)}${d.dueTime ? ` ${d.dueTime}` : ''}` : 'Geen datum'}</span>
                    <input
                      type="date"
                      aria-label="Datum"
                      value={d.due ?? ''}
                      onClick={(e) => (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()}
                      onChange={(e) => props.patch(d.key, { due: e.target.value || null, dueTime: e.target.value ? d.dueTime : null })}
                    />
                  </label>

                  <div className="vs-seg" role="group" aria-label="Wanneer">
                    <button type="button" aria-pressed={d.bucket === 'now'} onClick={() => props.patch(d.key, { bucket: 'now' })}>
                      Nu
                    </button>
                    <button type="button" aria-pressed={d.bucket === 'later'} onClick={() => props.patch(d.key, { bucket: 'later' })}>
                      Niet vergeten
                    </button>
                  </div>

                  <button type="button" className="vs-icon vs-row__remove" aria-label="Taak weghalen" onClick={() => props.remove(d.key)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {props.analysis.via === 'lokaal' && apiBase() && drafts.length > 0 && (
        <p className="vs-note">Gesplitst met vaste regels, want de slimme versie was niet bereikbaar. Controleer de taken even.</p>
      )}

      <div className="vs__foot">
        <button type="button" className="vs-btn" onClick={props.onAgain}>
          <Mic size={15} /> Opnieuw
        </button>
        <button type="button" className="vs-btn is-primary" disabled={ready === 0} onClick={props.onAdd}>
          Toevoegen{ready > 1 ? ` (${ready})` : ''}
        </button>
      </div>
    </div>
  )
}
