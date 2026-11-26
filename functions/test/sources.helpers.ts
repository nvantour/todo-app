import type { CalEvent, ChatMessage, ChatSpace, ChatUser, GmailMessage, GmailThread, GoogleApi, NewCalEvent } from '../src/googleApi'
import type { GoogleService } from '../src/google'
import { GOOGLE_SCOPES, SCOPE_CHAT_MESSAGES, SCOPE_CHAT_SPACES } from '../src/googleAuth'
import type { GoogleConnection } from '../src/repo'
import { UID, setup } from './helpers'

export const ME = '1001'
export const ALL_SCOPES = GOOGLE_SCOPES.filter((s) => s !== 'openid' && s !== 'email')
/** Alleen Google Chat lezen toegestaan (geen mail). */
export const CHAT_ONLY = [SCOPE_CHAT_MESSAGES, SCOPE_CHAT_SPACES]
export const MY_MAIL = 'nino@onlinedialogue.com'

export interface FakeData {
  events?: CalEvent[]
  spaces?: ChatSpace[]
  messages?: Record<string, ChatMessage[]>
  members?: Record<string, ChatUser[]>
  scopes?: string[]
  failMessages?: boolean
  /** Mail-threads in de inbox (id → thread, met tekst). */
  mail?: GmailThread[]
  failMail?: boolean
}

/** Een nep-Google: geen netwerk, wel dezelfde vorm als de echte aanroepen. */
export function fakeGoogle(data: FakeData = {}) {
  const inserted: NewCalEvent[] = []
  const deleted: string[] = []
  const posted: { space: string; text: string; thread?: string }[] = []
  const reacted: { message: string; emoji: string }[] = []
  const api: GoogleApi = {
    listEvents: async () => data.events ?? [],
    insertEvent: async (e) => {
      inserted.push(e)
      return { id: `evt-${inserted.length}` }
    },
    deleteEvent: async (id) => void deleted.push(id),
    listSpaces: async () => data.spaces ?? [],
    listMessages: async (space) => {
      if (data.failMessages) throw new Error('stuk')
      return data.messages?.[space] ?? []
    },
    listMembers: async (space) => data.members?.[space] ?? [],
    createMessage: async (space, text, thread) => {
      posted.push({ space, text, thread })
      return { name: `${space}/messages/m${posted.length}` }
    },
    createReaction: async (message, emoji) => void reacted.push({ message, emoji }),
    listMailThreads: async () => (data.mail ?? []).map((t) => t.id),
    getMailThread: async (id) => {
      if (data.failMail) throw new Error('stuk')
      const t = (data.mail ?? []).find((x) => x.id === id)
      if (!t) throw new Error('bestaat niet')
      return structuredClone(t)
    },
  }
  const conn: GoogleConnection = {
    uid: UID,
    email: MY_MAIL,
    googleId: ME,
    refreshToken: 'r',
    scopes: data.scopes ?? ALL_SCOPES,
    connectedAt: '2026-11-01T00:00:00.000Z',
  }
  const google = { connection: async () => conn, api: async () => api } as unknown as GoogleService
  return { google, api, conn, inserted, deleted, posted, reacted }
}

export function scanSetup(data: FakeData = {}, opts: Parameters<typeof setup>[0] = {}) {
  const ctx = setup(opts)
  return { ...ctx, ...fakeGoogle(data) }
}

export const timed = (id: string, summary: string, startISO: string, over: Partial<CalEvent> = {}): CalEvent => ({
  id,
  summary,
  htmlLink: `https://calendar.google.com/event?eid=${id}`,
  start: { dateTime: startISO },
  end: { dateTime: new Date(Date.parse(startISO) + 3_600_000).toISOString() },
  ...over,
})

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url')

export interface MailOpts {
  to?: string
  cc?: string
  subject?: string
  /** ISO-tijd van ontvangst. */
  at?: string
  labels?: string[]
  headers?: Record<string, string>
  text?: string
  html?: string
  snippet?: string
}

let mailCount = 0

/** Eén mailbericht zoals Gmail het teruggeeft (met tekst). */
export function mailMsg(from: string, o: MailOpts = {}): GmailMessage {
  const headers = [
    { name: 'From', value: from },
    { name: 'To', value: o.to ?? `Nino <${MY_MAIL}>` },
    ...(o.cc ? [{ name: 'Cc', value: o.cc }] : []),
    { name: 'Subject', value: o.subject ?? 'Vraag' },
    ...Object.entries(o.headers ?? {}).map(([name, value]) => ({ name, value })),
  ]
  const part = (mimeType: string, body: string) => ({ mimeType, headers: [{ name: 'Content-Type', value: `${mimeType}; charset="UTF-8"` }], body: { data: b64(body), size: body.length } })
  const parts = [...(o.html !== undefined ? [part('text/html', o.html)] : []), ...(o.text !== undefined || o.html === undefined ? [part('text/plain', o.text ?? 'Hoi Nino, kun je hier naar kijken?')] : [])]
  return {
    id: `msg-${++mailCount}`,
    labelIds: o.labels ?? ['INBOX'],
    snippet: o.snippet ?? (o.text ?? '').slice(0, 100),
    internalDate: String(Date.parse(o.at ?? '2026-11-17T09:00:00Z')),
    payload: { mimeType: 'multipart/alternative', headers, parts },
  }
}

export const mailThread = (id: string, ...messages: GmailMessage[]): GmailThread => ({ id, messages })
