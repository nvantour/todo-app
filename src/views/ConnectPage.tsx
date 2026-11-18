import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ListChecks } from 'lucide-react'
import { getIdToken, useSession } from '../data/session'

// De velden die de server terug wil zien; zelfde lijst als HIDDEN in functions/src/oauth.ts.
const FIELDS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource']

/**
 * Toestemming geven aan een andere app (de Claude-app) om bij je taken te kunnen.
 * De server stuurt je hierheen vanuit /oauth/authorize; omdat je in de app al bent ingelogd,
 * hoef je alleen op Toestaan te klikken. De app stuurt dan je inlogbewijs mee terug naar de server.
 */
export function ConnectPage() {
  const [params] = useSearchParams()
  const { user } = useSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = params.get('client_name') || 'Een andere app'
  const host = params.get('redirect_host')
  const valid = Boolean(params.get('client_id') && params.get('redirect_uri') && params.get('code_challenge'))

  async function answer(action: 'allow' | 'deny') {
    setBusy(true)
    setError(null)
    const idToken = action === 'allow' ? await getIdToken() : null
    if (action === 'allow' && !idToken) {
      setBusy(false)
      setError('Je inlog is verlopen. Ververs de pagina en log opnieuw in.')
      return
    }
    // Gewoon formulier (geen fetch): de server antwoordt met een doorverwijzing terug naar de andere app.
    const form = document.createElement('form')
    form.method = 'post'
    form.action = '/oauth/authorize'
    const add = (key: string, value: string) => {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = key
      input.value = value
      form.appendChild(input)
    }
    for (const key of FIELDS) add(key, params.get(key) ?? '')
    add('action', action)
    if (idToken) add('id_token', idToken)
    document.body.appendChild(form)
    form.submit()
  }

  return (
    <div className="login">
      <div className="login__card">
        <span className="login__logo">
          <ListChecks size={24} />
        </span>
        <h1>Koppelen met je taken</h1>
        {valid ? (
          <>
            <p>
              <strong>{name}</strong> vraagt toegang tot je taken: lezen, toevoegen, aanpassen en afvinken.
            </p>
            <p className="hint-text">
              {host ? `Na toestemming ga je terug naar ${host}. ` : ''}
              Ingelogd als {user?.email ?? 'onbekend'}. Intrekken kan altijd onder Instellingen → Koppelingen.
            </p>
            {error && <p className="login__error">{error}</p>}
            <div className="connect__buttons">
              <button className="btn is-primary is-big" disabled={busy} onClick={() => answer('allow')}>
                Toestaan
              </button>
              <button className="btn is-big" disabled={busy} onClick={() => answer('deny')}>
                Weigeren
              </button>
            </div>
          </>
        ) : (
          <p>Deze koppel-link is niet compleet. Begin opnieuw vanuit de app die je wilt koppelen.</p>
        )}
      </div>
    </div>
  )
}
