// De antwoorden-scan: wie wacht er op een antwoord van jou?
// Leest Google Chat en je mail (waar ook de meldingsmails van Teams en Slack in staan) en zet per gesprek
// een kaart op de tab Antwoorden, zonder conceptantwoord. Verstuurt nooit iets.
// Een kaart verdwijnt vanzelf zodra jij in dat gesprek hebt gereageerd.
import type { IncomingReply } from '../../src/data/replies'
import type { Reply } from '../../src/model/types'
import type { ScanDeps, ScanResult } from './calendarScan'
import { CHAT_DAYS, chatAnswered, chatCards, lastOtherAt, pool, readChats, type SpaceMessages } from './chatScan'
import { HttpError } from './errors'
import { hasChat, hasMail } from './google'
import type { GmailThread, GoogleApi } from './googleApi'
import { MAIL_QUERY, MAX_MAIL_THREADS, NOTICE_DAYS, mailAnswered, mailCard, mergeNotices, noticeCards, triageThread } from './mailScan'
import type { Repo } from './repo'

const DAY = 86_400_000
const MAIL_CONCURRENCY = 8
/** Hooguit zoveel mails met volledige tekst ophalen per ronde. */
const MAX_FULL = 60
/** Hooguit zoveel extra threads nakijken om te zien of jij al hebt geantwoord. */
const MAX_RECHECK = 20

export interface ReplyScanResult extends ScanResult {
  /** Kaarten die zijn weggehaald omdat jij in het gesprek al had gereageerd. */
  closed: number
  /** Gevonden gesprekken per kanaal. */
  channels: Record<'gchat' | 'mail' | 'teams' | 'slack', number>
  /** Een deel van de scan lukte niet (bijvoorbeeld mail wel, chat niet). */
  warning?: string
}

interface MailRead {
  cards: IncomingReply[]
  /** Alle gelezen threads (alleen kopregels), voor de controle "heb jij al geantwoord?". */
  threads: Map<string, GmailThread>
}

const message = (e: unknown) => (e instanceof HttpError ? e.message : 'lezen mislukte.')

