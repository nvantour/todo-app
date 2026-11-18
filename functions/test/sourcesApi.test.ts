import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { cellText, resolveAirtable } from '../src/airtable'
import { GoogleService } from '../src/google'
import { SCOPE_CALENDAR, SCOPE_CHAT_MESSAGES, SCOPE_CHAT_SPACES, buildAuthUrl } from '../src/googleAuth'
import { createMcpServer } from '../src/mcp'
import { scheduleTodo } from '../src/schedule'
import { NOW, UID, call, personalToken, setup } from './helpers'
import { fakeGoogle, timed } from './sources.helpers'

const REC = 'rec1234567890abcd'
const AT_URL = `https://airtable.com/appAAAAAAAAAAAAAA/tblBBBBBBBBBBBBBB/viwCCCCCCCCCCCCCC/${REC}?blocks=hide`

/** Nep-fetch: antwoordt per adres met vaste JSON. */
function fakeFetch(routes: Record<string, (url: URL, init?: RequestInit) => { status?: number; body?: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const f = (async (input: string | URL, init?: RequestInit) => {
    const u = new URL(String(input))
    calls.push({ url: String(input), init })
    const key = Object.keys(routes).find((k) => `${u.origin}${u.pathname}` === k)
    if (!key) return new Response('{}', { status: 404 })
    const r = routes[key](u, init)
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 })
  }) as typeof fetch
  return { f, calls }
}

describe('Airtable-link omzetten', () => {
  const airtable = (over: { baseId?: string; fields?: Record<string, unknown>; recordStatus?: number } = {}) =>
    fakeFetch({
      'https://api.airtable.com/v0/meta/bases': () => ({ body: { bases: [{ id: 'appAAAAAAAAAAAAAA', name: 'Wehkamp Experimenten' }] } }),
      'https://api.airtable.com/v0/meta/bases/appAAAAAAAAAAAAAA/tables': () => ({
        body: { tables: [{ id: 'tblZZZZZZZZZZZZZZ', primaryFieldId: 'fldOther' }, { id: 'tblBBBBBBBBBBBBBB', primaryFieldId: 'fldName' }] },
      }),
      [`https://api.airtable.com/v0/appAAAAAAAAAAAAAA/tblBBBBBBBBBBBBBB/${REC}`]: () => ({ status: over.recordStatus ?? 200, body: { id: REC, fields: over.fields ?? { fldName: 'Test 42: sticky knop' } } }),
    })

  it('geeft record- en basenaam terug', async () => {
    const { f, calls } = airtable()
    const r = await resolveAirtable(AT_URL, 'pat-test', f)
    expect(r).toMatchObject({ baseName: 'Wehkamp Experimenten', recordName: 'Test 42: sticky knop', recordId: REC, tableId: 'tblBBBBBBBBBBBBBB', label: 'Test 42: sticky knop (Wehkamp Experimenten)' })
    expect(calls.every((c) => (c.init?.headers as Record<string, string>).Authorization === 'Bearer pat-test')).toBe(true)
    expect(calls.some((c) => c.url.includes('returnFieldsByFieldId=true'))).toBe(true)
  })

  it('zoekt zelf de tabel als de link er geen heeft (interface-link)', async () => {
    const { f } = fakeFetch({
      'https://api.airtable.com/v0/meta/bases': () => ({ body: { bases: [{ id: 'appAAAAAAAAAAAAAA', name: 'Keesing' }] } }),
      'https://api.airtable.com/v0/meta/bases/appAAAAAAAAAAAAAA/tables': () => ({ body: { tables: [{ id: 'tblBBBBBBBBBBBBBB', primaryFieldId: 'fldName' }] } }),
      [`https://api.airtable.com/v0/appAAAAAAAAAAAAAA/tblBBBBBBBBBBBBBB/${REC}`]: () => ({ body: { id: REC, fields: { fldName: 'Idee' } } }),
    })
    const r = await resolveAirtable(`https://airtable.com/appAAAAAAAAAAAAAA/pagDDDDDDDDDDDDDD/${REC}`, 't', f)
    expect(r.recordName).toBe('Idee')
  })

  it('meldt een onbekend record en een geweigerde toegang', async () => {
    await expect(resolveAirtable(AT_URL, 't', airtable({ recordStatus: 404 }).f)).rejects.toMatchObject({ code: 'not_found' })
    const { f } = fakeFetch({ 'https://api.airtable.com/v0/meta/bases': () => ({ status: 403 }), 'https://api.airtable.com/v0/meta/bases/appAAAAAAAAAAAAAA/tables': () => ({ status: 403 }), [`https://api.airtable.com/v0/appAAAAAAAAAAAAAA/tblBBBBBBBBBBBBBB/${REC}`]: () => ({ status: 403 }) })
    await expect(resolveAirtable(AT_URL, 't', f)).rejects.toMatchObject({ code: 'airtable_forbidden' })
    await expect(resolveAirtable('https://example.com/x', 't', f)).rejects.toMatchObject({ code: 'bad_airtable_url' })
  })

  it('leest ook niet-tekstcellen als tekst', () => {
    expect(cellText(['a', { name: 'b' }])).toBe('a, b')
    expect(cellText(42)).toBe('42')
    expect(cellText(null)).toBeNull()
  })

  it('POST /airtable/resolve herkent de klant uit de basenaam', async () => {
    const ctx = setup()
    const { f } = airtable()
    const deps = { ...ctx.deps, airtableToken: () => 'pat', fetch: f }
    const r = await call(deps, 'POST', '/api/airtable/resolve', { url: AT_URL })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ recordId: REC, projectId: 'wehkamp' })
    const none = await call({ ...ctx.deps, fetch: f }, 'POST', '/api/airtable/resolve', { url: AT_URL })
    expect(none.status).toBe(501)
  })
})

