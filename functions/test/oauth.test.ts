import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { authenticate } from '../src/auth'
import { handleOAuth, wwwAuthenticate } from '../src/oauth'
import { NOW, UID, personalToken, setup } from './helpers'

const BASE = 'https://todo.example.web.app'
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const verifier = 'a'.repeat(50)
const challenge = createHash('sha256').update(verifier).digest('base64url')

function oauth(ctx: ReturnType<typeof setup>, method: string, path: string, body?: unknown, query: Record<string, string> = {}) {
  return handleOAuth({ method, path, query, headers: {}, body }, { repo: ctx.repo, now: () => NOW }, BASE)
}

async function register(ctx: ReturnType<typeof setup>) {
  const r = await oauth(ctx, 'POST', '/oauth/register', { client_name: 'Claude', redirect_uris: [REDIRECT] })
  expect(r.status).toBe(201)
  return (r.body as { client_id: string }).client_id
}

const authParams = (clientId: string, extra: Record<string, string> = {}) => ({
  response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', ...extra,
})

async function getCode(ctx: ReturnType<typeof setup>, clientId: string) {
  const token = await personalToken(ctx.repo)
  const r = await oauth(ctx, 'POST', '/oauth/authorize', { ...authParams(clientId), token, action: 'allow' })
  expect(r.status).toBe(302)
  const loc = new URL(r.headers!.Location)
  expect(loc.searchParams.get('state')).toBe('xyz')
  return loc.searchParams.get('code')!
}

describe('OAuth voor de Claude-app', () => {
  it('serveert de ontdekkingsdocumenten', async () => {
    const ctx = setup()
    const prm = await oauth(ctx, 'GET', '/.well-known/oauth-protected-resource/mcp')
    expect(prm.body).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [BASE] })
    const as = (await oauth(ctx, 'GET', '/.well-known/oauth-authorization-server')).body as Record<string, unknown>
    expect(as.code_challenge_methods_supported).toEqual(['S256'])
    expect(as.registration_endpoint).toBe(`${BASE}/oauth/register`)
    expect(wwwAuthenticate(BASE)).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`)
  })

  it('doorloopt registreren, toestemming, token en refresh met rotatie', async () => {
    const ctx = setup()
    const clientId = await register(ctx)
    const page = await oauth(ctx, 'GET', '/oauth/authorize', undefined, authParams(clientId))
    expect(page.status).toBe(200)
    expect(page.body).toContain('Persoonlijk token')

    const code = await getCode(ctx, clientId)
    const form = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }
    const t = await oauth(ctx, 'POST', '/oauth/token', form)
    expect(t.status).toBe(200)
    const tokens = t.body as { access_token: string; refresh_token: string; token_type: string; expires_in: number }
    expect(tokens.token_type).toBe('Bearer')
    expect(await authenticate(`Bearer ${tokens.access_token}`, ctx.deps.auth)).toEqual({ uid: UID, via: 'oauth' })

    // een code werkt maar één keer
    expect((await oauth(ctx, 'POST', '/oauth/token', form)).status).toBe(400)

    // refresh: nieuw paar, oud refresh-token is ongeldig
    const r1 = await oauth(ctx, 'POST', '/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
    expect(r1.status).toBe(200)
    const again = await oauth(ctx, 'POST', '/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
    expect(again.status).toBe(400)
    expect((again.body as { error: string }).error).toBe('invalid_grant')
  })

  it('weigert een verkeerde PKCE-verifier', async () => {
    const ctx = setup()
    const clientId = await register(ctx)
    const code = await getCode(ctx, clientId)
    const r = await oauth(ctx, 'POST', '/oauth/token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: 'b'.repeat(50) })
    expect((r.body as { error: string }).error).toBe('invalid_grant')
  })

  it('weigert plain PKCE, onbekende terugkeeradressen en slechte registraties', async () => {
    const ctx = setup()
    const clientId = await register(ctx)
    expect((await oauth(ctx, 'GET', '/oauth/authorize', undefined, authParams(clientId, { code_challenge_method: 'plain' }))).status).toBe(400)
    expect((await oauth(ctx, 'GET', '/oauth/authorize', undefined, authParams(clientId, { redirect_uri: 'https://evil.example/cb' }))).status).toBe(400)
    expect((await oauth(ctx, 'GET', '/oauth/authorize', undefined, authParams('onbekend'))).status).toBe(400)
    expect((await oauth(ctx, 'POST', '/oauth/register', { redirect_uris: ['http://evil.example/cb'] })).status).toBe(400)
    expect((await oauth(ctx, 'POST', '/oauth/register', { redirect_uris: [] })).status).toBe(400)
  })

  it('weigert een onbekend token op de toestemmingspagina en een weigering stuurt access_denied terug', async () => {
    const ctx = setup()
    const clientId = await register(ctx)
    const bad = await oauth(ctx, 'POST', '/oauth/authorize', { ...authParams(clientId), token: 'tdp_fout', action: 'allow' })
    expect(bad.status).toBe(401)
    const deny = await oauth(ctx, 'POST', '/oauth/authorize', { ...authParams(clientId), action: 'deny' })
    expect(new URL(deny.headers!.Location).searchParams.get('error')).toBe('access_denied')
  })

  it('accepteert alleen een persoonlijk token als toestemming, geen OAuth-token', async () => {
    const ctx = setup()
    const clientId = await register(ctx)
    const code = await getCode(ctx, clientId)
    const t = await oauth(ctx, 'POST', '/oauth/token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier })
    const access = (t.body as { access_token: string }).access_token
    const r = await oauth(ctx, 'POST', '/oauth/authorize', { ...authParams(clientId), token: access, action: 'allow' })
    expect(r.status).toBe(401)
  })
})
