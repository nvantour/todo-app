import type { AppData, ReactionRequest, Reply, ReplyChannel, ReplyMessage, ReplyReaction, ReplyStatus, ReplyTarget } from '../model/types'

/** Wat Claude (met concept) of de scan op de server (zonder concept: `draft` leeg) aanlevert voor één gesprek. */
export interface IncomingReply {
  channel: ReplyChannel
  externalId: string
  title: string
  who: string
  projectId?: string | null
  url?: string | null
  target: ReplyTarget
  messages: ReplyMessage[]
  draft: string
  reason?: string
}

export const CHANNEL_NAME: Record<ReplyChannel, string> = { mail: 'Mail', gchat: 'Google Chat', slack: 'Slack', teams: 'Teams', airtable: 'Airtable' }

/** Volgorde van de kanalen op de tab. */
export const CHANNELS: ReplyChannel[] = ['mail', 'gchat', 'teams', 'slack', 'airtable']

/** Kanalen die de app (of de server) zelf verstuurt; de rest gaat via het verzendscript op de Mac mini. */
export const SENT_BY_APP: ReplyChannel[] = ['mail', 'gchat', 'airtable']

const STATUSES: ReplyStatus[] = ['open', 'approved', 'sending', 'sent', 'failed', 'dismissed']

type Raw = Record<string, unknown>

export function normalizeReply(id: string, raw: Raw): Reply {
  const r = raw as Partial<Reply>
  return {
    channel: 'mail',
    title: '',
    who: '',
    projectId: null,
    url: null,
    externalId: id,
    messages: [],
    draft: '',
    draftEdited: false,
    reason: '',
    error: null,
    approvedAt: null,
    sentAt: null,
    createdAt: '',
    updatedAt: '',
    ...r,
    reactionQueue: Array.isArray(r.reactionQueue) ? r.reactionQueue : [],
    target: (r.target as ReplyTarget) ?? {},
    status: STATUSES.includes(r.status as ReplyStatus) ? (r.status as ReplyStatus) : 'open',
    id,
  }
}

/** Kaarten op de tab: alles wat nog niet klaar is, en wat de laatste dag verstuurd is. Nieuwste bovenaan. */
export function visibleReplies(data: AppData, now = Date.now()): Reply[] {
  const day = 24 * 3600_000
  return data.replies
    .filter((r) => r.status !== 'dismissed' && (r.status !== 'sent' || (r.sentAt && now - Date.parse(r.sentAt) < day)))
    .sort((a, b) => rank(a) - rank(b) || lastAt(b).localeCompare(lastAt(a)))
}

const rank = (r: Reply) => (r.status === 'failed' ? 0 : r.status === 'open' ? 1 : r.status === 'sent' ? 3 : 2)
const lastAt = (r: Reply) => r.messages.at(-1)?.at ?? r.createdAt

/** Teller in het menu: wat op Nino wacht (open of mislukt). */
export const waitingReplies = (data: AppData) => data.replies.filter((r) => r.status === 'open' || r.status === 'failed').length

/**
 * Een nieuwe ronde van Claude samenvoegen met wat er al staat (zelfde kanaal + externalId = zelfde gesprek).
 * - Nieuw gesprek → nieuwe kaart.
 * - Open kaart → berichten bijwerken; het antwoord alleen als Nino het niet zelf heeft aangepast
 *   en er een nieuw voorstel is (de scan levert er geen, dan blijft het voorstel van Claude staan).
 * - Verstuurd of genegeerd, maar er is sindsdien een nieuw bericht van een ander → weer open met het nieuwe voorstel.
 * - Goedgekeurd of bezig met versturen → niet aanraken.
 */
