// Inloggen bij Google vanaf de server (authorization-code-flow met offline toegang).
// Bron: https://developers.google.com/identity/protocols/oauth2/web-server
import { HttpError } from './errors'

export type Fetch = typeof fetch

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

/** Zo smal mogelijk: eigen agenda lezen en afspraken maken, Chat alleen lezen. */
export const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.events.owned'
export const SCOPE_CHAT_MESSAGES = 'https://www.googleapis.com/auth/chat.messages.readonly'
export const SCOPE_CHAT_SPACES = 'https://www.googleapis.com/auth/chat.spaces.readonly'
export const SCOPE_CHAT_MEMBERS = 'https://www.googleapis.com/auth/chat.memberships.readonly'
/** Antwoorden versturen vanaf de tab Antwoorden (alleen na Nino's vinkje in de app). */
export const SCOPE_CHAT_CREATE = 'https://www.googleapis.com/auth/chat.messages.create'
/** Emoji op een bericht zetten vanaf de tab Antwoorden (alleen na Nino's klik in de app). */
export const SCOPE_CHAT_REACT = 'https://www.googleapis.com/auth/chat.messages.reactions.create'
/** Mail in het werk-OS: lezen, labels, versturen (modify) en handtekening, afwezigheid en regels (settings.basic). */
export const SCOPE_GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify'
export const SCOPE_GMAIL_SETTINGS = 'https://www.googleapis.com/auth/gmail.settings.basic'
export const GOOGLE_SCOPES = ['openid', 'email', SCOPE_CALENDAR, SCOPE_CHAT_MESSAGES, SCOPE_CHAT_SPACES, SCOPE_CHAT_MEMBERS, SCOPE_CHAT_CREATE, SCOPE_CHAT_REACT, SCOPE_GMAIL_MODIFY, SCOPE_GMAIL_SETTINGS]

export interface GoogleClientConfig {
  clientId: string
  clientSecret: string
}

export function buildAuthUrl(cfg: GoogleClientConfig, redirectUri: string, state: string, loginHint?: string): string {
  const u = new URL(AUTH_URL)
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  u.searchParams.set('access_type', 'offline')
  // zonder prompt=consent geeft Google het refresh-token alleen de eerste keer
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('state', state)
  if (loginHint) u.searchParams.set('login_hint', loginHint)
  return u.toString()
}

export interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
}

async function postForm(fetchImpl: Fetch, url: string, params: Record<string, string>): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, body }
}

export async function exchangeCode(cfg: GoogleClientConfig, code: string, redirectUri: string, fetchImpl: Fetch = fetch): Promise<TokenResponse> {
  const r = await postForm(fetchImpl, TOKEN_URL, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  })
  if (!r.ok || typeof r.body.access_token !== 'string') {
    throw new HttpError(400, 'google_exchange_failed', `Google weigerde de code (${String(r.body.error ?? r.status)}).`)
  }
  return r.body as unknown as TokenResponse
}

/** Een refresh-token dat Google niet meer accepteert (ingetrokken of verlopen). */
export class GoogleReauthError extends Error {}

export async function refreshAccessToken(cfg: GoogleClientConfig, refreshToken: string, fetchImpl: Fetch = fetch): Promise<TokenResponse> {
  const r = await postForm(fetchImpl, TOKEN_URL, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  if (!r.ok || typeof r.body.access_token !== 'string') {
    if (r.body.error === 'invalid_grant') throw new GoogleReauthError('Google accepteert de koppeling niet meer.')
    throw new HttpError(502, 'google_unavailable', `Google gaf een fout bij het verversen (${String(r.body.error ?? r.status)}).`)
  }
  return r.body as unknown as TokenResponse
}

/** Trekt de toegang bij Google in. Mislukken is niet erg: de koppeling hier is dan toch weg. */
export async function revokeToken(token: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    const r = await postForm(fetchImpl, REVOKE_URL, { token })
    return r.ok
  } catch {
    return false
  }
}

export async function fetchUserInfo(accessToken: string, fetchImpl: Fetch = fetch): Promise<{ id: string; email: string }> {
  const res = await fetchImpl(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
  const body = (await res.json().catch(() => ({}))) as { sub?: string; email?: string }
  if (!res.ok || !body.sub) throw new HttpError(502, 'google_unavailable', 'Kon het Google-account niet ophalen.')
  return { id: body.sub, email: body.email ?? '' }
}

/** De scopes die Google daadwerkelijk toekende, als lijst. */
export const splitScopes = (scope: string | undefined): string[] => (scope ?? '').split(/\s+/).filter(Boolean)
