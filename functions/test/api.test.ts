import { describe, expect, it } from 'vitest'
import { MAX_AUDIO_BYTES, handleApi } from '../src/api'
import { authenticate } from '../src/auth'
import { hashToken } from '../src/tokens'
import { ID_AUTH, NOW, TODAY, UID, call, personalToken, setup } from './helpers'

const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

describe('tokens', () => {
  it('maakt een token, toont het één keer en bewaart alleen de hash', async () => {
    const { deps, repo } = setup()
    const res = await call(deps, 'POST', '/api/tokens', { name: 'Siri' })
    expect(res.status).toBe(201)
    const { token, id } = res.body as { token: string; id: string }
    expect(token).toMatch(/^tdp_/)

    const stored = [...repo.tokens.values()]
    expect(stored).toHaveLength(1)
    expect(stored[0].hash).toBe(hashToken(token))
    expect(JSON.stringify(stored)).not.toContain(token)
    expect(stored[0].id).toBe(id)

    const list = await call(deps, 'GET', '/api/tokens')
    expect(JSON.stringify(list.body)).not.toContain(token)
    expect(JSON.stringify(list.body)).not.toContain(stored[0].hash)
    expect((list.body as { tokens: unknown[] }).tokens).toHaveLength(1)
  })

  it('laat het token toe op de data-routes en weigert een verkeerd token', async () => {
    const { deps, repo } = setup()
    const token = await personalToken(repo)
    expect((await call(deps, 'GET', '/todos', undefined, bearer(token))).status).toBe(200)
    expect((await call(deps, 'GET', '/todos', undefined, bearer('tdp_fout'))).status).toBe(401)
    expect((await call(deps, 'GET', '/todos', undefined, {})).status).toBe(401)
    expect((await call(deps, 'GET', '/todos', undefined, bearer('niet.een.jwt'))).status).toBe(401)
  })

  it('beheert tokens alleen met een ID-token', async () => {
    const { deps, repo } = setup()
    const token = await personalToken(repo)
    expect((await call(deps, 'GET', '/tokens', undefined, bearer(token))).status).toBe(403)
    expect((await call(deps, 'POST', '/tokens', { name: 'x' }, bearer(token))).status).toBe(403)
    expect((await call(deps, 'DELETE', `/tokens/${hashToken(token).slice(0, 12)}`, undefined, bearer(token))).status).toBe(403)
  })

  it('trekt een token in', async () => {
    const { deps, repo } = setup()
    const token = await personalToken(repo)
    const id = hashToken(token).slice(0, 12)
    expect((await call(deps, 'DELETE', `/tokens/${id}`)).status).toBe(204)
    expect((await call(deps, 'GET', '/todos', undefined, bearer(token))).status).toBe(401)
    expect((await call(deps, 'DELETE', `/tokens/${id}`)).status).toBe(404)
  })

  it('weigert een ID-token van een niet-toegestaan e-mailadres', async () => {
    const { deps } = setup()
    const strict = { ...deps.auth, allowedEmails: ['ander@example.com'] }
    expect(await authenticate(ID_AUTH.authorization, strict)).toBeNull()
    expect(await authenticate(ID_AUTH.authorization, { ...deps.auth, allowedEmails: ['nino@example.com'] })).toEqual({ uid: UID, via: 'idToken' })
  })

  it('weigert een verlopen OAuth-token en een refresh-token als toegang', async () => {
    const { deps, repo } = setup()
    const base = { uid: UID, name: 'c', createdAt: NOW.toISOString(), lastUsedAt: null }
    await repo.saveToken({ ...base, id: 'a', hash: hashToken('tda_oud'), kind: 'oauth_access', expiresAt: '2026-11-18T09:00:00.000Z' })
    await repo.saveToken({ ...base, id: 'b', hash: hashToken('tdr_x'), kind: 'oauth_refresh', expiresAt: '2027-01-01T00:00:00.000Z' })
    await repo.saveToken({ ...base, id: 'c', hash: hashToken('tda_goed'), kind: 'oauth_access', expiresAt: '2026-11-18T11:00:00.000Z' })
    expect(await authenticate('Bearer tda_oud', deps.auth)).toBeNull()
    expect(await authenticate('Bearer tdr_x', deps.auth)).toBeNull()
    expect(await authenticate('Bearer tda_goed', deps.auth)).toEqual({ uid: UID, via: 'oauth' })
  })
})

