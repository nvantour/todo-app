import { z } from 'zod'
import type { Project } from '../../src/model/types'
import { authenticate, type AuthDeps, type AuthResult } from './auth'
import { buildBrief } from './brief'
import { runCapture, type AiCapture } from './capture'
import { HttpError, badRequest, notFound } from './errors'
import { airtableResolveSchema, captureSchema, deviceSchema, newTodoSchema, patchTodoSchema, replyResultSchema, replySendSchema, repliesInSchema, scheduleSchema, suggestionSchema } from './schemas'
import type { ReplyChannel, ReplyStatus } from '../../src/model/types'
import { detectClient, parseFilter, type TodoService } from './service'
import { generateToken, hashToken } from './tokens'
import { postAirtableComment, resolveAirtable } from './airtable'
import { runCalendarScan, type PrepJudge } from './calendarScan'
import { runChatScan } from './chatScan'
import type { GoogleService } from './google'
import type { PushService } from './push'
import { scheduleTodo } from './schedule'
import type { Fetch } from './googleAuth'

export interface ApiRequest {
  method: string
  /** Pad zonder query; een voorloop `/api` wordt weggehaald. */
  path: string
  query: Record<string, string | undefined>
  headers: Record<string, string | undefined>
  body: unknown
  rawBody?: Buffer
}

export interface ApiResponse {
  status: number
  headers?: Record<string, string>
  body?: unknown
}

export interface ApiDeps {
  service: TodoService
  auth: AuthDeps
  /** null = geen sleutel: capture valt terug op de vaste parser. */
  ai: AiCapture | null
  transcribe?: (audio: Buffer, mimeType: string) => Promise<string>
  /** Log een fout zonder de gebruiker lastig te vallen. */
  onError?: (e: unknown) => void
  /** Koppeling met Google (agenda en chat). Ontbreekt = 501. */
  google?: GoogleService
  /** Haiku-beoordeling van afspraken; null of weg = alleen de regels. */
  prepJudge?: PrepJudge | null
  /** Persoonlijk Airtable-token (secret AIRTABLE_API_TOKEN). */
  airtableToken?: () => string | undefined
  push?: PushService
  /** Publieke basis-URL van de site (voor de terugkeer van Google). */
  baseUrl?: string
  /** Alleen voor tests: vervangt `fetch` bij Airtable. */
  fetch?: Fetch
}

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024

export function normalizePath(path: string): string {
  const p = path.replace(/^\/api(?=\/|$)/, '').replace(/\/+$/, '')
  return p === '' ? '/' : p
}

const json = (status: number, body: unknown): ApiResponse => ({ status, body })

export function errorResponse(e: unknown, onError?: (e: unknown) => void): ApiResponse {
  if (e instanceof HttpError) return json(e.status, { error: { code: e.code, message: e.message } })
  if (e instanceof z.ZodError) {
    const message = e.issues.map((i) => `${i.path.join('.') || 'invoer'}: ${i.message}`).join('; ')
    return json(400, { error: { code: 'invalid_input', message, issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } })
  }
  onError?.(e)
  return json(500, { error: { code: 'internal', message: 'Er ging iets mis op de server.' } })
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  if (body === undefined || body === null || typeof body !== 'object') throw badRequest('Stuur een JSON-body mee.', 'invalid_json')
  return schema.parse(body)
}

export async function handleApi(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  try {
    return await route(req, deps)
  } catch (e) {
    return errorResponse(e, deps.onError)
  }
}

