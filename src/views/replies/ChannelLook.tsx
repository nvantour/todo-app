import { Fragment, type ReactNode } from 'react'
import type { Reply, ReplyChannel, ReplyMessage } from '../../model/types'
import { CHANNEL_NAME } from '../../data/replies'
import { Reactions } from './Reactions'

/**
 * De kaart op de tab Antwoorden lijkt op de tool waar het gesprek vandaan komt: een balk in de kleur van
 * de tool met waar het gesprek staat (space, kanaal, record), en de berichten in de stijl van die tool.
 * Geen echte logo's, wel herkenbare kleuren en vormen.
 */

/** Klein merkteken per tool, in de balk bovenaan de kaart. */
export function BrandMark({ channel }: { channel: ReplyChannel }) {
  switch (channel) {
    case 'gchat':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M5.5 2h9A2.5 2.5 0 0 1 17 4.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5V14A2.5 2.5 0 0 1 3 11.5v-7A2.5 2.5 0 0 1 5.5 2z" fill="#00AC47" />
          <rect x="6.5" y="6" width="7" height="1.8" rx="0.9" fill="#fff" />
          <rect x="6.5" y="9" width="4.5" height="1.8" rx="0.9" fill="#fff" />
        </svg>
      )
    case 'slack':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <rect x="3" y="7.5" width="14" height="2.6" rx="1.3" fill="#36C5F0" />
          <rect x="3" y="11.9" width="14" height="2.6" rx="1.3" fill="#2EB67D" />
          <rect x="7.5" y="3" width="2.6" height="14" rx="1.3" fill="#ECB22E" />
          <rect x="11.9" y="3" width="2.6" height="14" rx="1.3" fill="#E01E5A" />
        </svg>
      )
    case 'teams':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <rect x="2" y="4" width="11" height="12" rx="2.5" fill="#fff" />
          <path d="M5 7.4h5v1.5H8.3V13H6.7V8.9H5z" fill="#5B5FC7" />
          <circle cx="15.5" cy="6.5" r="2" fill="#fff" opacity="0.85" />
          <rect x="14" y="9.5" width="4" height="5.5" rx="1.6" fill="#fff" opacity="0.85" />
        </svg>
      )
    case 'airtable':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M10 2.5 17.5 5.5 10 8.5 2.5 5.5z" fill="#FCB400" />
          <path d="M11 10.2 17.5 7.6v7.3L11 17.5z" fill="#18BFFF" />
          <path d="M9 10.2 2.5 7.6v7.3L9 17.5z" fill="#F82B60" />
        </svg>
      )
    case 'mail':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <rect x="2" y="4" width="16" height="12" rx="2" fill="#fff" />
          <path d="M2.8 5.2 10 10.6l7.2-5.4" fill="none" stroke="#EA4335" strokeWidth="2" strokeLinejoin="round" />
          <path d="M3 6v9" stroke="#4285F4" strokeWidth="2" />
          <path d="M17 6v9" stroke="#34A853" strokeWidth="2" />
        </svg>
      )
  }
}

const AVATAR_COLORS = ['#1a73e8', '#e37400', '#188038', '#d93025', '#9334e6', '#007b83', '#c5221f', '#b06000', '#3949ab', '#00796b']

function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter((w) => w && /^\p{Lu}/u.test(w))
  if (!words.length) return (name.trim()[0] ?? '?').toUpperCase()
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase()
}

function colorFor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="cmsg__avatar" style={{ background: colorFor(name) }} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

/**
 * `@Naam` uitlichten zoals de tool een vermelding toont. Een naam loopt door zolang er hoofdletterwoorden
 * of tussenvoegsels volgen: `@Ruud van der Veer`, `@Alexandros Kakakis`; `@Nino can` stopt bij `can`.
 */
const MENTION = /@\p{Lu}[\p{L}'’-]*(?:\s+(?:(?:van|de|der|den|het|ten|ter|op|la|le|di|da|von)\s+)*\p{Lu}[\p{L}'’-]*)?/gu

function withMentions(text: string): ReactNode {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(MENTION)) {
    const i = m.index ?? 0
    if (i > last) parts.push(text.slice(last, i))
    parts.push(
      <span key={i} className="cmsg__mention">
        {m[0]}
      </span>,
    )
    last = i + m[0].length
  }
  if (!parts.length) return text
  if (last < text.length) parts.push(text.slice(last))
  return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)
}

const clock = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const hm = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? hm : `${d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}, ${hm}`
}

/** De berichten van een chatgesprek in de stijl van de tool (Google Chat, Slack, Teams, Airtable). */
export function ChatThread({ reply, messages, more, onReacted }: { reply: Reply; messages: ReplyMessage[]; more: ReactNode; onReacted: (emoji: string) => void }) {
  return (
    <div className={`reply__thread is-chat is-${reply.channel}`} aria-label={`Gesprek in ${CHANNEL_NAME[reply.channel]}`}>
      {reply.channel === 'airtable' && <div className="cthread__head">Reacties</div>}
      {more}
      {messages.map((m, i) => {
        const name = m.mine ? 'Jij' : m.author
        // Zelfde afzender direct na elkaar: één blok, zonder naam en avatar (zoals Chat, Slack en Teams doen).
        const prev = messages[i - 1]
        const grouped = reply.channel !== 'airtable' && !!prev && prev.author === m.author && !!prev.mine === !!m.mine
        return (
          <div key={i} className={`cmsg${m.mine ? ' is-mine' : ''}${grouped ? ' is-grouped' : ''}`}>
            {grouped ? <span className="cmsg__gutter" aria-hidden="true" /> : <Avatar name={m.mine ? 'Nino' : m.author} />}
            <div className="cmsg__body">
              {!grouped && (
                <div className="cmsg__meta">
                  <b>{name}</b>
                  <time dateTime={m.at ?? undefined}>{clock(m.at)}</time>
                </div>
              )}
              <div className="cmsg__text">{withMentions(m.text)}</div>
              <Reactions reply={reply} message={m} onReacted={onReacted} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
