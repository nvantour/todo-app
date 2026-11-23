// Mail lezen voor de antwoorden-scan. Twee soorten vondsten:
// 1. mails van een mens, aan jou gericht, waar jij nog niet op hebt geantwoord;
// 2. meldingsmails van Teams en Slack ("X sent a message"): die wijzen op een bericht dat je daar hebt gemist.
// Alles hier is vaste herkenning (geen AI) en raakt het netwerk niet; replyScan.ts haalt de mails op.
import type { IncomingReply } from '../../src/data/replies'
import type { ReplyMessage } from '../../src/model/types'
import type { GmailMessage, GmailPart, GmailThread } from './googleApi'

/** Hoeveel dagen terug we mail meenemen. */
export const MAIL_DAYS = 7
/** Meldingsmails van Teams en Slack verouderen sneller: zelfde venster als de chatscan. */
export const NOTICE_DAYS = 3
export const MAIL_QUERY = `in:inbox newer_than:${MAIL_DAYS}d`
export const MAX_MAIL_THREADS = 200
export const APP_URL = 'https://work-apps-48770.web.app'
const MAX_TEXT = 1500

// --- kleine hulpjes ---

export const mailHeader = (m: GmailMessage, name: string): string =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

/** "Naam <adres>" → naam en adres. */
export function person(v: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(v)
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() }
  return { name: v.trim(), email: v.trim().toLowerCase() }
}

const ADDRESS = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** Zelfde postvak, ook als de schrijfwijze verschilt (punten en +label tellen bij Google niet mee). */
export function normAddress(a: string): string {
  const [local, domain = ''] = a.trim().toLowerCase().split('@')
  return `${local.replace(/\+.*$/, '').replace(/\./g, '')}@${domain}`
}

const at = (m: GmailMessage) => Number(m.internalDate ?? 0) || 0
const iso = (m: GmailMessage) => new Date(at(m)).toISOString()
const inInbox = (m: GmailMessage) => m.labelIds?.includes('INBOX') ?? false

/** Berichten die meetellen (geen concepten, prullenbak of spam), oudste eerst. */
export function liveMessages(thread: GmailThread): GmailMessage[] {
  return (thread.messages ?? [])
    .filter((m) => !m.labelIds?.some((l) => l === 'DRAFT' || l === 'TRASH' || l === 'SPAM'))
    .sort((a, b) => at(a) - at(b))
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&apos;/gi, "'")
}

// --- tekst uit een bericht ---

const partHeader = (p: GmailPart, name: string) => p.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
const isAttachment = (p: GmailPart) => !!p.filename || /^attachment/i.test(partHeader(p, 'Content-Disposition'))

function findPart(p: GmailPart | undefined, mime: string): GmailPart | null {
  if (!p) return null
  if (p.mimeType === mime && p.body?.data && !isAttachment(p)) return p
  for (const c of p.parts ?? []) {
    const f = findPart(c, mime)
    if (f) return f
  }
  return null
}

function decodePart(p: GmailPart): string {
  const bytes = Buffer.from(p.body?.data ?? '', 'base64url')
  // Gmail levert de tekst vaak al als UTF-8 aan, ook als de kopregel nog het oude tekenset noemt
  // (anders wordt "Maïté" "MaÃ¯tÃ©"). Dus eerst UTF-8 proberen; alleen als dat niet klopt het genoemde tekenset.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // geen geldige UTF-8
  }
  const charset = /charset="?([^";\s]+)/i.exec(partHeader(p, 'Content-Type'))?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return bytes.toString('latin1')
  }
}

/** Onzichtbare opvultekens weg (Teams en nieuwsbrieven vullen hun voorvertoning ermee) en spaties netjes. */
export const tidy = (s: string) =>
  s
    .replace(/[\u200b-\u200f\u034f\u00ad\u2060\ufeff]/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim()

/** Waar in de HTML de aangehaalde eerdere mail begint (Gmail, Outlook, Apple Mail). */
const HTML_QUOTE = /<div[^>]+class="[^"]*gmail_quote|<blockquote|<div[^>]+id="(?:divRplyFwdMsg|appendonsend|mail-editor-reference-message-container)"|<div[^>]+style="[^"]*border-top:\s*solid\s*#[A-Fa-f0-9]{6}/i