export function mergeReply(existing: Reply | undefined, input: IncomingReply, stamp: string, newId: () => string): { reply: Reply; change: 'created' | 'updated' | 'reopened' | 'skipped' } {
  const base = {
    channel: input.channel,
    externalId: input.externalId,
    title: input.title,
    who: input.who,
    url: input.url ?? null,
    target: input.target,
    messages: mergeMessages(existing?.messages ?? [], input.messages),
    reason: input.reason ?? '',
  }
  if (!existing) {
    return {
      change: 'created',
      reply: { ...base, id: newId(), projectId: input.projectId ?? null, draft: input.draft, draftEdited: false, status: 'open', error: null, approvedAt: null, sentAt: null, createdAt: stamp, updatedAt: stamp },
    }
  }
  if (existing.status === 'approved' || existing.status === 'sending') return { reply: existing, change: 'skipped' }
  if (existing.status === 'sent' || existing.status === 'dismissed') {
    // Verstuurd: vanaf het versturen. Genegeerd: vanaf het negeren (niet een eerdere verzending, anders
    // telt een bericht van vóór het negeren elke ronde opnieuw als nieuw).
    const since = existing.status === 'sent' ? (existing.sentAt ?? existing.updatedAt) : existing.updatedAt
    const fresh = input.messages.some((m) => !m.mine && m.at && m.at > since)
    if (!fresh) return { reply: existing, change: 'skipped' }
    return { change: 'reopened', reply: { ...existing, ...base, projectId: input.projectId ?? existing.projectId, draft: input.draft, draftEdited: false, status: 'open', error: null, approvedAt: null, updatedAt: stamp } }
  }
  // open of failed
  const draft = existing.draftEdited || !input.draft ? existing.draft : input.draft
  return { change: 'updated', reply: { ...existing, ...base, projectId: input.projectId ?? existing.projectId, draft, updatedAt: stamp } }
}

// --- Emoji op berichten ---

/** Kanalen waar je vanuit de app een emoji op een bericht kunt zetten. */
export const REACT_CHANNELS: ReplyChannel[] = ['gchat', 'slack', 'teams']

/** De emoji in de kiezer. Alle acht bestaan in Google Chat, Slack en Teams. */
export const REACTION_CHOICES = ['👍', '❤️', '😂', '🙏', '✅', '👀', '🎉', '🙌'] as const

/** Hoeveel emoji-verzoeken een kaart onthoudt. */
const QUEUE_MAX = 30

/** Hetzelfde bericht? Op id als beide er een hebben, anders op afzender, tijd en tekst. */
export function sameMessage(a: Pick<ReplyMessage, 'id' | 'author' | 'at' | 'text'>, b: Pick<ReplyMessage, 'id' | 'author' | 'at' | 'text'>): boolean {
  if (a.id && b.id) return a.id === b.id
  return a.author === b.author && (a.at ?? '') === (b.at ?? '') && a.text.trim() === b.text.trim()
}

const requestMatches = (q: ReactionRequest, m: ReplyMessage) =>
  q.messageId && m.id ? q.messageId === m.id : sameMessage({ id: undefined, author: q.messageAuthor, at: q.messageAt, text: q.messageText }, { ...m, id: undefined, text: m.text.slice(0, q.messageText.length) })

/**
 * Berichten van een nieuwe ronde samenvoegen met wat er al stond. De ronde is leidend, maar:
 * - een id dat de ronde niet meegeeft blijft staan (de scan van meldingsmails kent geen id's);
 * - reacties die de ronde niet meegeeft (`reactions` ontbreekt) blijven staan;
 * - "jij zat erbij" blijft staan als de bron dat niet zelf zegt (Google Chat vertelt het niet).
 */
export function mergeMessages(old: ReplyMessage[], incoming: ReplyMessage[]): ReplyMessage[] {
  if (!old.length) return incoming
  return incoming.map((m) => {
    const prev = old.find((o) => sameMessage(o, m))
    if (!prev) return m
    const id = m.id ?? prev.id
    let reactions = m.reactions ?? prev.reactions
    if (m.reactions && prev.reactions) {
      const mineBefore = new Set(prev.reactions.filter((r) => r.mine).map((r) => r.emoji))
      reactions = m.reactions.map((r) => (r.mine === undefined && mineBefore.has(r.emoji) ? { ...r, mine: true } : r))
    }
    return { ...m, ...(id ? { id } : {}), ...(reactions ? { reactions } : {}) }
  })
}

/** Kan Nino op dit bericht een emoji zetten? Google Chat heeft het bericht-id nodig; Teams en Slack de link naar het gesprek. */
export function canReact(reply: Pick<Reply, 'channel' | 'target'>, m: ReplyMessage): boolean {
  if (reply.channel === 'gchat') return Boolean(m.id?.startsWith('spaces/'))
  if (reply.channel === 'slack' || reply.channel === 'teams') return Boolean(reply.target.url) && Boolean(m.id || m.text.trim())
  return false
}

