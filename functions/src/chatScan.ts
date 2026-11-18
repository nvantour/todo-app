import { HttpError } from './errors'
import { hasChat } from './google'
import type { ChatMessage, ChatSpace, ChatUser, GoogleApi } from './googleApi'
import type { ScanDeps, ScanResult } from './calendarScan'

/** Hoeveel dagen terug we kijken. */
export const CHAT_DAYS = 3
const MAX_SPACES = 80
const CONCURRENCY = 5

export interface SpaceMessages {
  space: ChatSpace
  messages: ChatMessage[]
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

/** Kort stuk tekst voor in de titel: één regel, zonder opmaak, afgekapt op een woord. */
export function shortGist(text: string | undefined, max = 60): string {
  const flat = (text ?? '').replace(/<[^>]+>/g, ' ').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  return `${cut.slice(0, Math.max(20, cut.lastIndexOf(' ')))}…`
}

export function spaceUrl(space: ChatSpace): string {
  return space.spaceUri ?? `https://mail.google.com/mail/u/0/#chat/space/${space.name.replace(/^spaces\//, '')}`
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
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

/** Namen van afzenders die de API niet meegaf, opgezocht via de ledenlijst van de space. */
async function fillNames(api: GoogleApi, cands: ReplyCandidate[], onError?: (e: unknown) => void) {
  const missing = [...new Set(cands.filter((c) => !c.senderName).map((c) => c.space.name))]
  const names = new Map<string, string>()
  await pool(missing, CONCURRENCY, async (space) => {
    try {
      const members: ChatUser[] = await api.listMembers(space)
      for (const m of members) if (m.name && m.displayName) names.set(`${space}|${m.name}`, m.displayName)
    } catch (e) {
      onError?.(e)
    }
  })
  for (const c of cands) if (!c.senderName) c.senderName = names.get(`${c.space.name}|users/${c.senderId}`) ?? null
}

export async function runChatScan(deps: ScanDeps, uid: string): Promise<ScanResult> {
  const { repo, service } = deps
  const stamp = service.stamp()
  try {
    const conn = await deps.google.connection(uid)
    if (!hasChat(conn)) throw new HttpError(409, 'google_scope_missing', 'Google Chat is niet gekoppeld (toestemming ontbreekt). Koppel opnieuw in Instellingen.')
    const api = await deps.google.api(uid)
    const cutoff = new Date(new Date(stamp).getTime() - CHAT_DAYS * 86_400_000).toISOString()

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
        deps.onError?.(e)
        return { space, messages: [] }
      }
    })
    if (spaces.length > 0 && failed === spaces.length) throw new HttpError(502, 'google_unavailable', 'Geen enkele chat was te lezen. Is de Google Chat API aangezet?')

    const cands = findReplyCandidates(data, conn.googleId)
    await fillNames(api, cands, deps.onError)

    const suggestions = await repo.listSuggestions(uid)
    let created = 0
    let found = 0
    for (const c of cands) {
      // één open voorstel per gesprek is genoeg: een nieuw bericht in dezelfde DM maakt geen tweede
      if (c.kind === 'dm' && suggestions.some((s) => s.status === 'open' && s.source.type === 'chat' && s.source.externalId?.startsWith(`${c.space.name}/`))) continue
      found++
      const sender = c.senderName ?? 'een collega'
      const label = c.kind === 'dm' ? sender : (c.space.displayName ?? sender)
      const gist = shortGist(c.message.text)
      const r = await service.suggest(uid, {
        title: `Reageren op ${sender}${gist ? `: ${gist}` : ''}`,
        reason: c.kind === 'dm' ? `${sender} stuurde je een bericht waar je nog niet op hebt gereageerd.` : `${sender} noemde je in ${c.space.displayName ?? 'een gesprek'}; je hebt nog niet gereageerd.`,
        bucket: 'now',
        source: { type: 'chat', label, url: spaceUrl(c.space), externalId: c.message.name },
      })
      if (r.created) created++
    }
    await repo.saveState(uid, { lastChatScan: { at: stamp, found, created } })
    return { found, created, duplicates: found - created }
  } catch (e) {
    await repo.saveState(uid, { lastChatScan: { at: stamp, found: 0, created: 0, error: e instanceof HttpError ? e.message : 'De scan is mislukt.' } }).catch(() => undefined)
    throw e
  }
}
