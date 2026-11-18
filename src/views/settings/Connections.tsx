import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Trash2 } from 'lucide-react'
import { getIdToken } from '../../data/session'

interface TokenInfo {
  id: string
  name: string
  kind: 'personal' | 'oauth_access'
  createdAt: string
  lastUsedAt: string | null
}

const API = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').trim().replace(/\/+$/, '')
/** Het adres van de Claude-koppeling staat naast /api op dezelfde server. */
const MCP_URL = API.replace(/\/api$/, '/mcp')

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const idToken = await getIdToken()
  if (!idToken) throw new Error('Je bent niet ingelogd.')
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) throw new Error(`De server gaf een fout (${res.status}).`)
  return (res.status === 204 ? undefined : await res.json()) as T
}

const day = (iso: string) => new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Sleutels waarmee andere tools (Siri, Claude, scripts) bij je taken kunnen.
 * Een sleutel is maar één keer te zien; de server bewaart alleen een afdruk ervan.
 */
export function Connections() {
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null)
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setTokens((await call<{ tokens: TokenInfo[] }>('/tokens')).tokens)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    if (API) void load()
  }, [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const made = await call<{ token: string; name: string }>('/tokens', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
      setFresh(made)
      setCopied(false)
      setName('')
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function revoke(token: TokenInfo) {
    if (!window.confirm(`Sleutel “${token.name}” intrekken? De tool die hem gebruikt kan daarna niet meer bij je taken.`)) return
    try {
      await call(`/tokens/${encodeURIComponent(token.id)}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(true)
  }

  if (!API) {
    return (
      <section className="settings__group" aria-labelledby="koppelingen">
        <h2 id="koppelingen">Koppelingen</h2>
        <div className="settings__empty">Koppelingen werken zodra de app met de server is verbonden.</div>
      </section>
    )
  }

  return (
    <section className="settings__group" aria-labelledby="koppelingen">
      <h2 id="koppelingen">Koppelingen</h2>
      <p className="hint-text">
        Met een sleutel kan een andere tool (Siri, Claude, een script) taken lezen en toevoegen. Maak per tool een eigen sleutel; dan kun je er één
        intrekken zonder de rest te raken.
      </p>

      <div className="conn__address">
        <span>Adres voor Claude</span>
        <code>{MCP_URL}</code>
      </div>

      {fresh && (
        <div className="conn__fresh" role="status">
          <strong>Sleutel “{fresh.name}” is gemaakt. Kopieer hem nu: je ziet hem hierna niet meer.</strong>
          <code>{fresh.token}</code>
          <div>
            <button className="btn is-primary" onClick={() => copy(fresh.token)}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Gekopieerd' : 'Kopiëren'}
            </button>
            <button className="btn" onClick={() => setFresh(null)}>
              Klaar
            </button>
          </div>
        </div>
      )}

      {error && <div className="conn__error">{error}</div>}

      {tokens?.length === 0 && <div className="settings__empty">Nog geen sleutels</div>}
      {tokens?.map((t) => (
        <div key={t.id} className="conn__row">
          <div>
            <div className="conn__name">{t.name}</div>
            <div className="hint-text">
              {t.kind === 'oauth_access' ? 'Gekoppeld via de Claude-app · ' : ''}
              gemaakt {day(t.createdAt)} · {t.lastUsedAt ? `laatst gebruikt ${day(t.lastUsedAt)}` : 'nog niet gebruikt'}
            </div>
          </div>
          <button className="btn is-quiet-danger" onClick={() => revoke(t)} aria-label={`Sleutel ${t.name} intrekken`}>
            <Trash2 size={15} /> Intrekken
          </button>
        </div>
      ))}

      <form className="conn__new" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Naam, bv. Siri of Claude op laptop" aria-label="Naam van de nieuwe sleutel" maxLength={100} />
        <button className="btn is-primary" disabled={!name.trim() || busy}>
          Sleutel maken
        </button>
      </form>
    </section>
  )
}
