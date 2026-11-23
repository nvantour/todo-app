// Aanroepen naar de Agenda- en Chat-API van Google, met het toegangstoken van de gebruiker.
// Bronnen:
//   https://developers.google.com/workspace/calendar/api/v3/reference/events/list
//   https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
//   https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces/list
//   https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/list
import { HttpError } from './errors'
import type { Fetch } from './googleAuth'

export interface CalEvent {
  id: string
  status?: 'confirmed' | 'tentative' | 'cancelled'
  summary?: string
  htmlLink?: string
  /** Hele dag: `date` (YYYY-MM-DD). Met tijd: `dateTime` (RFC 3339). */
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string; timeZone?: string }
  attendees?: { email?: string; self?: boolean; responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted'; resource?: boolean; organizer?: boolean }[]
  recurringEventId?: string
  eventType?: 'birthday' | 'default' | 'focusTime' | 'fromGmail' | 'outOfOffice' | 'workingLocation'
  transparency?: 'opaque' | 'transparent'
  organizer?: { email?: string; self?: boolean }
}

export interface NewCalEvent {
  summary: string
  description?: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
}

export interface ChatUser {
  /** `users/{id}`; het id is hetzelfde als het Google-account-id. */
  name?: string
  displayName?: string
  type?: 'HUMAN' | 'BOT' | 'TYPE_UNSPECIFIED'
}

export interface ChatSpace {
  name: string
  spaceType?: 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE'
  displayName?: string
  spaceUri?: string
  lastActiveTime?: string
  spaceThreadingState?: 'THREADED_MESSAGES' | 'GROUPED_MESSAGES' | 'UNTHREADED_MESSAGES'
  singleUserBotDm?: boolean
}

export interface ChatMessage {
  /** `spaces/{space}/messages/{message}` */
  name: string
  sender?: ChatUser
  createTime?: string
  deleteTime?: string
  text?: string
  argumentText?: string
  thread?: { name?: string }
  threadReply?: boolean
  annotations?: { type?: string; userMention?: { user?: ChatUser; type?: 'MENTION' | 'ADD' | string } }[]
}

export interface GmailHeader {
  name: string
  value: string
}

export interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { data?: string; size?: number; attachmentId?: string }
  parts?: GmailPart[]
}

export interface GmailMessage {
  id: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  /** Ontvangen op: milliseconden sinds 1970, als tekst. */
  internalDate?: string
  payload?: GmailPart
}

export interface GmailThread {
  id: string
  messages?: GmailMessage[]
}

/** De kopregels die de scan nodig heeft om te bepalen of een mail van een mens is en aan wie hij gericht is. */
export const MAIL_SCAN_HEADERS = ['From', 'To', 'Cc', 'Subject', 'List-Unsubscribe', 'List-Id', 'Auto-Submitted', 'Precedence', 'X-Autoreply', 'X-Autorespond']

const CAL = 'https://www.googleapis.com/calendar/v3'
const CHAT = 'https://chat.googleapis.com/v1'
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

export interface GoogleApi {
  listEvents(timeMin: string, timeMax: string): Promise<CalEvent[]>
  insertEvent(event: NewCalEvent): Promise<CalEvent>
  /** Verwijdert een afspraak; bestaat hij niet meer, dan is dat ook goed. */
  deleteEvent(id: string): Promise<void>
  listSpaces(): Promise<ChatSpace[]>
  /** Berichten van een space sinds `afterISO`, oudste eerst. */
  listMessages(space: string, afterISO: string): Promise<ChatMessage[]>
  /** Leden van een space (voor namen). */
  listMembers(space: string): Promise<ChatUser[]>
  /** Bericht plaatsen als de gebruiker; met `thread` als antwoord in die thread. */
  createMessage(space: string, text: string, thread?: string): Promise<ChatMessage>
  /** Ids van mail-threads die bij een zoekopdracht in Gmail-taal horen (nieuwste eerst), hooguit `max`. */
  listMailThreads(query: string, max: number): Promise<string[]>
  /** Eén mail-thread: `metadata` = alleen kopregels en labels, `full` = met de tekst. */
  getMailThread(id: string, format: 'metadata' | 'full'): Promise<GmailThread>
}

