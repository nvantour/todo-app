import { useCallback, useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { enablePush, disablePush, pushState, sendTestPush, type PushState } from '../../push/push'
import { useSession } from '../../data/session'

const WHY: Record<Extract<PushState, { kind: 'unavailable' }>['reason'], string> = {
  'no-server': 'Meldingen werken zodra de app met de server is verbonden.',
  'no-key': 'Meldingen zijn nog niet klaar gezet (de sleutel voor pushberichten ontbreekt). De stappen staan in docs/server.md.',
  unsupported: 'Deze browser kan geen meldingen ontvangen. Probeer Chrome, Edge of Safari.',
  'ios-install': 'Op iPhone en iPad werken meldingen alleen als je de app op je beginscherm zet: open het deelmenu in Safari en kies “Zet op beginscherm”. Open de app daarna vanaf het beginscherm en kom hier terug. Dit vraagt iOS 16.4 of nieuwer.',
}

/** Meldingen op dit apparaat: elke ochtend 8:00 de taken van vandaag, en een melding op het tijdstip van een taak. */
export function Notifications() {
  const session = useSession()
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)

  const refresh = useCallback(async () => setState(await pushState()), [])
  useEffect(() => {
    void refresh()
  }, [refresh, session.status])

  async function toggle(on: boolean) {
    setBusy(true)
    setMsg(null)
    try {
      if (on) await enablePush()
      else await disablePush()
      await refresh()
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    try {
      const n = await sendTestPush()
      setMsg({ text: n ? 'Testmelding verstuurd.' : 'Er is geen apparaat bereikt. Zet meldingen eerst aan.', bad: n === 0 })
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings__group" aria-labelledby="meldingen">
      <h2 id="meldingen">Meldingen</h2>
      <p className="hint-text">Elke ochtend om 8:00 één melding met de taken van vandaag, en een melding op het tijdstip van een taak waar je een tijd bij hebt gezet. Je zet dit per apparaat aan.</p>

      {state?.kind === 'unavailable' && <div className="settings__empty">{WHY[state.reason]}</div>}
      {state?.kind === 'blocked' && <div className="settings__empty">Meldingen zijn geblokkeerd voor deze app. Zet ze weer aan in de instellingen van je browser of telefoon en kom terug.</div>}

      {(state?.kind === 'off' || state?.kind === 'on') && (
        <div className="conn__row">
          <label className="rule__toggle">
            <input type="checkbox" role="switch" checked={state.kind === 'on'} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
            Meldingen op dit apparaat
          </label>
          {state.kind === 'on' && (
            <button className="btn" onClick={() => void test()} disabled={busy}>
              <BellRing size={15} /> Testmelding
            </button>
          )}
        </div>
      )}
      {msg && <div className={msg.bad ? 'conn__error' : 'conn__ok'} role="status">{msg.text}</div>}
    </section>
  )
}
