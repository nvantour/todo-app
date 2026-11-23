// Google Chat lezen voor de antwoorden-scan: in welke gesprekken wacht iemand op jou?
// Vaste herkenning, geen AI. replyScan.ts zet de vondsten als kaart op de tab Antwoorden.
import type { IncomingReply } from '../../src/data/replies'
import type { Reply, ReplyMessage } from '../../src/model/types'
import { HttpError } from './errors'
import type { ChatMessage, ChatSpace, ChatUser, GoogleApi } from './googleApi'

/** Hoeveel dagen terug we kijken. */
export const CHAT_DAYS = 3
const MAX_SPACES = 80
const CONCURRENCY = 5

export interface SpaceMessages {
  space: ChatSpace
  messages: ChatMessage[]
  /** De berichten van deze space waren deze ronde niet te lezen. */
  unread?: boolean
}

export interface ReplyCandidate {
  kind: 'dm' | 'mention'
  space: ChatSpace
  message: ChatMessage
  senderId: string | null
  senderName: string | null
}

const t = (m: ChatMessage) => Date.parse(m.createTime ?? '') || 0

/**
 * Waar moet jij nog op reageren?
 * - Directe berichten: het laatste bericht van het gesprek is niet van jou.
 * - Vermeldingen (@jou) in spaces en groepsgesprekken: er is daarna geen bericht van jou in dezelfde thread
 *   (in een space zonder threads: daarna geen bericht van jou in de space).
 * Berichten van bots, verwijderde berichten en @iedereen tellen niet.
 */
export function findReplyCandidates(data: SpaceMessages[], meId: string): ReplyCandidate[] {
  const me = `users/${meId}`
  const out: ReplyCandidate[] = []
  for (const { space, messages } of data) {
    if (space.singleUserBotDm) continue
    const msgs = messages.filter((m) => !m.deleteTime && m.createTime).sort((a, b) => t(a) - t(b))
    if (!msgs.length) continue
    const human = (m: ChatMessage) => m.sender?.type !== 'BOT'
    const mine = (m: ChatMessage) => m.sender?.name === me
    const mk = (kind: ReplyCandidate['kind'], message: ChatMessage): ReplyCandidate => ({
      kind,
      space,
      message,
      senderId: message.sender?.name?.replace(/^users\//, '') ?? null,
      senderName: message.sender?.displayName ?? null,
    })

    if (space.spaceType === 'DIRECT_MESSAGE') {
      const last = msgs[msgs.length - 1]
      if (!mine(last) && human(last)) out.push(mk('dm', last))
      continue
    }

    const threaded = space.spaceThreadingState !== 'UNTHREADED_MESSAGES'
    const perThread = new Map<string, ChatMessage>()
    for (const m of msgs) {
      const mentionsMe = m.annotations?.some((a) => a.type === 'USER_MENTION' && a.userMention?.user?.name === me && (a.userMention.type ?? 'MENTION') === 'MENTION')
      if (!mentionsMe || mine(m) || !human(m)) continue
      const thread = threaded ? m.thread?.name : undefined
      const answered = msgs.some((o) => mine(o) && t(o) > t(m) && (!thread || o.thread?.name === thread))
      if (answered) continue
      perThread.set(thread ?? space.name, m) // de laatste vermelding per thread wint (msgs staan op tijd)
    }
    for (const m of perThread.values()) out.push(mk('mention', m))
  }
  return out
}

export function spaceUrl(space: ChatSpace): string {
  return space.spaceUri ?? `https://mail.google.com/mail/u/0/#chat/space/${space.name.replace(/^spaces\//, '')}`
}

export async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

/** Hoeveel berichten van het gesprek op de kaart komen. */
const SHOWN = 8
const MAX_TEXT = 4000

const live = (messages: ChatMessage[]) => messages.filter((m) => !m.deleteTime && m.createTime).sort((a, b) => t(a) - t(b))
const toIso = (v: string | undefined) => (v && Date.parse(v) ? new Date(v).toISOString() : null)

/** Leest de chats van de laatste dagen. Geeft een fout als geen enkele chat te lezen was. */
export async function readChats(api: GoogleApi, cutoff: string, onError?: (e: unknown) => void): Promise<SpaceMessages[]> {
  const spaces = (await api.listSpaces())
    .filter((s) => !s.singleUserBotDm && (!s.lastActiveTime || s.lastActiveTime >= cutoff))
    .sort((a, b) => (b.lastActiveTime ?? '').localeCompare(a.lastActiveTime ?? ''))
    .slice(0, MAX_SPACES)

  let failed = 0
  const data = await pool(spaces, CONCURRENCY, async (space): Promise<SpaceMessages> => {
    try {
      return { space, messages: await api.listMessages(space.name, cutoff) }
    } catch (e) {
      failed++
      onError?.(e)
      return { space, messages: [], unread: true }
    }
  })
  if (spaces.length > 0 && failed === spaces.length) throw new HttpError(502, 'google_unavailable', 'Geen enkele chat was te lezen. Is de Google Chat API aangezet?')
  return data
}

/** Namen die de API niet bij het bericht meegaf, opgezocht via de ledenlijst van de space. */
async function memberNames(api: GoogleApi, spaces: string[], onError?: (e: unknown) => void): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  await pool([...new Set(spaces)], CONCURRENCY, async (space) => {
    try {
      const members: ChatUser[] = await api.listMembers(space)
      for (const m of members) if (m.name && m.displayName) names.set(`${space}|${m.name}`, m.displayName)
    } catch (e) {
      onError?.(e)
    }
  })
  return names
}

