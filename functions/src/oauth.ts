import { createHash } from 'node:crypto'
import type { ApiRequest, ApiResponse } from './api'
import { authenticate, type AuthDeps } from './auth'
import type { OAuthClient, Repo, TokenRecord } from './repo'
import { generateToken, hashToken, randomId } from './tokens'

/**
 * Minimale OAuth 2.1-server voor de Claude-app (claude.ai en mobiel) als "custom connector":
 * - /.well-known/oauth-protected-resource  (RFC 9728)
 * - /.well-known/oauth-authorization-server (RFC 8414)
 * - /oauth/register  (Dynamic Client Registration, RFC 7591, alleen publieke clients)
 * - /oauth/authorize (toestemmingspagina) en /oauth/token (code + PKCE S256, refresh met rotatie)
 * Toestemming geef je in de app zelf (/koppelen), waar je al met Google bent ingelogd; de app stuurt je
 * ID-token mee. Zonder `auth` (tests, of als noodroute) is er de pagina waar je een persoonlijk token plakt.
 */
export interface OAuthDeps {
  repo: Repo
  /** Controle van het ID-token van de app. Is dit gezet, dan loopt toestemming via de app. */
  auth?: AuthDeps
  now?: () => Date
}

export const ACCESS_TTL_S = 3600
export const REFRESH_TTL_S = 60 * 24 * 3600
export const CODE_TTL_S = 300
const CLIENT_TTL_S = 400 * 24 * 3600
const SCOPE = 'todos'

const noStore = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }
const jsonRes = (status: number, body: unknown, headers: Record<string, string> = {}): ApiResponse => ({ status, body, headers: { ...noStore, ...headers } })
const oauthError = (status: number, error: string, description: string) => jsonRes(status, { error, error_description: description })

export function isOAuthPath(path: string): boolean {
  return path.startsWith('/oauth/') || path.startsWith('/.well-known/')
}

export function protectedResourceUrl(base: string): string {
  return `${base}/.well-known/oauth-protected-resource/mcp`
}

export function wwwAuthenticate(base: string): string {
  return `Bearer resource_metadata="${protectedResourceUrl(base)}"`
}

const addSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000).toISOString()

export function validRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri)
    if (u.hash) return false
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')