describe('todos en projecten', () => {
  it('maakt, leest, wijzigt en vinkt af', async () => {
    const { deps } = setup()
    const created = await call(deps, 'POST', '/api/todos', { title: 'Deck voor Wehkamp', due: '2026-11-20' })
    expect(created.status).toBe(201)
    const todo = (created.body as { todo: { id: string; projectId: string; source: { type: string } } }).todo
    expect(todo.projectId).toBe('wehkamp')
    expect(todo.source.type).toBe('api')

    const patched = await call(deps, 'PATCH', `/api/todos/${todo.id}`, { due: null, bucket: 'later' })
    expect((patched.body as { todo: { due: null; bucket: string } }).todo).toMatchObject({ due: null, bucket: 'later' })

    const done = await call(deps, 'POST', `/api/todos/${todo.id}/complete`)
    expect((done.body as { todo: { done: boolean } }).todo.done).toBe(true)
    const list = await call(deps, 'GET', '/api/todos', undefined, ID_AUTH, { filter: 'project:wehkamp' })
    expect((list.body as { todos: unknown[] }).todos).toHaveLength(0)
  })

  it('geeft nette JSON-fouten', async () => {
    const { deps } = setup()
    const bad = await call(deps, 'POST', '/todos', { title: '', due: '2026-13-45' })
    expect(bad.status).toBe(400)
    expect((bad.body as { error: { code: string } }).error.code).toBe('invalid_input')
    expect((await call(deps, 'POST', '/todos', undefined)).status).toBe(400)
    expect((await call(deps, 'GET', '/todos', undefined, ID_AUTH, { filter: 'x' })).status).toBe(400)
    expect((await call(deps, 'PATCH', '/todos/nope', { title: 'x' })).status).toBe(404)
    expect((await call(deps, 'GET', '/bestaat-niet')).status).toBe(404)
  })

  it('geeft projecten en de brief', async () => {
    const { deps } = setup()
    const p = await call(deps, 'GET', '/projects')
    expect((p.body as { projects: { id: string }[] }).projects.map((x) => x.id)).toEqual(['wehkamp', 'keesing']) // gearchiveerd valt weg
    const b = await call(deps, 'GET', '/brief')
    expect((b.body as { date: string }).date).toBe(TODAY)
  })

  it('voorstellen via de API melden duplicaten met 200', async () => {
    const { deps } = setup()
    const body = { title: 'Reageren', source: { type: 'mail', label: 'Re: SRM', externalId: 't1' }, reason: 'Wacht op antwoord' }
    expect((await call(deps, 'POST', '/suggestions', body)).status).toBe(201)
    const dup = await call(deps, 'POST', '/suggestions', body)
    expect(dup.status).toBe(200)
    expect((dup.body as { created: boolean }).created).toBe(false)
  })
})

describe('transcribe', () => {
  const t = (deps: ReturnType<typeof setup>['deps'], rawBody?: Buffer, headers: Record<string, string> = { ...ID_AUTH, 'content-type': 'audio/webm;codecs=opus' }) =>
    handleApi({ method: 'POST', path: '/api/transcribe', query: {}, headers, body: undefined, rawBody }, deps)

  it('geeft audio door aan transcribeAudio', async () => {
    const { deps } = setup()
    const r = await t(deps, Buffer.alloc(100))
    expect(r.body).toEqual({ text: 'transcript 100 audio/webm' })
  })
  it('weigert lege en te grote audio, en ontbrekende koppeling', async () => {
    const { deps } = setup()
    expect((await t(deps, Buffer.alloc(0))).status).toBe(400)
    expect((await t(deps, Buffer.alloc(MAX_AUDIO_BYTES + 1))).status).toBe(413)
    expect((await t({ ...deps, transcribe: undefined }, Buffer.alloc(5))).status).toBe(501)
    expect((await t(deps, Buffer.alloc(5), { 'content-type': 'audio/webm' })).status).toBe(401)
  })
})