export function htmlToText(html: string): string {
  const cut = HTML_QUOTE.exec(html)
  const own = cut ? html.slice(0, cut.index) : html
  return decodeEntities(
    own
      .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const bodyHtml = (payload: GmailPart | undefined): string => {
  const html = findPart(payload, 'text/html')
  return html ? decodePart(html) : ''
}

/** Leesbare tekst van een bericht: de platte versie als die er is, anders de HTML omgezet. */
export function bodyText(payload: GmailPart | undefined): string {
  const plain = findPart(payload, 'text/plain')
  if (plain) return decodePart(plain).replace(/\r\n/g, '\n').trim()
  const html = bodyHtml(payload)
  return html ? htmlToText(html) : ''
}

const QUOTE_START = [
  /^On .{5,200}(?:\n.{0,120})?wrote:\s*$/m,
  /^Op .{5,200}(?:\n.{0,120})?schreef .*:\s*$/m,
  /^Le .{5,200}(?:\n.{0,120})?a écrit\s*:\s*$/m,
  /^Am .{5,200}(?:\n.{0,120})?schrieb .*:\s*$/m,
  /^-{2,}\s*(?:Original Message|Oorspronkelijk bericht|Forwarded message|Doorgestuurd bericht)\s*-{2,}/im,
  /^(?:From|Van|De|Von): .+\n(?:Sent|Verzonden|Envoyé|Gesendet|Date|Datum): /m,
  /^_{10,}\s*$/m,
  /^>/m,
]

/** Alleen wat de afzender zelf schreef: de aangehaalde eerdere mails eraf. */
export function stripQuoted(text: string): string {
  let end = text.length
  for (const re of QUOTE_START) {
    const m = re.exec(text)
    if (m && m.index < end) end = m.index
  }
  return text.slice(0, end).trim()
}

const clip = (s: string, max = MAX_TEXT) => (s.length <= max ? s : `${s.slice(0, max).trimEnd()}…`)

const cleanSubject = (s: string) => s.replace(/^(?:\s*(?:re|fw|fwd|antw|aw|tr|doorst)\s*:\s*)+/i, '').trim()

function hasCalendarPart(p: GmailPart | undefined): boolean {
  if (!p) return false
  if (p.mimeType === 'text/calendar' || /\.ics$/i.test(p.filename ?? '')) return true
  return (p.parts ?? []).some(hasCalendarPart)
}

// --- wat voor mail is dit? ---

export type MailKind = 'mine' | 'teams' | 'slack' | 'auto' | 'person'

/** Afzenders die geen mens zijn (het deel voor de @). */
const AUTO_LOCAL =
  /^(?:.*no[-_.]?reply.*|.*do[-_.]?not[-_.]?reply.*|notifications?|notify|mailer-daemon|postmaster|bounces?|invoices?|receipts?|billing|newsletter|news|digest|updates?|alerts?|app|system|admin|security|welcome|mailer|marketing|calendar-notification)$/

/** Verzenddomeinen voor meldingen, zoals notification.transavia.com. */
const AUTO_DOMAIN = /(?:^|\.)(?:notifications?|no-?reply|bounces?|mailer)\./

const AUTO_CATEGORIES = ['CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS']

const AUTO_SUBJECT =
  /^(?:automatic reply|automatisch antwoord|réponse automatique|abwesenheit|out of office|afwezig|auto-?reply|delivery status notification|undeliverable|niet bezorgd|invitation:|updated invitation|uitnodiging:|bijgewerkte uitnodiging|accepted:|geaccepteerd:|declined:|afgewezen:|tentatively accepted:|voorlopig geaccepteerd:|cancell?ed|geannuleerd)/i

/** "X shared … with you" / "X heeft … met je gedeeld": een melding, geen vraag. */
const SHARE_SUBJECT = /\bshared\b.*\bwith you\b|\bmet je gedeeld\b/i

export function classify(m: GmailMessage, me: string): MailKind {
  const from = person(mailHeader(m, 'From'))
  if (m.labelIds?.includes('SENT') || normAddress(from.email) === normAddress(me)) return 'mine'
  const [rawLocal = '', domain = ''] = from.email.split('@')
  const local = rawLocal.replace(/\+.*$/, '') // invoice+statements+acct_1@stripe.com → invoice
  if (domain === 'teams.mail.microsoft' || domain === 'email.teams.microsoft.com') return 'teams'
  if (domain === 'slack.com' && local.startsWith('notification')) return 'slack'
  if (AUTO_LOCAL.test(local) || AUTO_DOMAIN.test(domain)) return 'auto'
  // Gmail deelt bevestigingen, bonnetjes en meldingen zelf in bij Updates (en reclame bij Promoties).
  if (m.labelIds?.some((l) => AUTO_CATEGORIES.includes(l))) return 'auto'
  if (mailHeader(m, 'List-Unsubscribe') || mailHeader(m, 'List-Id')) return 'auto'
  const auto = mailHeader(m, 'Auto-Submitted').trim().toLowerCase()
  if (auto && auto !== 'no') return 'auto'
  if (/^(?:bulk|list|junk|auto_reply)$/i.test(mailHeader(m, 'Precedence').trim())) return 'auto'
  if (mailHeader(m, 'X-Autoreply') || mailHeader(m, 'X-Autorespond')) return 'auto'
  const subject = mailHeader(m, 'Subject').trim()
  if (AUTO_SUBJECT.test(subject) || SHARE_SUBJECT.test(subject)) return 'auto'
  return 'person'
}

/** Staat jouw adres bij Aan (dus niet alleen in cc)? */
export const toMe = (m: GmailMessage, me: string): boolean =>
  (mailHeader(m, 'To').match(ADDRESS) ?? []).some((a) => normAddress(a) === normAddress(me))

/**
 * Het laatste bericht van een mens, aan jou gericht, waar jij daarna niet meer op hebt gereageerd.
 * Alleen berichten vanaf `sinceMs` tellen: een oude vraag in een thread die al weken zonder jou doorloopt
 * (jij in cc) is geen openstaand antwoord meer.
 */
export function pendingMessage(msgs: GmailMessage[], me: string, sinceMs = 0): GmailMessage | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (at(msgs[i]) < sinceMs) return null
    const kind = classify(msgs[i], me)
    if (kind === 'mine') return null
    if (kind === 'person' && toMe(msgs[i], me)) return msgs[i]
  }
  return null
}

