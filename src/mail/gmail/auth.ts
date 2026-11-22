// Toegang tot Gmail in het werk-OS.
//
// De mail gebruikt de Google-koppeling van de todo-app (Instellingen › Google). Het verversingstoken
// blijft op de server; de app vraagt `GET /api/google/token` om een toegangsbewijs van een uur en
// praat daarmee rechtstreeks met Gmail en Google Agenda. Eén account: het gekoppelde werkaccount.

import { apiCall, ServerError } from '../../data/server'
import { LoginNeeded } from '../errors'

interface MailToken { accessToken: string; expiresAt: string; email: string }
interface GoogleStatus { configured: boolean; connected: boolean; email?: string; needsReauth?: boolean; mail?: boolean }

let cached: { email: string; token: string; expires: number } | null = null

/** Waarom de mail (nog) niet kan: niet gekoppeld, verlopen, of Gmail niet toegestaan. */
export type MailAccess = { ok: true; email: string } | { ok: false; reason: 'no_server' | 'not_configured' | 'not_connected' | 'reauth' | 'no_mail' | 'error'; email?: string; message?: string }

/** Kijkt bij de server of de mail kan; bepaalt ook welk account we tonen. */
export async function checkAccess(): Promise<MailAccess> {
  try {
    const s = await apiCall<GoogleStatus>('/google/status')
    if (!s.configured) return { ok: false, reason: 'not_configured' }
    if (!s.connected || !s.email) return { ok: false, reason: 'not_connected' }
    if (s.needsReauth) return { ok: false, reason: 'reauth', email: s.email }
    if (!s.mail) return { ok: false, reason: 'no_mail', email: s.email }
    return { ok: true, email: s.email }
  } catch (e) {
    if (e instanceof ServerError && e.code === 'no_server') return { ok: false, reason: 'no_server' }
    if (e instanceof ServerError && e.status === 501) return { ok: false, reason: 'not_configured' }
    return { ok: false, reason: 'error', message: (e as Error).message }
  }
}

/** Een geldig toegangsbewijs; een minuut voor het verloopt halen we een nieuw. */
export async function getToken(email: string): Promise<string> {
  if (cached && cached.email === email && cached.expires - 60_000 > Date.now()) return cached.token
  try {
    const t = await apiCall<MailToken>('/google/token')
    cached = { email: t.email, token: t.accessToken, expires: new Date(t.expiresAt).getTime() }
    return t.accessToken
  } catch (e) {
    if (e instanceof ServerError && (e.code === 'google_reauth' || e.code === 'google_not_connected' || e.code === 'google_mail_scope')) throw new LoginNeeded(email)
    throw e
  }
}

/** Gmail weigerde het bewijs (401): de volgende keer een nieuw ophalen. */
export function expire(_email: string) {
  void _email
  cached = null
}

/** Er is altijd een server-sessie: na een 401 mag de api één keer opnieuw proberen met een vers bewijs. */
export const serverSession = (_email: string) => {
  void _email
  return true
}

/** Opnieuw koppelen gaat via Google zelf (pagina verlaat de app en komt terug in Instellingen). */
export async function connectGoogle(): Promise<void> {
  const { url } = await apiCall<{ url: string }>('/google/connect', { method: 'POST' })
  window.location.assign(url)
}
