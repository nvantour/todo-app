import type { AppData, Reply, ReplyChannel, ReplyMessage, ReplyStatus, ReplyTarget } from '../model/types'

/** Wat Claude (of een koppeling) aanlevert voor één gesprek. */
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
 * - Open kaart → berichten bijwerken; het antwoord alleen als Nino het niet zelf heeft aangepast.
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
    messages: input.messages,
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
    const since = existing.sentAt ?? existing.updatedAt
    const fresh = input.messages.some((m) => !m.mine && m.at && m.at > since)
    if (!fresh) return { reply: existing, change: 'skipped' }
    return { change: 'reopened', reply: { ...existing, ...base, projectId: input.projectId ?? existing.projectId, draft: input.draft, draftEdited: false, status: 'open', error: null, approvedAt: null, updatedAt: stamp } }
  }
  // open of failed
  const draft = existing.draftEdited ? existing.draft : input.draft
  return { change: 'updated', reply: { ...existing, ...base, projectId: input.projectId ?? existing.projectId, draft, updatedAt: stamp } }
}