/**
 * Eerste blik op een thread, alleen op kopregels:
 * - 'notify': er zit een recente meldingsmail van Teams of Slack in je inbox;
 * - 'person': iemand wacht op jouw antwoord;
 * - null: niets te doen (nieuwsbrief, melding, alleen in cc, of jij reageerde als laatste).
 */
export function triageThread(thread: GmailThread, me: string, noticeCutoff: number, mailCutoff = 0): 'person' | 'notify' | null {
  const msgs = liveMessages(thread)
  if (!msgs.length) return null
  const notice = msgs.some((m) => {
    if (!inInbox(m) || at(m) < noticeCutoff) return false
    const kind = classify(m, me)
    return kind === 'teams' || kind === 'slack'
  })
  if (notice) return 'notify'
  return pendingMessage(msgs, me, mailCutoff) ? 'person' : null
}

/** Jij reageerde als laatste in deze thread, en dat was ná `sinceMs`. */
export function mailAnswered(thread: GmailThread, me: string, sinceMs: number): boolean {
  const last = liveMessages(thread).at(-1)
  return !!last && classify(last, me) === 'mine' && at(last) > sinceMs
}

// --- kaarten ---

/** Kaart voor een mail die op jouw antwoord wacht. Verwacht de thread mét tekst (format=full). */
export function mailCard(thread: GmailThread, me: string, mailCutoff = 0): IncomingReply | null {
  const msgs = liveMessages(thread)
  const pending = pendingMessage(msgs, me, mailCutoff)
  if (!pending || hasCalendarPart(pending.payload)) return null
  const who = person(mailHeader(pending, 'From')).name
  const subject = cleanSubject(mailHeader(pending, 'Subject') || mailHeader(msgs[0], 'Subject'))
  return {
    channel: 'mail',
    externalId: `gmail:${thread.id}`,
    title: subject || '(geen onderwerp)',
    who,
    url: `${APP_URL}/mail#mail-${thread.id}`,
    target: { threadId: thread.id },
    messages: msgs.slice(-3).map((m): ReplyMessage => {
      const mine = classify(m, me) === 'mine'
      const text = stripQuoted(bodyText(m.payload)) || tidy(decodeEntities(m.snippet ?? ''))
      return { author: person(mailHeader(m, 'From')).name, text: clip(text), at: iso(m), ...(mine ? { mine: true } : {}) }
    }),
    draft: '',
    reason: `${who} mailde je; je hebt nog niet geantwoord.`,
  }
}