describe('Google koppelen', () => {
  const cfg = { clientId: 'cid', clientSecret: 'sec' }
  const REDIRECT = 'https://todo.example.web.app/api/google/callback'
  const tokenBody = { access_token: 'acc', expires_in: 3600, refresh_token: 'ref', scope: `openid email ${[SCOPE_CALENDAR, SCOPE_CHAT_MESSAGES, SCOPE_CHAT_SPACES, 'https://www.googleapis.com/auth/chat.memberships.readonly'].join(' ')}` }
  function gsetup(tokenResponse: () => { status?: number; body?: unknown } = () => ({ body: tokenBody })) {
    const ctx = setup()
    const net = fakeFetch({
      'https://oauth2.googleapis.com/token': (_u, init) => {
        const p = new URLSearchParams(String(init?.body))
        if (p.get('grant_type') === 'refresh_token') return { body: { access_token: 'acc2', expires_in: 3600 } }
        return tokenResponse()
      },
      'https://openidconnect.googleapis.com/v1/userinfo': () => ({ body: { sub: '1001', email: 'nino@onlinedialogue.com' } }),
      'https://oauth2.googleapis.com/revoke': () => ({ body: {} }),
    })
    const google = new GoogleService({ repo: ctx.repo, config: () => cfg, fetch: net.f, now: () => NOW })
    return { ...ctx, ...net, google }
  }
  const stateOf = (url: string) => new URL(url).searchParams.get('state')!

  it('bouwt een aanvraag met offline toegang en alleen de nodige rechten', () => {
    const u = new URL(buildAuthUrl(cfg, REDIRECT, 'st', 'nino@onlinedialogue.com'))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('consent')
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(u.searchParams.get('scope')!.split(' ')).toEqual(['openid', 'email', SCOPE_CALENDAR, SCOPE_CHAT_MESSAGES, SCOPE_CHAT_SPACES, 'https://www.googleapis.com/auth/chat.memberships.readonly'])
  })

  it('koppelt: bewaart het refresh-token alleen op de server en maakt de standaardregel', async () => {
    const { google, repo } = gsetup()
    const url = await google.startConnect(UID, REDIRECT)
    const r = await google.finishConnect('code', stateOf(url), REDIRECT)
    expect(r).toMatchObject({ uid: UID, email: 'nino@onlinedialogue.com', missing: [] })
    expect(await repo.getGoogle(UID)).toMatchObject({ refreshToken: 'ref', googleId: '1001' })
    expect((await repo.listCalendarRules(UID)).map((x) => x.match)).toEqual(['QBR'])
    expect(await google.status(UID)).toMatchObject({ configured: true, connected: true, email: 'nino@onlinedialogue.com', calendar: true, chat: true })
  })

  it('een state werkt maar één keer en een onbekende state faalt', async () => {
    const { google } = gsetup()
    const state = stateOf(await google.startConnect(UID, REDIRECT))
    await google.finishConnect('c', state, REDIRECT)
    await expect(google.finishConnect('c', state, REDIRECT)).rejects.toMatchObject({ code: 'bad_state' })
    await expect(google.finishConnect('c', 'verzonnen', REDIRECT)).rejects.toMatchObject({ code: 'bad_state' })
  })

  it('meldt welke toestemming ontbreekt (gedeeltelijk)', async () => {
    const { google } = gsetup(() => ({ body: { ...tokenBody, scope: `openid email ${SCOPE_CALENDAR}` } }))
    const r = await google.finishConnect('c', stateOf(await google.startConnect(UID, REDIRECT)), REDIRECT)
    expect(r.missing).toHaveLength(3)
    expect((await google.status(UID)).chat).toBe(false)
  })

  it('weigert als Google geen refresh-token meegeeft', async () => {
    const { google } = gsetup(() => ({ body: { ...tokenBody, refresh_token: undefined } }))
    await expect(google.finishConnect('c', stateOf(await google.startConnect(UID, REDIRECT)), REDIRECT)).rejects.toMatchObject({ code: 'no_refresh_token' })
  })

  it('markeert de koppeling als verlopen als Google het refresh-token afwijst', async () => {
    const ctx = gsetup()
    await ctx.google.finishConnect('c', stateOf(await ctx.google.startConnect(UID, REDIRECT)), REDIRECT)
    const broken = new GoogleService({
      repo: ctx.repo,
      config: () => cfg,
      now: () => new Date(NOW.getTime() + 2 * 3600_000),
      fetch: (async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as typeof fetch,
    })
    await expect(broken.accessToken(UID)).rejects.toMatchObject({ code: 'google_reauth' })
    expect((await ctx.repo.getGoogle(UID))?.needsReauth).toBe(true)
    expect((await broken.status(UID)).needsReauth).toBe(true)
  })

  it('ontkoppelen trekt de toegang in en verwijdert het token', async () => {
    const ctx = gsetup()
    await ctx.google.finishConnect('c', stateOf(await ctx.google.startConnect(UID, REDIRECT)), REDIRECT)
    await ctx.google.disconnect(UID)
    expect(await ctx.repo.getGoogle(UID)).toBeNull()
    expect(ctx.calls.some((c) => c.url.startsWith('https://oauth2.googleapis.com/revoke'))).toBe(true)
    expect((await ctx.google.status(UID)).connected).toBe(false)
  })

  it('zonder client-id en -secret is koppelen niet beschikbaar', async () => {
    const ctx = setup()
    const google = new GoogleService({ repo: ctx.repo, config: () => null })
    await expect(google.startConnect(UID, REDIRECT)).rejects.toMatchObject({ status: 501 })
    expect(await google.status(UID)).toEqual({ configured: false, connected: false })
  })

  it('API: connect geeft een Google-adres, de terugkeer stuurt door naar Instellingen', async () => {
    const ctx = gsetup()
    const deps = { ...ctx.deps, google: ctx.google, baseUrl: 'https://todo.example.web.app' }
    const c = await call(deps, 'POST', '/api/google/connect')
    expect(c.status).toBe(200)
    const url = (c.body as { url: string }).url
    expect(new URL(url).searchParams.get('redirect_uri')).toBe(REDIRECT)
    const back = await call(deps, 'GET', '/api/google/callback', undefined, {}, { code: 'c', state: stateOf(url) })
    expect(back.status).toBe(302)
    expect(back.headers!.Location).toBe('https://todo.example.web.app/instellingen?google=ok')
    const denied = await call(deps, 'GET', '/api/google/callback', undefined, {}, { error: 'access_denied' })
    expect(denied.headers!.Location).toContain('google=geweigerd')
    const bad = await call(deps, 'GET', '/api/google/callback', undefined, {}, { code: 'c', state: 'nep' })
    expect(bad.headers!.Location).toContain('google=fout')
    expect((await call(deps, 'GET', '/api/google/status')).body).toMatchObject({ connected: true })
  })

  it('API: koppelen kan niet met een persoonlijk token', async () => {
    const ctx = gsetup()
    const token = await personalToken(ctx.repo)
    const deps = { ...ctx.deps, google: ctx.google }
    expect((await call(deps, 'POST', '/api/google/connect', undefined, { authorization: `Bearer ${token}` })).status).toBe(403)
    expect((await call(deps, 'GET', '/api/google/status', undefined, { authorization: `Bearer ${token}` })).status).toBe(200)
  })
})

describe('inplannen in de agenda', () => {
  async function withTodo(over: Parameters<typeof fakeGoogle>[0] = {}) {
    const ctx = setup()
    const g = fakeGoogle(over)
    const todo = await ctx.service.addTodo(UID, { title: 'Rapport schrijven', due: '2026-11-18' })
    return { ...ctx, ...g, todo, deps: { ...ctx.deps, google: g.google } }
  }

  it('zet een afspraak in het eerste vrije blok en onthoudt het id op de taak', async () => {
    // 11:00 nu; een afspraak van 11:00 tot 12:00 bezet
    const { service, google, inserted, todo, repo } = await withTodo({ events: [timed('x', 'Overleg', '2026-11-18T11:00:00+01:00')] })
    const r = await scheduleTodo({ service, google }, UID, todo.id, 60)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ summary: 'Rapport schrijven', start: { timeZone: 'Europe/Amsterdam' } })
    expect(r.start).toBe('2026-11-18T11:00:00.000Z') // 12:00 in Nederland
    expect(r.afterDue).toBe(false)
    expect((await repo.getTodo(UID, todo.id))).toMatchObject({ calendarEventId: 'evt-1', estimateMin: 60 })
  })

  it('weigert een taak die al ingepland is, tenzij je vervangt (dan verdwijnt het oude blok)', async () => {
    const { service, google, deleted, todo } = await withTodo()
    await scheduleTodo({ service, google }, UID, todo.id, 30)
    await expect(scheduleTodo({ service, google }, UID, todo.id, 30)).rejects.toMatchObject({ code: 'already_scheduled' })
    const r = await scheduleTodo({ service, google }, UID, todo.id, 30, { replace: true })
    expect(r.eventId).toBe('evt-2')
    expect(deleted).toEqual(['evt-1'])
  })

  it('meldt dat het blok na de datum van de taak valt', async () => {
    const ctx = await withTodo({ events: [timed('x', 'Dag vol', '2026-11-18T11:00:00+01:00', { end: { dateTime: '2026-11-18T17:30:00+01:00' } })] })
    const r = await scheduleTodo({ service: ctx.service, google: ctx.google }, UID, ctx.todo.id, 60)
    expect(r.afterDue).toBe(true)
  })

  it('weigert zonder agenda-toestemming en voor afgevinkte taken', async () => {
    const a = await withTodo({ scopes: [] })
    await expect(scheduleTodo({ service: a.service, google: a.google }, UID, a.todo.id, 30)).rejects.toMatchObject({ code: 'google_scope_missing' })
    const b = await withTodo()
    await b.service.completeTodo(UID, b.todo.id)
    await expect(scheduleTodo({ service: b.service, google: b.google }, UID, b.todo.id, 30)).rejects.toMatchObject({ code: 'already_done' })
  })

  it('API: POST /todos/:id/schedule', async () => {
    const { deps, todo } = await withTodo()
    const r = await call(deps, 'POST', `/api/todos/${todo.id}/schedule`, { minutes: 90 })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ eventId: 'evt-1' })
    expect((await call(deps, 'POST', `/api/todos/${todo.id}/schedule`, { minutes: 5 })).status).toBe(400)
    expect((await call({ ...deps, google: undefined }, 'POST', `/api/todos/${todo.id}/schedule`, { minutes: 30 })).status).toBe(501)
  })

  it('MCP-tool schedule_todo', async () => {
    const { service, google, todo } = await withTodo()
    const server = createMcpServer(service, UID, (id, minutes, replace) => scheduleTodo({ service, google }, UID, id, minutes, { replace }))
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 't', version: '1' })
    await Promise.all([server.connect(a), client.connect(b)])
    const r = (await client.callTool({ name: 'schedule_todo', arguments: { id: todo.id, minutes: 45 } })) as { content: { text: string }[]; isError?: boolean }
    expect(r.isError).toBeFalsy()
    expect(JSON.parse(r.content[0].text)).toMatchObject({ scheduled: true, todo: { calendarEventId: 'evt-1', estimateMin: 45 } })
    const again = (await client.callTool({ name: 'schedule_todo', arguments: { id: todo.id } })) as { isError?: boolean; content: { text: string }[] }
    expect(again.isError).toBe(true)
    expect(again.content[0].text).toMatch(/al in je agenda/)
  })
})

describe('meldingen: apparaten via de API', () => {
  it('registreren, lijst en intrekken', async () => {
    const { PushService } = await import('../src/push')
    const ctx = setup()
    const deps = { ...ctx.deps, push: new PushService(ctx.repo, ctx.service, async (t) => ({ invalid: [], sent: t.length })) }
    const made = await call(deps, 'POST', '/api/push/devices', { token: 'x'.repeat(50), label: 'iPhone' })
    expect(made.status).toBe(201)
    const id = (made.body as { id: string }).id
    expect(((await call(deps, 'GET', '/api/push/devices')).body as { devices: unknown[] }).devices).toHaveLength(1)
    expect((await call(deps, 'POST', '/api/push/test')).body).toEqual({ sent: 1 })
    expect((await call(deps, 'DELETE', `/api/push/devices/${id}`)).status).toBe(204)
    expect((await call(deps, 'DELETE', `/api/push/devices/${id}`)).status).toBe(404)
    expect((await call({ ...ctx.deps }, 'GET', '/api/push/devices')).status).toBe(501)
  })
})

