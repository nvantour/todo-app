import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Check, MessageSquare, TriangleAlert } from 'lucide-react'
import { apiCall, hasServer, ServerError } from '../../data/server'
import { useSession } from '../../data/session'

interface Scan {
  at: string
  found: number
  created: number
  error?: string
}

interface Status {
  configured: boolean
  connected: boolean
  email?: string
  needsReauth?: boolean
  calendar?: boolean
  chat?: boolean
  lastCalendarScan?: Scan
  lastChatScan?: Scan
}

const when = (iso: string) => new Date(iso).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Wat de terugkeer van Google ons vertelt, in gewone taal. */
function returnMessage(): { text: string; bad: boolean } | null {
  const params = new URLSearchParams(window.location.search)
  const result = params.get('google')
  if (!result) return null
  const reason = params.get('reden')
  history.replaceState(null, '', window.location.pathname)
  if (result === 'ok') return { text: 'Gekoppeld. De eerste scan draait vannacht of 7:00; je kunt hem ook nu starten.', bad: false }
  if (result === 'gedeeltelijk') return { text: 'Gekoppeld, maar je hebt niet alles toegestaan. Agenda of Chat werkt daardoor niet. Koppel opnieuw en vink alles aan.', bad: true }
  if (result === 'geweigerd') return { text: 'Je hebt de koppeling geweigerd bij Google. Er is niets veranderd.', bad: true }
  return { text: reason ? `Koppelen is niet gelukt: ${reason}` : 'Koppelen is niet gelukt. Probeer het opnieuw.', bad: true }
}

function ScanLine({ icon, name, ok, scan }: { icon: React.ReactNode; name: string; ok?: boolean; scan?: Scan }) {
  return (
    <div className="conn__row">
      <div>
        <div className="conn__name">
          {icon} {name} {ok ? <span className="pill is-ok"><Check size={12} /> Toegestaan</span> : <span className="pill is-bad">Geen toestemming</span>}
        </div>
        <div className="hint-text">
          {!scan && 'Nog niet gescand.'}
          {scan && !scan.error && `Laatste scan ${when(scan.at)}: ${scan.found} gevonden, ${scan.created} nieuw.`}
          {scan?.error && `Laatste scan ${when(scan.at)} mislukte: ${scan.error}`}
        </div>
      </div>
    </div>
  )
}

/** Google koppelen voor de agenda- en chatscan en het inplannen van taken. */
export function GoogleConnection() {
  const session = useSession()
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(() => returnMessage())

  const load = useCallback(async () => {
    try {
      setStatus(await apiCall<Status>('/google/status'))
    } catch (e) {
      // 501 = de server heeft nog geen Google-instellingen; dat tonen we als "nog niet klaar"
      if (e instanceof ServerError && e.status === 501) setStatus({ configured: false, connected: false })
      else setNote({ text: (e as Error).message, bad: true })
    }
  }, [])

  useEffect(() => {
    if (hasServer() && session.status === 'signedIn') void load()
  }, [load, session.status])

  async function run<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(what)
    setNote(null)
    try {
      return await fn()
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(null)
    }
  }

  const connect = () =>
    run('connect', async () => {
      const { url } = await apiCall<{ url: string }>('/google/connect', { method: 'POST' })
      window.location.assign(url)
    })

  const scan = (kind: 'calendar' | 'chat') =>
    run(kind, async () => {
      const r = await apiCall<{ found: number; created: number }>(`/scan/${kind}`, { method: 'POST' })
      setNote({ text: r.created ? `${r.created} nieuw voorstel${r.created === 1 ? '' : 'len'} gevonden.` : r.found ? 'Alles wat is gevonden, stond al in je voorstellen.' : 'Niets gevonden.', bad: false })
      await load()
    })

  const disconnect = () => {
    if (!window.confirm('Google ontkoppelen? De scans stoppen en de toegang wordt bij Google ingetrokken. Bestaande voorstellen en taken blijven staan.')) return
    void run('disconnect', async () => {
      await apiCall('/google', { method: 'DELETE' })
      setNote({ text: 'Ontkoppeld.', bad: false })
      await load()
    })
  }

  if (!hasServer() || session.status === 'local') {
    return (
      <section className="settings__group" aria-labelledby="google">
        <h2 id="google">Agenda en Chat</h2>
        <div className="settings__empty">Koppelen met Google werkt zodra de app met de server is verbonden.</div>
      </section>
    )
  }

  return (
    <section className="settings__group" aria-labelledby="google">
      <h2 id="google">Agenda en Chat</h2>
      <p className="hint-text">
        Na koppelen bekijkt de app elke ochtend je agenda van de komende twee weken en twee keer per werkdag je Google Chat. Wat er gevonden wordt, komt
        als <Link to="/voorstellen">voorstel</Link> in je inbox; er wordt nooit zelf een taak gemaakt. De app leest je agenda en chats alleen en kan
        afspraken aanmaken om taken in te plannen.
      </p>

      {note && (
        <div className={note.bad ? 'conn__error' : 'conn__ok'} role="status">
          {note.text}
        </div>
      )}

      {status && !status.configured && (
        <div className="settings__empty">Dit is nog niet ingesteld op de server (client-id en -geheim van Google). De stappen staan in docs/server.md.</div>
      )}

      {status?.configured && !status.connected && (
        <button className="btn is-primary" onClick={() => void connect()} disabled={busy !== null}>
          <CalendarDays size={15} /> Agenda en Chat koppelen
        </button>
      )}

      {status?.connected && (
        <>
          <div className="conn__row">
            <div>
              <div className="conn__name">Gekoppeld als {status.email}</div>
              {status.needsReauth && (
                <div className="conn__error">
                  <TriangleAlert size={13} /> De koppeling is verlopen of ingetrokken. Koppel opnieuw.
                </div>
              )}
            </div>
            {status.needsReauth ? (
              <button className="btn is-primary" onClick={() => void connect()} disabled={busy !== null}>
                Opnieuw koppelen
              </button>
            ) : (
              <button className="btn is-quiet-danger" onClick={disconnect} disabled={busy !== null}>
                Ontkoppelen
              </button>
            )}
          </div>

          <ScanLine icon={<CalendarDays size={14} />} name="Agenda" ok={status.calendar} scan={status.lastCalendarScan} />
          <ScanLine icon={<MessageSquare size={14} />} name="Google Chat" ok={status.chat} scan={status.lastChatScan} />

          {!status.needsReauth && (
            <div className="conn__actions">
              <button className="btn" onClick={() => void scan('calendar')} disabled={busy !== null || !status.calendar}>
                {busy === 'calendar' ? 'Bezig…' : 'Agenda nu scannen'}
              </button>
              <button className="btn" onClick={() => void scan('chat')} disabled={busy !== null || !status.chat}>
                {busy === 'chat' ? 'Bezig…' : 'Chat nu scannen'}
              </button>
              {(!status.calendar || !status.chat) && (
                <button className="btn" onClick={() => void connect()} disabled={busy !== null}>
                  Opnieuw koppelen
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