const TEAMS_CHAT = /https:\/\/teams\.(?:microsoft\.com|cloud\.microsoft|live\.com)\/l\/chat\/([^/"'\s<>?]+)\/[^"'\s<>?]*\?[^"'\s<>]*?tenantId=([0-9a-fA-F-]{36})/
const TEAMS_MESSAGE = /https:\/\/teams\.(?:microsoft\.com|cloud\.microsoft)\/l\/message\/([^/"'\s<>?]+)\/(\d+)[^"'\s<>)\]]*/

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * Meldingsmail van Teams ("X sent a message"). De link in de mail wijst precies het gesprek aan;
 * daarmee kan het verzendscript later in hetzelfde gesprek antwoorden.
 */
export function teamsNotice(m: GmailMessage): IncomingReply | null {
  const raw = `${bodyHtml(m.payload)}\n${bodyText(m.payload)}`.replace(/&amp;/g, '&')
  const subject = mailHeader(m, 'Subject').trim()
  const from = person(mailHeader(m, 'From'))
  const named = from.name.includes('@') ? '' : from.name.replace(/\s+(?:in|via) (?:Microsoft )?Teams$/i, '').trim()
  const who = named || /^(.+?) (?:sent|mentioned|replied|has sent)\b/i.exec(subject)?.[1]?.trim() || 'Iemand'
  const message: ReplyMessage = { author: who, text: clip(tidy(decodeEntities(m.snippet ?? '')) || subject), at: iso(m) }

  const chat = TEAMS_CHAT.exec(raw)
  if (chat) {
    const url = `https://teams.microsoft.com/l/chat/${safeDecode(chat[1])}/0?tenantId=${chat[2].toLowerCase()}`
    return {
      channel: 'teams',
      externalId: `teams:${safeDecode(chat[1])}`,
      title: `Chat met ${who}`,
      who,
      url,
      target: { url },
      messages: [message],
      draft: '',
      reason: `${who} stuurde je een bericht in Teams terwijl je weg was.`,
    }
  }
  // Bericht in een kanaal: wel laten zien, maar zonder verzendadres (antwoorden doe je in Teams zelf).
  const post = TEAMS_MESSAGE.exec(raw)
  if (!post) return null
  return {
    channel: 'teams',
    externalId: `teams:msg:${safeDecode(post[1])}`,
    title: subject || `Teams: ${who}`,
    who,
    url: post[0],
    target: {},
    messages: [message],
    draft: '',
    reason: `${who} noemde je in een Teams-kanaal terwijl je weg was.`,
  }
}

const SLACK_ARCHIVE = /https:\/\/([a-z0-9-]+)\.slack\.com\/(?:x-[^/\s]+\/)?archives\/([A-Z0-9]+)\/p(\d{16})/
/** "Naam (9:03 AM, January 12th)": zo begint elk bericht in een meldingsmail van Slack. */
const SLACK_HEAD = /^(.{1,80}?) \((\d{1,2}:\d{2}\s?[AP]M), ([^)]{3,40})\)\s*$/

/**
 * Meldingsmail van Slack (vermelding of direct bericht). Een DM is één gesprek per persoon; bij een kanaal
 * weten we niet zeker in welke thread het antwoord hoort, dus daar geven we geen verzendadres mee.
 */
export function slackNotice(m: GmailMessage): IncomingReply | null {
  const text = bodyText(m.payload)
  const link = SLACK_ARCHIVE.exec(text) ?? SLACK_ARCHIVE.exec(bodyHtml(m.payload))
  if (!link) return null
  const [, workspace, channel, digits] = link
  const ts = `${digits.slice(0, 10)}.${digits.slice(10)}`
  const subject = mailHeader(m, 'Subject').trim()
  const myName = /^Hi (.+?),\s*$/m.exec(text)?.[1]?.trim() ?? ''

  const lines = text.split('\n')
  const linkLine = lines.findIndex((l) => l.includes('/archives/'))
  const place = (lines.slice(0, Math.max(0, linkLine)).reverse().find((l) => l.trim() && !/^-+$/.test(l.trim())) ?? '').trim()
  const end = lines.findIndex((l, i) => i > linkLine && /^\* \* \*\s*$/.test(l))
  const messages: ReplyMessage[] = []
  let cur: { author: string; lines: string[] } | null = null
  const flush = () => {
    if (!cur) return
    const body = cur.lines.join('\n').trim()
    if (body) messages.push({ author: cur.author, text: clip(body), at: null, ...(cur.author === myName ? { mine: true } : {}) })
  }
  for (const line of lines.slice(linkLine + 1, end === -1 ? undefined : end)) {
    const head = SLACK_HEAD.exec(line)
    if (head) {
      flush()
      cur = { author: head[1].trim(), lines: [] }
    } else if (cur) cur.lines.push(line)
  }
  flush()

  const fromSubject = /^(.+?) (?:mentioned you|sent you a message)\b/i.exec(subject)?.[1]?.trim()
  const lastOther = [...messages].reverse().find((x) => !x.mine)
  if (lastOther) lastOther.at = iso(m)
  else messages.push({ author: fromSubject || 'Iemand', text: clip(tidy(decodeEntities(m.snippet ?? '')) || subject), at: iso(m) })
  const who = lastOther?.author ?? fromSubject ?? 'Iemand'

  const dm = channel.startsWith('D')
  const title = dm ? `DM ${who}` : `#${place.replace(/^thread in /i, '').replace(/^[#@]/, '') || 'Slack'}`
  return {
    channel: 'slack',
    externalId: dm ? `slack:${channel}` : `slack:${channel}:${ts}`,
    title,
    who,
    url: `https://${workspace}.slack.com/archives/${channel}/p${digits}`,
    target: { channel, ts },
    messages,
    draft: '',
    reason: dm ? `${who} stuurde je een bericht in Slack terwijl je weg was.` : `${who} noemde je in ${title} (Slack) terwijl je weg was.`,
  }
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().slice(0, 80) === b.replace(/\s+/g, ' ').trim().slice(0, 80)

/** De recente meldingsmails in een thread als kaarten, oudste eerst. */
export function noticeCards(thread: GmailThread, me: string, noticeCutoff: number): IncomingReply[] {
  const out: IncomingReply[] = []
  for (const m of liveMessages(thread)) {
    if (!inInbox(m) || at(m) < noticeCutoff) continue
    const kind = classify(m, me)
    const card = kind === 'teams' ? teamsNotice(m) : kind === 'slack' ? slackNotice(m) : null
    if (card) out.push(card)
  }
  return out
}

/** Meer meldingen over hetzelfde gesprek worden één kaart: berichten achter elkaar, zonder dubbele. */
export function mergeNotices(cards: IncomingReply[]): IncomingReply[] {
  const byKey = new Map<string, IncomingReply>()
  for (const c of cards) {
    const key = `${c.channel}|${c.externalId}`
    const old = byKey.get(key)
    if (!old) {
      byKey.set(key, c)
      continue
    }
    const extra = c.messages.filter((x) => !old.messages.some((o) => o.author === x.author && sameText(o.text, x.text)))
    byKey.set(key, { ...c, title: old.title, messages: [...old.messages, ...extra] })
  }
  return [...byKey.values()]
}