async function route(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const { service } = deps
  const method = req.method.toUpperCase()
  const path = normalizePath(req.path)

  if (path === '/' || path === '/health') return json(200, { ok: true })

  // De terugkeer van Google heeft geen Bearer-token; de eenmalige `state` zegt van wie de koppeling is.
  if (path === '/google/callback' && method === 'GET') return googleCallback(req, deps)

  const auth = await authenticate(req.headers.authorization, deps.auth)
  if (!auth) throw new HttpError(401, 'unauthorized', 'Geen geldig token. Stuur "Authorization: Bearer <token>" mee.')
  const uid = auth.uid

  // --- tokenbeheer: alleen vanuit de app zelf (ID-token) ---
  if (path === '/tokens' || path.startsWith('/tokens/')) return tokens(req, method, path, auth, deps)

  if (path === '/capture' && method === 'POST') {
    const input = parseBody(captureSchema, req.body)
    const projects = await service.listProjects(uid)
    const today = service.today()
    const result = await runCapture({ text: input.text, projects, today, sourceLabel: input.source?.label }, deps.ai, deps.onError)
    if (input.dryRun) {
      const names = new Map(projects.map((p: Project) => [p.id, p.name]))
      return json(200, {
        dryRun: true,
        engine: result.engine,
        todos: result.items.map((i) => ({ ...i, projectName: i.projectId ? (names.get(i.projectId) ?? null) : null })),
      })
    }
    const source = input.source ?? { type: 'api' as const }
    const todos = []
    for (const item of result.items) {
      todos.push(await service.addTodo(uid, { ...item, source }, projects))
    }
    return json(201, { dryRun: false, engine: result.engine, todos })
  }

  if (path === '/todos' && method === 'GET') {
    const limit = req.query.limit ? Math.min(500, Math.max(1, Number(req.query.limit) || 0)) || undefined : undefined
    const todos = await service.listTodos(uid, parseFilter(req.query.filter), limit)
    return json(200, { todos })
  }
  if (path === '/todos' && method === 'POST') {
    const todo = await service.addTodo(uid, parseBody(newTodoSchema, req.body))
    return json(201, { todo })
  }

  const todoMatch = /^\/todos\/([^/]+)(\/complete|\/schedule)?$/.exec(path)
  if (todoMatch) {
    const id = decodeURIComponent(todoMatch[1])
    if (todoMatch[2] === '/schedule') {
      if (method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Gebruik POST.')
      const input = parseBody(scheduleSchema, req.body)
      const r = await scheduleTodo({ service, google: need(deps.google, 'Koppelen met Google is nog niet ingesteld.') }, uid, id, input.minutes, { replace: input.replace })
      return json(200, r)
    }
    if (todoMatch[2]) {
      if (method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Gebruik POST.')
      const r = await service.completeTodo(uid, id)
      return json(200, { todo: r.todo, recurred: r.recurred, alreadyDone: r.alreadyDone })
    }
    if (method === 'GET') return json(200, { todo: await service.getTodo(uid, id) })
    if (method === 'PATCH') return json(200, { todo: await service.updateTodo(uid, id, parseBody(patchTodoSchema, req.body)) })
    throw new HttpError(405, 'method_not_allowed', 'Gebruik GET of PATCH.')
  }

  if (path === '/suggestions' && method === 'POST') {
    const r = await service.suggest(uid, parseBody(suggestionSchema, req.body))
    return json(r.created ? 201 : 200, r)
  }

  if (path === '/brief' && method === 'GET') return json(200, await buildBrief(service, uid))
  if (path === '/projects' && method === 'GET') {
    const projects = await service.listProjects(uid)
    return json(200, { projects: projects.map((p) => ({ id: p.id, name: p.name, keywords: p.keywords })) })
  }

  if (path === '/google' || path.startsWith('/google/')) return google(method, path, auth, deps)
  if (path === '/replies' || path.startsWith('/replies/')) return replies(req, method, path, auth, deps)

  if (path === '/scan/calendar' && method === 'POST') {
    const g = need(deps.google, 'Koppelen met Google is nog niet ingesteld.')
    return json(200, await runCalendarScan({ repo: service.repo, service, google: g, ai: deps.prepJudge ?? null, onError: deps.onError }, uid))
  }
  if (path === '/scan/chat' && method === 'POST') {
    const g = need(deps.google, 'Koppelen met Google is nog niet ingesteld.')
    return json(200, await runChatScan({ repo: service.repo, service, google: g, ai: null, onError: deps.onError }, uid))
  }

  if (path === '/airtable/resolve' && method === 'POST') {
    const { url } = parseBody(airtableResolveSchema, req.body)
    const token = deps.airtableToken?.()
    if (!token) throw new HttpError(501, 'not_available', 'Airtable is nog niet gekoppeld op de server (AIRTABLE_API_TOKEN).')
    const r = await resolveAirtable(url, token, deps.fetch)
    const projects = await service.listProjects(uid)
    const projectId = detectClient([r.baseName ?? undefined, r.recordName ?? undefined], projects)
    return json(200, { ...r, projectId })
  }

  if (path === '/push/devices' || path.startsWith('/push/')) return pushRoutes(req, method, path, auth, deps)

  if (path === '/transcribe' && method === 'POST') {
    if (!deps.transcribe) throw new HttpError(501, 'not_available', 'Spraakherkenning is nog niet ingesteld.')
    const audio = req.rawBody
    if (!audio || audio.length === 0) throw badRequest('Stuur het geluidsbestand als body mee (Content-Type: audio/...).', 'no_audio')
    if (audio.length > MAX_AUDIO_BYTES) throw new HttpError(413, 'too_large', 'Het geluidsbestand is te groot (maximaal 10 MB).')
    const mime = (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim()
    const text = await deps.transcribe(audio, mime)
    return json(200, { text })
  }

  throw notFound('Dit adres bestaat niet')
}

async function tokens(req: ApiRequest, method: string, path: string, auth: AuthResult, deps: ApiDeps): Promise<ApiResponse> {
  if (auth.via !== 'idToken') throw new HttpError(403, 'forbidden', 'Tokens beheer je alleen vanuit de app zelf.')
  const { repo } = deps.service
  if (path === '/tokens' && method === 'GET') {
    const list = await repo.listTokens(auth.uid)
    return json(200, {
      tokens: list
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .filter((t) => t.kind !== 'oauth_refresh')
        .map((t) => ({ id: t.id, name: t.name, kind: t.kind, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt })),
    })
  }
  if (path === '/tokens' && method === 'POST') {
    const { name } = parseBody(z.object({ name: z.string().trim().min(1).max(100) }), req.body)
    const token = generateToken('personal')
    const hash = hashToken(token)
    const createdAt = deps.service.stamp()
    await repo.saveToken({ id: hash.slice(0, 12), hash, uid: auth.uid, name, kind: 'personal', createdAt, lastUsedAt: null, expiresAt: null })
    // Dit is het enige moment waarop het token zelf te zien is.
    return json(201, { token, id: hash.slice(0, 12), name, createdAt })
  }
  const m = /^\/tokens\/([^/]+)$/.exec(path)
  if (m && method === 'DELETE') {
    const id = decodeURIComponent(m[1])
    // ook het bijbehorende refresh-token van een OAuth-koppeling moet weg
    const all = await repo.listTokens(auth.uid)
    const target = all.find((t) => t.id === id)
    if (!target) throw notFound('Dit token bestaat niet')
    await repo.deleteToken(auth.uid, id)
    if (target.kind === 'oauth_access' && target.clientId) {
      for (const t of all.filter((x) => x.kind === 'oauth_refresh' && x.clientId === target.clientId)) await repo.deleteTokenByHash(t.hash)
    }
    return { status: 204 }
  }
  throw new HttpError(405, 'method_not_allowed', 'Deze methode kan hier niet.')
}

function need<T>(dep: T | undefined, message: string): T {
  if (!dep) throw new HttpError(501, 'not_available', message)
  return dep
}

const redirect = (to: string): ApiResponse => ({ status: 302, headers: { Location: to, 'Cache-Control': 'no-store' } })

async function googleCallback(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const base = deps.baseUrl ?? ''
  const back = (result: string, extra = '') => redirect(`${base}/instellingen?google=${result}${extra}`)
  const g = deps.google
  if (!g) return back('fout')
  const { code, state, error } = req.query
  if (error) return back('geweigerd')
  if (!code || !state) return back('fout')
  try {
    const r = await g.finishConnect(code, state, `${base}/api/google/callback`)
    return back(r.missing.length ? 'gedeeltelijk' : 'ok')
  } catch (e) {
    if (!(e instanceof HttpError)) deps.onError?.(e)
    return back('fout', e instanceof HttpError ? `&reden=${encodeURIComponent(e.message)}` : '')
  }
}

async function google(method: string, path: string, auth: AuthResult, deps: ApiDeps): Promise<ApiResponse> {
  const g = need(deps.google, 'Koppelen met Google is nog niet ingesteld op de server.')
  if (path === '/google/status' && method === 'GET') return json(200, await g.status(auth.uid))
  // koppelen, ontkoppelen en een mail-toegangstoken alleen vanuit de app zelf, net als tokens
  if (auth.via !== 'idToken') throw new HttpError(403, 'forbidden', 'Google koppel je alleen vanuit de app zelf.')
  if (path === '/google/token' && method === 'GET') return json(200, await g.mailToken(auth.uid))
  if (path === '/google/connect' && method === 'POST') {
    const base = deps.baseUrl ?? ''
    return json(200, { url: await g.startConnect(auth.uid, `${base}/api/google/callback`) })
  }
  if (path === '/google' && method === 'DELETE') {
    await g.disconnect(auth.uid)
    return { status: 204 }
  }
  throw new HttpError(405, 'method_not_allowed', 'Deze methode kan hier niet.')
}

const list = (v: string | undefined) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined)

/**
 * Tab Antwoorden.
 * - POST /replies: Claude zet kaarten klaar (altijd als "open").
 * - GET /replies?status=approved&channel=teams,slack: het verzendscript haalt de wachtrij op.
 * - POST /replies/:id/result: het verzendscript meldt voortgang (sending → sent/failed).
 * - POST /replies/:id/send: Google Chat of Airtable versturen — alleen vanuit de app (vinkje), nooit met een token van Claude.
 */
async function replies(req: ApiRequest, method: string, path: string, auth: AuthResult, deps: ApiDeps): Promise<ApiResponse> {
  const { service } = deps
  if (path === '/replies' && method === 'POST') {
    const { replies: input } = parseBody(repliesInSchema, req.body)
    return json(200, await service.saveReplies(auth.uid, input))
  }
  if (path === '/replies' && method === 'GET') {
    const status = list(req.query.status) as ReplyStatus[] | undefined
    const channel = list(req.query.channel) as ReplyChannel[] | undefined
    return json(200, { replies: await service.listReplies(auth.uid, { status, channel }) })
  }
  const result = /^\/replies\/([^/]+)\/result$/.exec(path)
  if (result && method === 'POST') {
    const { status, error } = parseBody(replyResultSchema, req.body)
    return json(200, { reply: await service.setReplyResult(auth.uid, decodeURIComponent(result[1]), status, error) })
  }
  const send = /^\/replies\/([^/]+)\/send$/.exec(path)
  if (send && method === 'POST') {
    if (auth.via !== 'idToken') throw new HttpError(403, 'forbidden', 'Versturen kan alleen vanuit de app zelf, met het vinkje.')
    const { text } = parseBody(replySendSchema, req.body)
    const reply = await service.getReply(auth.uid, decodeURIComponent(send[1]))
    if (reply.channel === 'gchat') {
      const g = need(deps.google, 'Koppelen met Google is nog niet ingesteld op de server.')
      if (!reply.target.space) throw badRequest('Onbekend in welke space dit gesprek staat.', 'no_target')
      await g.sendChat(auth.uid, reply.target.space, text, reply.target.thread)
      return json(200, { sent: true })
    }
    if (reply.channel === 'airtable') {
      const token = need(deps.airtableToken?.(), 'Airtable is nog niet ingesteld op de server (AIRTABLE_API_TOKEN).')
      const { baseId, tableId, recordId, parentCommentId } = reply.target
      if (!baseId || !tableId || !recordId) throw badRequest('Onbekend op welk Airtable-record deze reactie hoort.', 'no_target')
      await postAirtableComment(token, { baseId, tableId, recordId, parentCommentId }, text, deps.fetch)
      return json(200, { sent: true })
    }
    throw badRequest('Dit kanaal verstuurt niet via de server.', 'wrong_channel')
  }
  throw new HttpError(405, 'method_not_allowed', 'Deze methode kan hier niet.')
}

async function pushRoutes(req: ApiRequest, method: string, path: string, auth: AuthResult, deps: ApiDeps): Promise<ApiResponse> {
  const push = need(deps.push, 'Meldingen zijn nog niet ingesteld op de server.')
  if (path === '/push/devices' && method === 'GET') {
    const list = await deps.service.repo.listDevices(auth.uid)
    return json(200, { devices: list.map((d) => ({ id: d.id, label: d.label, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt })) })
  }
  if (path === '/push/devices' && method === 'POST') {
    const { token, label } = parseBody(deviceSchema, req.body)
    const d = await push.register(auth.uid, token, label)
    return json(201, { id: d.id, label: d.label })
  }
  const m = /^\/push\/devices\/([^/]+)$/.exec(path)
  if (m && method === 'DELETE') {
    if (!(await push.unregister(auth.uid, decodeURIComponent(m[1])))) throw notFound('Dit apparaat bestaat niet')
    return { status: 204 }
  }
  if (path === '/push/test' && method === 'POST') {
    const sent = await push.sendToUser(auth.uid, { title: 'Test', body: 'Meldingen werken.', url: '/instellingen', tag: 'test' })
    return json(200, { sent })
  }
  throw new HttpError(405, 'method_not_allowed', 'Deze methode kan hier niet.')
}