/** Een emoji van Nino toevoegen aan de reacties van een bericht (na het versturen). */
export function addMine(reactions: ReplyReaction[] | undefined, emoji: string): ReplyReaction[] {
  const list = reactions ?? []
  const hit = list.find((r) => r.emoji === emoji)
  if (hit?.mine) return list
  if (hit) return list.map((r) => (r === hit ? { ...r, count: r.count + 1, mine: true } : r))
  return [...list, { emoji, count: 1, mine: true }]
}

/** Berichten met de verstuurde emoji erbij. */
export const withReaction = (messages: ReplyMessage[], req: ReactionRequest): ReplyMessage[] =>
  messages.map((m) => (requestMatches(req, m) ? { ...m, reactions: addMine(m.reactions, req.emoji) } : m))

/** Wat er onder een bericht staat: de reacties uit de bron, plus emoji van Nino die nog onderweg of mislukt zijn. */
export type ShownReaction = ReplyReaction & { state?: 'pending' | 'failed'; error?: string | null }

export function shownReactions(reply: Pick<Reply, 'reactionQueue'>, m: ReplyMessage): ShownReaction[] {
  const out: ShownReaction[] = [...(m.reactions ?? [])].filter((r) => r.count > 0)
  for (const q of reply.reactionQueue ?? []) {
    if (q.status === 'sent' || !requestMatches(q, m)) continue
    const state = q.status === 'failed' ? 'failed' : 'pending'
    const i = out.findIndex((r) => r.emoji === q.emoji)
    if (i >= 0 && out[i].mine && !out[i].state) continue // staat er al als die van jou
    if (i >= 0) out[i] = { ...out[i], count: out[i].count + 1, mine: true, state, error: q.error }
    else out.push({ emoji: q.emoji, count: 1, mine: true, state, error: q.error })
  }
  return out
}

/** Nieuw emoji-verzoek voor een bericht. Google Chat gaat meteen ("sending"), Teams en Slack wachten op de Mac mini. */
export function buildReaction(reply: Pick<Reply, 'channel'>, m: ReplyMessage, emoji: string, id: string, stamp: string): ReactionRequest {
  return {
    id,
    emoji,
    messageId: m.id ?? null,
    messageText: m.text.slice(0, 300),
    messageAuthor: m.author,
    messageAt: m.at,
    status: reply.channel === 'gchat' ? 'sending' : 'queued',
    error: null,
    createdAt: stamp,
    doneAt: null,
  }
}

/** Het verzoek achteraan de wachtrij; de oudste afgeronde vallen eraf. */
export function enqueue(queue: ReactionRequest[] | undefined, req: ReactionRequest): ReactionRequest[] {
  const next = [...(queue ?? []), req]
  while (next.length > QUEUE_MAX) {
    const done = next.findIndex((q) => q.status === 'sent' || q.status === 'failed')
    next.splice(done >= 0 ? done : 0, 1)
  }
  return next
}

/** Toegestane stappen voor een emoji-verzoek (het verzendscript en de app). */
export const REACTION_STEPS: Record<'sending' | 'sent' | 'failed', ReactionRequest['status'][]> = {
  sending: ['queued'],
  sent: ['sending'],
  failed: ['queued', 'sending'],
}

/**
 * Een emoji-verzoek naar de volgende stap. Bij "sent" komt de emoji ook bij de reacties van het bericht.
 * Mislukt terwijl de kaart al was afgehandeld ("Klaar zo?" → ja)? Dan gaat de kaart weer open, zodat Nino het ziet.
 * Geeft null als de stap niet mag.
 */
export function stepReaction(reply: Reply, reactionId: string, status: 'sending' | 'sent' | 'failed', stamp: string, error?: string): Reply | null {
  const req = reply.reactionQueue?.find((q) => q.id === reactionId)
  if (!req || !REACTION_STEPS[status].includes(req.status)) return null
  const done: ReactionRequest = {
    ...req,
    status,
    error: status === 'failed' ? (error ?? 'Emoji zetten mislukt.') : null,
    doneAt: status === 'sending' ? null : stamp,
  }
  const reactionQueue = (reply.reactionQueue ?? []).map((q) => (q.id === reactionId ? done : q))
  const next: Reply = { ...reply, reactionQueue }
  if (status === 'sent') next.messages = withReaction(reply.messages, done)
  if (status === 'failed' && reply.status === 'dismissed') next.status = 'open'
  return next
}
