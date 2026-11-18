import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { onRequest, type Request } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions/v2'
import type { Response } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { handleApi, normalizePath, type ApiRequest, type ApiResponse } from './api'
import { authenticate, type AuthDeps } from './auth'
import { createHaikuCapture, type AiCapture } from './capture'
import { FirestoreRepo } from './firestoreRepo'
import { createMcpServer } from './mcp'
import { createHaikuPrepJudge, type PrepJudge } from './calendarScan'
import { fcmSender } from './fcm'
import { GoogleService } from './google'
import { calendarScanAll, chatScanAll, dueNowPushAll, morningPushAll, type JobDeps } from './jobs'
import { PushService } from './push'
import { scheduleTodo } from './schedule'
import { handleOAuth, wwwAuthenticate } from './oauth'
import { TodoService } from './service'
import { transcribeAudio } from './transcribe'

initializeApp()

// Bewust geen Claude API-sleutel: de slimme stappen lopen via Claude zelf (MCP-koppeling, eigen abonnement).
// Wie later toch een sleutel wil gebruiken: maak hier weer een defineSecret van en bind hem aan de functies.
const anthropicKey = (): string => process.env.ANTHROPIC_API_KEY ?? ''
const ELEVENLABS_API_KEY = defineSecret('ELEVENLABS_API_KEY')
const GOOGLE_CLIENT_ID = defineSecret('GOOGLE_CLIENT_ID')
const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET')
const AIRTABLE_API_TOKEN = defineSecret('AIRTABLE_API_TOKEN')

const REGION = 'europe-west1'
const repo = new FirestoreRepo()
const service = new TodoService(repo)

const google = new GoogleService({
  repo,
  config: () => {
    const clientId = GOOGLE_CLIENT_ID.value()
    const clientSecret = GOOGLE_CLIENT_SECRET.value()
    // '-' is de tijdelijke waarde zolang de Google-koppeling nog niet is ingesteld
    return clientId && clientSecret && clientId !== '-' && clientSecret !== '-' ? { clientId, clientSecret } : null
  },
})
const push = new PushService(repo, service, fcmSender)

const allowedEmails = () =>
  (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

const authDeps = (): AuthDeps => ({
  repo,
  allowedEmails: allowedEmails(),
  verifyIdToken: async (token) => {
    const d = await getAuth().verifyIdToken(token)
    return { uid: d.uid, email: d.email }
  },
})

let ai: AiCapture | null | undefined
function aiCapture(): AiCapture | null {
  if (ai === undefined) {
    const key = anthropicKey()
    ai = key ? createHaikuCapture(key) : null
  }
  return ai
}

let judge: PrepJudge | null | undefined
function prepJudge(): PrepJudge | null {
  if (judge === undefined) {
    const key = anthropicKey()
    judge = key ? createHaikuPrepJudge(key) : null
  }
  return judge
}

const jobDeps = (): JobDeps => ({ repo, service, google, prepJudge: prepJudge(), push, onError: (e) => logger.error(e) })

// --- CORS ---

const ORIGIN_OK = [/^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/]
function originAllowed(origin: string | undefined): origin is string {
  if (!origin) return false
  const extra = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  return extra.includes(origin) || ORIGIN_OK.some((re) => re.test(origin))
}

function cors(req: Request, res: Response) {
  const origin = req.headers.origin
  res.setHeader('Vary', 'Origin')
  if (originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
}

function toApiRequest(req: Request): ApiRequest {
  return {
    method: req.method,
    path: req.path,
    query: Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, typeof v === 'string' ? v : undefined])),
    headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
    body: req.body,
    rawBody: req.rawBody,
  }
}

function send(res: Response, r: ApiResponse) {
  for (const [k, v] of Object.entries(r.headers ?? {})) res.setHeader(k, v)
  if (r.body === undefined) res.status(r.status).end()
  else if (typeof r.body === 'string') res.status(r.status).send(r.body)
  else res.status(r.status).json(r.body)
}

/** Publieke basis-URL (via Firebase Hosting komt de echte host in x-forwarded-host). */
function baseUrl(req: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '')
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host
  return `https://${host}`
}