export async function handleOAuth(req: ApiRequest, deps: OAuthDeps, base: string): Promise<ApiResponse> {
  const now = (deps.now ?? (() => new Date()))()
  const method = req.method.toUpperCase()
  const path = req.path.replace(/\/+$/, '')
  const form = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>

  if (method === 'GET' && (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp')) {
    return jsonRes(200, { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'], scopes_supported: [SCOPE] }, { 'Cache-Control': 'public, max-age=300' })
  }
  if (method === 'GET' && path === '/.well-known/oauth-authorization-server') {
    return jsonRes(
      200,
      {
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: [SCOPE],
      },
      { 'Cache-Control': 'public, max-age=300' },
    )
  }

  if (method === 'POST' && path === '/oauth/register') {
    const uris = Array.isArray(form.redirect_uris) ? (form.redirect_uris as unknown[]).map(s) : []
    if (!uris.length || uris.length > 5 || !uris.every(validRedirectUri)) {
      return oauthError(400, 'invalid_redirect_uri', 'redirect_uris moet 1 tot 5 https-adressen (of http op localhost) bevatten.')
    }
    const client = { id: randomId(16), name: s(form.client_name).slice(0, 100) || 'Onbekende app', redirectUris: uris, createdAt: now.toISOString(), expiresAt: addSeconds(now, CLIENT_TTL_S) }
    await deps.repo.saveClient(client)
    return jsonRes(201, {
      client_id: client.id,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
  }

  if (path === '/oauth/authorize' && (method === 'GET' || method === 'POST')) {
    const p = method === 'GET' ? (req.query as Record<string, unknown>) : form
    const v = await validateAuthRequest(p, deps.repo)
    if (v.error !== undefined) return page(400, errorPage(v.error))
    if (method === 'GET') {
      // In de app toestemming geven (daar ben je al ingelogd); ?manual=1 toont de pagina met het persoonlijke token.
      if (deps.auth && s(p.manual) !== '1') {
        const params: Record<string, string> = { client_name: v.client.name, redirect_host: new URL(v.redirectUri).host }
        for (const k of HIDDEN) params[k] = s(p[k])
        return redirect(`${base}/koppelen`, params)
      }
      return page(200, consentPage(v.client.name, p, ''))
    }
    if (s(p.action) === 'deny') return redirect(v.redirectUri, { error: 'access_denied', state: s(p.state) })
    let uid: string
    if (s(p.id_token)) {
      // toestemming vanuit de app: het ID-token van de ingelogde gebruiker
      const who = deps.auth ? await authenticate(`Bearer ${s(p.id_token)}`, deps.auth) : null
      if (!who || who.via !== 'idToken') return page(401, errorPage('Je inlog is verlopen of dit account mag niet koppelen. Open de app, log in en probeer het opnieuw.'))
      uid = who.uid
    } else {
      const record = await deps.repo.findToken(hashToken(s(p.token).trim()))
      if (!record || record.kind !== 'personal' || (record.expiresAt && new Date(record.expiresAt) <= now)) {
        return page(401, consentPage(v.client.name, p, 'Dit token klopt niet. Maak een nieuw persoonlijk token in de app en plak dat hier.'))
      }
      uid = record.uid
    }
    const code = randomId(32)
    await deps.repo.saveCode({
      hash: hashToken(code),
      uid,
      clientId: v.client.id,
      redirectUri: v.redirectUri,
      codeChallenge: s(p.code_challenge),
      resource: s(p.resource) || undefined,
      expiresAt: addSeconds(now, CODE_TTL_S),
    })
    return redirect(v.redirectUri, { code, state: s(p.state) })
  }

  if (method === 'POST' && path === '/oauth/token') return token(form, deps, now)

  return jsonRes(404, { error: { code: 'not_found', message: 'Dit adres bestaat niet' } })
}

type AuthCheck = { error: string } | { error?: undefined; client: OAuthClient; redirectUri: string }

async function validateAuthRequest(p: Record<string, unknown>, repo: Repo): Promise<AuthCheck> {
  if (s(p.response_type) !== 'code') return { error: 'Alleen response_type=code wordt ondersteund.' }
  const client = await repo.getClient(s(p.client_id))
  if (!client) return { error: 'Onbekende app (client_id).' }
  const redirectUri = s(p.redirect_uri)
  if (!client.redirectUris.includes(redirectUri)) return { error: 'Dit terugkeeradres hoort niet bij deze app.' }
  if (!s(p.code_challenge) || s(p.code_challenge_method) !== 'S256') return { error: 'PKCE met S256 is verplicht.' }
  return { client, redirectUri }
}

async function token(form: Record<string, unknown>, deps: OAuthDeps, now: Date): Promise<ApiResponse> {
  const grant = s(form.grant_type)
  const clientId = s(form.client_id)
  const client = clientId ? await deps.repo.getClient(clientId) : null
  if (!client) return oauthError(401, 'invalid_client', 'Onbekende client_id.')

  let uid: string
  if (grant === 'authorization_code') {
    const code = await deps.repo.consumeCode(hashToken(s(form.code)))
    if (!code || new Date(code.expiresAt) <= now) return oauthError(400, 'invalid_grant', 'De code is onbekend of verlopen.')
    if (code.clientId !== client.id || code.redirectUri !== s(form.redirect_uri)) return oauthError(400, 'invalid_grant', 'Code hoort niet bij deze aanvraag.')
    const verifier = s(form.code_verifier)
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier) || createHash('sha256').update(verifier).digest('base64url') !== code.codeChallenge) {
      return oauthError(400, 'invalid_grant', 'PKCE-controle mislukt.')
    }
    uid = code.uid
  } else if (grant === 'refresh_token') {
    const hash = hashToken(s(form.refresh_token))
    const old = await deps.repo.findToken(hash)
    if (!old || old.kind !== 'oauth_refresh' || old.clientId !== client.id || (old.expiresAt && new Date(old.expiresAt) <= now)) {
      return oauthError(400, 'invalid_grant', 'Het refresh-token is onbekend of verlopen.')
    }
    await deps.repo.deleteTokenByHash(hash) // rotatie: elk refresh-token werkt maar één keer
    uid = old.uid
  } else {
    return oauthError(400, 'unsupported_grant_type', 'Gebruik authorization_code of refresh_token.')
  }

  const access = generateToken('oauth_access')
  const refresh = generateToken('oauth_refresh')
  const make = (kind: TokenRecord['kind'], raw: string, ttl: number): TokenRecord => {
    const hash = hashToken(raw)
    return { id: hash.slice(0, 12), hash, uid, name: `Claude-app (${client.name})`, kind, createdAt: now.toISOString(), lastUsedAt: null, expiresAt: addSeconds(now, ttl), clientId: client.id }
  }
  await deps.repo.saveToken(make('oauth_access', access, ACCESS_TTL_S))
  await deps.repo.saveToken(make('oauth_refresh', refresh, REFRESH_TTL_S))
  return jsonRes(200, { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE })
}

// --- HTML ---

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function page(status: number, html: string): ApiResponse {
  return {
    status,
    body: html,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'" },
  }
}

function redirect(uri: string, params: Record<string, string>): ApiResponse {
  const u = new URL(uri)
  for (const [k, val] of Object.entries(params)) if (val) u.searchParams.set(k, val)
  return { status: 302, headers: { Location: u.toString(), 'Cache-Control': 'no-store' } }
}

const shell = (body: string) => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Work-OS koppelen</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#1c1c1e}input[type=password],input[type=text]{width:100%;padding:.6rem;font:inherit;box-sizing:border-box;margin:.5rem 0 1rem}button{font:inherit;padding:.6rem 1rem;border-radius:.5rem;border:1px solid #888;background:#fff;cursor:pointer}button.go{background:#1c1c1e;color:#fff;border-color:#1c1c1e}.err{color:#b00020}</style></head><body>${body}</body></html>`

function errorPage(message: string): string {
  return shell(`<h1>Koppelen lukt niet</h1><p class="err">${esc(message)}</p>`)
}

const HIDDEN = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource']

function consentPage(clientName: string, p: Record<string, unknown>, error: string): string {
  const hidden = HIDDEN.map((k) => `<input type="hidden" name="${k}" value="${esc(s(p[k]))}">`).join('')
  return shell(`<h1>Work-OS koppelen</h1>
<p><strong>${esc(clientName)}</strong> vraagt toegang tot je taken: lezen, toevoegen, aanpassen en afvinken.</p>
<p>Plak je persoonlijke token om toestemming te geven. Die maak je in de app onder Instellingen, Koppelingen.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/oauth/authorize" autocomplete="off">${hidden}
<label for="token">Persoonlijk token</label>
<input id="token" name="token" type="password" required autofocus>
<button class="go" name="action" value="allow">Toestemming geven</button>
<button name="action" value="deny" formnovalidate>Weigeren</button>
</form>`)
}
