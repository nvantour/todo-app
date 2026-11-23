import type { CalEvent, ChatMessage, ChatSpace, ChatUser, GoogleApi, NewCalEvent } from '../src/googleApi'
import type { GoogleService } from '../src/google'
import { GOOGLE_SCOPES } from '../src/googleAuth'
import type { GoogleConnection } from '../src/repo'
import { UID, setup } from './helpers'

export const ME = '1001'
export const ALL_SCOPES = GOOGLE_SCOPES.filter((s) => s !== 'openid' && s !== 'email')

export interface FakeData {
  events?: CalEvent[]
  spaces?: ChatSpace[]
  messages?: Record<string, ChatMessage[]>
  members?: Record<string, ChatUser[]>
  scopes?: string[]
  failMessages?: boolean
}

/** Een nep-Google: geen netwerk, wel dezelfde vorm als de echte aanroepen. */
export function fakeGoogle(data: FakeData = {}) {
  const inserted: NewCalEvent[] = []
  const deleted: string[] = []
  const posted: { space: string; text: string; thread?: string }[] = []
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
  }
  const conn: GoogleConnection = {
    uid: UID,
    email: 'nino@onlinedialogue.com',
    googleId: ME,
    refreshToken: 'r',
    scopes: data.scopes ?? ALL_SCOPES,
    connectedAt: '2026-11-01T00:00:00.000Z',
  }
  const google = { connection: async () => conn, api: async () => api } as unknown as GoogleService
  return { google, api, conn, inserted, deleted }
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