// --- api ---

export const api = onRequest(
  { region: REGION, secrets: [ELEVENLABS_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AIRTABLE_API_TOKEN], maxInstances: 5, memory: '512MiB', timeoutSeconds: 120, invoker: 'public' },
  async (req, res) => {
    cors(req, res)
    if (req.method === 'OPTIONS') return void res.status(204).end()
    const r = await handleApi(toApiRequest(req), {
      service,
      auth: authDeps(),
      ai: aiCapture(),
      transcribe: transcribeAudio,
      onError: (e) => logger.error(e),
      google,
      prepJudge: prepJudge(),
      airtableToken: () => AIRTABLE_API_TOKEN.value() || undefined,
      push,
      baseUrl: baseUrl(req),
    })
    send(res, r)
  },
)

// --- mcp (Streamable HTTP, stateless) ---

export const mcp = onRequest(
  { region: REGION, secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET], maxInstances: 5, memory: '512MiB', timeoutSeconds: 60, invoker: 'public' },
  async (req, res) => {
    cors(req, res)
    if (req.method === 'OPTIONS') return void res.status(204).end()
    const auth = await authenticate(req.headers.authorization, authDeps())
    if (!auth) {
      res.setHeader('WWW-Authenticate', wwwAuthenticate(baseUrl(req)))
      return void res.status(401).json({ error: { code: 'unauthorized', message: 'Geen geldig token.' } })
    }
    if (req.method !== 'POST') {
      // stateless: geen losse stroom (GET) en geen sessies (DELETE)
      res.setHeader('Allow', 'POST')
      return void res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null })
    }
    const server = createMcpServer(service, auth.uid, (id, minutes, replace) => scheduleTodo({ service, google }, auth.uid, id, minutes, { replace }))
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (e) {
      logger.error(e)
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
    }
  },
)

// --- oauth (voor de Claude-app als custom connector) ---

export const oauth = onRequest({ region: REGION, maxInstances: 3, memory: '256MiB', timeoutSeconds: 30, invoker: 'public' }, async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') return void res.status(204).end()
  const r = await handleOAuth({ ...toApiRequest(req), path: normalizePath(req.path) }, { repo }, baseUrl(req))
  send(res, r)
})


// --- geplande taken (Cloud Scheduler) ---
// Alles draait in de tijd van Nederland. Elke taak slaat zijn eigen fouten op en logt ze; de volgende ronde probeert opnieuw.

const SCAN_SECRETS = [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET]

/** Dagelijks 07:00: agenda van de komende 14 dagen doorlopen. */
export const calendarScan = onSchedule(
  { schedule: '0 7 * * *', timeZone: 'Europe/Amsterdam', region: REGION, secrets: SCAN_SECRETS, memory: '512MiB', timeoutSeconds: 300, retryCount: 0 },
  async () => void (await calendarScanAll(jobDeps())),
)

/** Twee keer per werkdag (09:00 en 15:00): chatberichten waar nog op gereageerd moet worden. */
export const chatScan = onSchedule(
  { schedule: '0 9,15 * * 1-5', timeZone: 'Europe/Amsterdam', region: REGION, secrets: SCAN_SECRETS, memory: '512MiB', timeoutSeconds: 300, retryCount: 0 },
  async () => void (await chatScanAll(jobDeps())),
)

/** Elke ochtend 08:00: één melding met de taken van vandaag. */
export const morningPush = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'Europe/Amsterdam', region: REGION, memory: '256MiB', timeoutSeconds: 120, retryCount: 0 },
  async () => void (await morningPushAll(jobDeps())),
)

/** Elke 5 minuten tussen 06:00 en 22:00: melding voor taken waarvan de tijd is aangebroken. */
export const dueTimePush = onSchedule(
  { schedule: '*/5 6-21 * * *', timeZone: 'Europe/Amsterdam', region: REGION, memory: '256MiB', timeoutSeconds: 60, retryCount: 0 },
  async () => void (await dueNowPushAll(jobDeps())),
)