/**
 * Kaarten voor de tab Antwoorden: één per gesprek waar iemand op jou wacht, met de laatste berichten
 * en zonder conceptantwoord (dat schrijft Claude later, of jij zelf).
 * Een DM of een space zonder threads is één gesprek; in een space met threads is elke thread er een.
 */
export async function chatCards(api: GoogleApi, data: SpaceMessages[], meId: string, onError?: (e: unknown) => void): Promise<IncomingReply[]> {
  const me = `users/${meId}`
  const picked = findReplyCandidates(data, meId).map((c) => {
    const all = live(data.find((d) => d.space.name === c.space.name)?.messages ?? [])
    const threaded = c.kind === 'mention' && c.space.spaceThreadingState !== 'UNTHREADED_MESSAGES'
    const thread = threaded ? c.message.thread?.name : undefined
    return { c, thread, shown: (thread ? all.filter((m) => m.thread?.name === thread) : all).slice(-SHOWN) }
  })
  const nameless = picked.filter((p) => p.shown.some((m) => !m.sender?.displayName)).map((p) => p.c.space.name)
  const names = await memberNames(api, nameless, onError)

  return picked.map(({ c, thread, shown }): IncomingReply => {
    const nameOf = (m: ChatMessage) => m.sender?.displayName ?? names.get(`${c.space.name}|${m.sender?.name}`) ?? null
    const who = nameOf(c.message) ?? 'een collega'
    return {
      channel: 'gchat',
      externalId: thread ?? c.space.name,
      title: c.kind === 'dm' ? `DM ${who}` : (c.space.displayName ?? `Gesprek met ${who}`),
      who,
      url: spaceUrl(c.space),
      target: thread ? { space: c.space.name, thread } : { space: c.space.name },
      messages: shown.map((m): ReplyMessage => ({
        author: nameOf(m) ?? 'Onbekend',
        text: (m.text ?? '').slice(0, MAX_TEXT),
        at: toIso(m.createTime),
        ...(m.sender?.name === me ? { mine: true } : {}),
      })),
      draft: '',
      reason:
        c.kind === 'dm'
          ? `${who} stuurde je een bericht waar je nog niet op hebt gereageerd.`
          : `${who} noemde je in ${c.space.displayName ?? 'een gesprek'}; je hebt nog niet gereageerd.`,
    }
  })
}

/** Wanneer de ander voor het laatst iets zei op deze kaart (ms); zonder tijden: wanneer de kaart is gemaakt. */
export function lastOtherAt(reply: Pick<Reply, 'messages' | 'createdAt'>): number {
  const times = reply.messages.filter((m) => !m.mine && m.at).map((m) => Date.parse(m.at!) || 0)
  return times.length ? Math.max(...times) : Date.parse(reply.createdAt) || 0
}

/**
 * Heb jij in dit gesprek gereageerd ná het laatste bericht van de ander op de kaart?
 * Alleen "ja" met bewijs: de space is deze ronde gelezen en er staat een later bericht van jou in.
 */
export function chatAnswered(reply: Pick<Reply, 'target' | 'messages' | 'createdAt'>, data: SpaceMessages[], meId: string): boolean {
  const found = data.find((d) => d.space.name === reply.target.space)
  if (!found || found.unread) return false
  const me = `users/${meId}`
  const since = lastOtherAt(reply)
  const perThread = found.space.spaceType !== 'DIRECT_MESSAGE' && found.space.spaceThreadingState !== 'UNTHREADED_MESSAGES' && !!reply.target.thread
  return live(found.messages).some((m) => m.sender?.name === me && t(m) > since && (!perThread || m.thread?.name === reply.target.thread))
}