async function readMail(api: GoogleApi, me: string, now: number, onError?: (e: unknown) => void): Promise<MailRead> {
  const ids = await api.listMailThreads(MAIL_QUERY, MAX_MAIL_THREADS)
  let failed = 0
  const meta = await pool(ids, MAIL_CONCURRENCY, async (id) => {
    try {
      return await api.getMailThread(id, 'metadata')
    } catch (e) {
      failed++
      onError?.(e)
      return null
    }
  })
  if (ids.length > 0 && failed === ids.length) throw new HttpError(502, 'google_unavailable', 'Geen enkele mail was te lezen. Is de Gmail API aangezet?')

  const noticeCutoff = now - NOTICE_DAYS * DAY
  const threads = new Map<string, GmailThread>()
  const wanted: { id: string; kind: 'person' | 'notify' }[] = []
  for (const th of meta) {
    if (!th) continue
    threads.set(th.id, th)
    const kind = triageThread(th, me, noticeCutoff)
    if (kind) wanted.push({ id: th.id, kind })
  }

  const full = await pool(wanted.slice(0, MAX_FULL), MAIL_CONCURRENCY, async (w) => {
    try {
      return { kind: w.kind, thread: await api.getMailThread(w.id, 'full') }
    } catch (e) {
      onError?.(e)
      return null
    }
  })
  const cards: IncomingReply[] = []
  const notices: IncomingReply[] = []
  for (const f of full) {
    if (!f) continue
    if (f.kind === 'notify') notices.push(...noticeCards(f.thread, me, noticeCutoff))
    else {
      const card = mailCard(f.thread, me)
      if (card) cards.push(card)
    }
  }
  return { cards: [...cards, ...mergeNotices(notices)], threads }
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().slice(0, 80) === b.replace(/\s+/g, ' ').trim().slice(0, 80)

/**
 * Hoort deze vondst bij een kaart die er al staat? Claude (/chats-ophalen) en de scan geven een gesprek niet
 * altijd dezelfde naam, dus we kijken naar het gesprek zelf: de mail-thread, de chat of het kanaal.
 */
export function sameConversation(card: IncomingReply, r: Reply): boolean {
  if (r.channel !== card.channel) return false
  if (r.externalId === card.externalId) return true
  switch (card.channel) {
    case 'mail':
      return !!card.target.threadId && r.target.threadId === card.target.threadId
    case 'gchat':
      if (!card.target.space || r.target.space !== card.target.space) return false
      // Zonder thread is de hele space één gesprek (DM); met thread moet de thread kloppen.
      return card.target.thread ? r.target.thread === card.target.thread : true
    case 'teams':
      return !!card.target.url && r.target.url === card.target.url
    case 'slack':
      if (!card.target.channel || r.target.channel !== card.target.channel) return false
      if (card.target.channel.startsWith('D')) return true
      return card.messages.some((m) => !m.mine && r.messages.some((o) => sameText(o.text, m.text)))
    default:
      return false
  }
}

const RANK: Record<Reply['status'], number> = { open: 0, failed: 1, approved: 2, sending: 3, sent: 4, dismissed: 5 }

/**
 * Laat een vondst aansluiten op de kaart die er al is: zelfde naam, en wat Claude er eerder aan heeft
 * toegevoegd (verzendadres, titel, uitleg bij het concept) blijft staan.
 * Geeft null als er niets nieuws te melden is.
 */
export function alignWithExisting(card: IncomingReply, existing: Reply[]): IncomingReply | null {
  const old = existing.filter((r) => sameConversation(card, r)).sort((a, b) => RANK[a.status] - RANK[b.status] || b.updatedAt.localeCompare(a.updatedAt))[0]
  if (!old) return card
  const active = old.status === 'open' || old.status === 'failed'
  let messages = card.messages
  if (card.channel === 'teams' || card.channel === 'slack') {
    // Een meldingsmail bevat alleen het gemiste bericht. Wat er al op de kaart staat, is vaak vollediger.
    const fresh = card.messages.filter((m) => !m.mine && !old.messages.some((o) => sameText(o.text, m.text)))
    if (active && fresh.length === 0) return null
    if (active) messages = [...old.messages, ...fresh]
  }
  return {
    ...card,
    externalId: old.externalId,
    title: old.title || card.title,
    url: old.url ?? card.url,
    target: { ...card.target, ...old.target },
    messages,
    reason: active && old.draft && old.reason ? old.reason : card.reason,
  }
}

/** Kaarten weghalen waar jij in het gesprek zelf al op hebt gereageerd. Een aangepast concept blijft staan. */
async function closeAnswered(
  repo: Repo,
  uid: string,
  api: GoogleApi,
  ctx: { before: Reply[]; touched: Set<string>; chat: SpaceMessages[] | null; mail: MailRead | null; meId: string; meEmail: string; stamp: string },
  onError?: (e: unknown) => void,
): Promise<number> {
  let closed = 0
  let rechecked = 0
  for (const r of ctx.before) {
    if (r.status !== 'open' || r.draftEdited || ctx.touched.has(`${r.channel}|${r.externalId}`)) continue
    let answered = false
    if (r.channel === 'gchat' && ctx.chat) answered = chatAnswered(r, ctx.chat, ctx.meId)
    if (r.channel === 'mail' && ctx.mail) {
      const id = r.target.threadId ?? r.externalId.replace(/^gmail:/, '')
      let thread = ctx.mail.threads.get(id)
      if (!thread && rechecked < MAX_RECHECK) {
        rechecked++
        try {
          thread = await api.getMailThread(id, 'metadata')
        } catch (e) {
          onError?.(e)
        }
      }
      answered = !!thread && mailAnswered(thread, ctx.meEmail, lastOtherAt(r))
    }
    if (!answered) continue
    await repo.saveReply(uid, { ...r, status: 'dismissed', updatedAt: ctx.stamp })
    closed++
  }
  return closed
}

/**
 * Opruimen van vroeger: de chatscan zette "Reageren op …" bij de voorstellen. Die horen nu op Antwoorden;
 * de oude voorstellen van de scan zelf gaan weg (voorstellen van Claude blijven staan).
 */
async function dismissOldChatSuggestions(repo: Repo, uid: string): Promise<void> {
  for (const s of await repo.listSuggestions(uid)) {
    const fromScan = s.source.type === 'chat' && /^spaces\/[^/]+\/messages\//.test(s.source.externalId ?? '') && s.title.startsWith('Reageren op ')
    if (s.status === 'open' && fromScan) await repo.saveSuggestion(uid, { ...s, status: 'dismissed' })
  }
}

export async function runReplyScan(deps: ScanDeps, uid: string): Promise<ReplyScanResult> {
  const { repo, service } = deps
  const stamp = service.stamp()
  try {
    const conn = await deps.google.connection(uid)
    if (!hasChat(conn) && !hasMail(conn)) throw new HttpError(409, 'google_scope_missing', 'Google Chat en mail zijn niet gekoppeld (toestemming ontbreekt). Koppel opnieuw in Instellingen.')
    const api = await deps.google.api(uid)
    const now = new Date(stamp).getTime()

    const problems: string[] = []
    const cards: IncomingReply[] = []
    let chat: SpaceMessages[] | null = null
    let mail: MailRead | null = null
    if (hasChat(conn)) {
      try {
        chat = await readChats(api, new Date(now - CHAT_DAYS * DAY).toISOString(), deps.onError)
        cards.push(...(await chatCards(api, chat, conn.googleId, deps.onError)))
      } catch (e) {
        deps.onError?.(e)
        problems.push(`Google Chat: ${message(e)}`)
      }
    }
    if (hasMail(conn)) {
      try {
        mail = await readMail(api, conn.email, now, deps.onError)
        cards.push(...mail.cards)
      } catch (e) {
        deps.onError?.(e)
        problems.push(`Mail: ${message(e)}`)
      }
    }
    if (!chat && !mail) throw new HttpError(502, 'google_unavailable', problems.join(' ') || 'Er was niets te lezen.')

    const before = await repo.listReplies(uid)
    const inputs = cards.map((c) => alignWithExisting(c, before)).filter((c): c is IncomingReply => c !== null)
    const counts = inputs.length ? await service.saveReplies(uid, inputs) : { created: 0, updated: 0, reopened: 0, skipped: 0 }
    const touched = new Set(inputs.map((c) => `${c.channel}|${c.externalId}`))
    const closed = await closeAnswered(repo, uid, api, { before, touched, chat, mail, meId: conn.googleId, meEmail: conn.email, stamp }, deps.onError)
    await dismissOldChatSuggestions(repo, uid)

    const created = counts.created + counts.reopened
    const channels = { gchat: 0, mail: 0, teams: 0, slack: 0 }
    for (const c of cards) if (c.channel in channels) channels[c.channel as keyof typeof channels]++
    const warning = problems.length ? problems.join(' ') : undefined
    await repo.saveState(uid, { lastChatScan: { at: stamp, found: cards.length, created, ...(warning ? { error: warning } : {}) } })
    return { found: cards.length, created, duplicates: cards.length - created, closed, channels, ...(warning ? { warning } : {}) }
  } catch (e) {
    await repo.saveState(uid, { lastChatScan: { at: stamp, found: 0, created: 0, error: e instanceof HttpError ? e.message : 'De scan is mislukt.' } }).catch(() => undefined)
    throw e
  }
}