const MAX_PAGES = 10

export function createGoogleApi(accessToken: string, fetchImpl: Fetch = fetch): GoogleApi {
  async function call<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...init?.headers },
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } }
      const msg = body.error?.message ?? `status ${res.status}`
      // Aanzetten van de API in het Google-project is een eenmalige handeling van de eigenaar.
      if (res.status === 403) throw new HttpError(502, 'google_forbidden', `Google weigerde de aanvraag: ${msg}`)
      throw new HttpError(502, 'google_unavailable', `Google gaf een fout: ${msg}`)
    }
    return (await res.json()) as T
  }

  async function paged<T>(base: string, params: Record<string, string>, key: string): Promise<T[]> {
    const out: T[] = []
    let pageToken: string | undefined
    for (let i = 0; i < MAX_PAGES; i++) {
      const u = new URL(base)
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
      if (pageToken) u.searchParams.set('pageToken', pageToken)
      const body = await call<Record<string, unknown> & { nextPageToken?: string }>(u.toString())
      out.push(...((body[key] as T[] | undefined) ?? []))
      pageToken = body.nextPageToken
      if (!pageToken) break
    }
    return out
  }

  return {
    listEvents: (timeMin, timeMax) =>
      paged<CalEvent>(`${CAL}/calendars/primary/events`, { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' }, 'items'),

    insertEvent: (event) =>
      call<CalEvent>(`${CAL}/calendars/primary/events?sendUpdates=none`, { method: 'POST', body: JSON.stringify(event) }),

    deleteEvent: async (id) => {
      const res = await fetchImpl(`${CAL}/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=none`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } })
      if (!res.ok && res.status !== 404 && res.status !== 410) throw new HttpError(502, 'google_unavailable', `Google gaf een fout bij het verwijderen (${res.status}).`)
    },

    listSpaces: () => paged<ChatSpace>(`${CHAT}/spaces`, { pageSize: '1000' }, 'spaces'),

    listMessages: (space, afterISO) =>
      paged<ChatMessage>(`${CHAT}/${space}/messages`, { pageSize: '1000', filter: `createTime > "${afterISO}"` }, 'messages'),

    createMessage: (space, text, thread) => {
      const u = new URL(`${CHAT}/${space}/messages`)
      if (thread) u.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD')
      return call<ChatMessage>(u.toString(), { method: 'POST', body: JSON.stringify(thread ? { text, thread: { name: thread } } : { text }) })
    },

    listMembers: async (space) => {
      const members = await paged<{ member?: ChatUser }>(`${CHAT}/${space}/members`, { pageSize: '1000' }, 'memberships')
      return members.map((m) => m.member).filter((m): m is ChatUser => Boolean(m))
    },

    listMailThreads: async (query, max) => {
      const out: string[] = []
      let pageToken: string | undefined
      for (let i = 0; i < MAX_PAGES && out.length < max; i++) {
        const u = new URL(`${GMAIL}/threads`)
        u.searchParams.set('q', query)
        u.searchParams.set('maxResults', String(Math.min(100, max - out.length)))
        if (pageToken) u.searchParams.set('pageToken', pageToken)
        const body = await call<{ threads?: { id: string }[]; nextPageToken?: string }>(u.toString())
        out.push(...(body.threads ?? []).map((t) => t.id))
        pageToken = body.nextPageToken
        if (!pageToken) break
      }
      return out
    },

    getMailThread: (id, format) => {
      const u = new URL(`${GMAIL}/threads/${encodeURIComponent(id)}`)
      u.searchParams.set('format', format)
      if (format === 'metadata') for (const h of MAIL_SCAN_HEADERS) u.searchParams.append('metadataHeaders', h)
      return call<GmailThread>(u.toString())
    },
  }
}
