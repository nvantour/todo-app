import { useEffect, useRef, useState } from 'react'
import { Check, Database, ExternalLink, Hash, ListPlus, Mail, MessageSquare, RotateCcw, Users, X, type LucideIcon } from 'lucide-react'
import type { Reply, ReplyChannel } from '../model/types'
import { store, useAppData } from '../data/store'
import { CHANNELS, CHANNEL_NAME, SENT_BY_APP, visibleReplies } from '../data/replies'
import { approveReply, dismissReply, reopenReply } from '../data/sendReply'
import { isInternal } from '../lib/sources'
import { Link } from 'react-router-dom'
import { LiveMailThread, SignaturePreview } from './replies/mailLive'
import { useMailThread, useSignature } from './replies/mailData'

const CHANNEL_ICON: Record<ReplyChannel, LucideIcon> = { mail: Mail, gchat: MessageSquare, slack: Hash, teams: Users, airtable: Database }

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

/**
 * Wie wacht er op een antwoord? De scan op de server zet elk uur kaarten klaar (Google Chat, mail, en via
 * meldingsmails ook Teams en Slack), zonder concept. Claude vult met /chats-ophalen de concepten aan en leest
 * Teams en Slack volledig. Nino past het antwoord aan en verstuurt met het vinkje; niets gaat vanzelf weg.
 */
export function RepliesView() {
  const data = useAppData()
  const replies = visibleReplies(data)
  const [filter, setFilter] = useState<ReplyChannel | 'all'>('all')
  const count = (c: ReplyChannel) => replies.filter((r) => r.channel === c && (r.status === 'open' || r.status === 'failed')).length
  const shown = filter === 'all' ? replies : replies.filter((r) => r.channel === filter)

  return (
    <>
      <header className="view-header">
        <h1>Antwoorden</h1>
        <p>Wie wacht er op jou. Bovenaan elk gesprek staat het antwoord: pas het aan en verstuur met het vinkje.</p>
      </header>

      <div className="seg reply-filter" role="group" aria-label="Kanaal">
        <button className={filter === 'all' ? 'is-on' : ''} onClick={() => setFilter('all')}>
          Alles
        </button>
        {CHANNELS.map((c) => (
          <button key={c} className={filter === c ? 'is-on' : ''} onClick={() => setFilter(c)}>
            {CHANNEL_NAME[c]}
            {count(c) > 0 && <span className="reply-filter__n">{count(c)}</span>}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <div className="empty">
          <strong>{filter === 'all' ? 'Niemand wacht op je' : `Niemand wacht op je in ${CHANNEL_NAME[filter]}`}</strong>
          Google Chat en mail worden elk uur nagekeken. Typ <code>/chats-ophalen</code> in Claude voor alle kanalen, met een conceptantwoord erbij.
        </div>
      )}

      {shown.map((r) => (
        <ReplyCard key={r.id} reply={r} projectName={data.projects.find((p) => p.id === r.projectId)} />
      ))}
    </>
  )
}

function ReplyCard({ reply, projectName }: { reply: Reply; projectName?: { name: string; color: string } }) {
  const [text, setText] = useState(reply.draft)
  const [showAll, setShowAll] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const Icon = CHANNEL_ICON[reply.channel]
  const locked = reply.status === 'approved' || reply.status === 'sending' || reply.status === 'sent'
  // Teams en Slack gaan via het verzendscript; dat heeft de link naar het juiste gesprek nodig.
  const noAddress = (reply.channel === 'teams' || reply.channel === 'slack') && !reply.target.url
  const isMail = reply.channel === 'mail'
  const editable = reply.status === 'open' || reply.status === 'failed'
  // Mail: de echte thread uit Gmail (met opmaak en afbeeldingen) en de handtekening die eronder komt.
  const live = useMailThread(isMail ? reply.target.threadId : undefined, reply.updatedAt)
  const signature = useSignature(isMail && editable)
  // Mail leest van boven naar beneden: de nieuwste mail eerst. Een chat blijft in de volgorde van het gesprek.
  const ordered = isMail ? [...reply.messages].reverse() : reply.messages
  const messages = showAll ? ordered : isMail ? ordered.slice(0, 3) : ordered.slice(-3)
  const more = reply.messages.length > 3 && !showAll && (
    <button className="reply__more" onClick={() => setShowAll(true)}>
      {reply.messages.length - 3} eerdere berichten
    </button>
  )

  // Een nieuwe ronde kan het voorstel bijwerken zolang Nino niets heeft aangepast.
  const [seenDraft, setSeenDraft] = useState(reply.draft)
  if (reply.draft !== seenDraft) {
    setSeenDraft(reply.draft)
    if (!reply.draftEdited || reply.draft === text) setText(reply.draft)
  }

  // Tekstvak meegroeien met de inhoud, ook als de breedte verandert (eerste opbouw, venster groter/kleiner).
  useEffect(() => {
    const el = box.current
    if (!el) return
    const grow = () => {
      el.style.height = 'auto'
      const next = `${el.scrollHeight + 2}px`
      el.style.height = next
    }
    grow()
    let width = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      grow()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])

  function saveDraft() {
    if (text !== reply.draft) store.updateReply(reply.id, { draft: text, draftEdited: true })
  }

  function makeTask() {
    store.addTodo({
      title: `Antwoorden: ${reply.title}`,
      note: reply.reason,
      projectId: reply.projectId,
      source: { type: reply.channel === 'mail' ? 'mail' : reply.channel === 'airtable' ? 'airtable' : 'chat', label: `${CHANNEL_NAME[reply.channel]} · ${reply.title}`, url: reply.url ?? undefined, externalId: reply.externalId },
    })
    dismissReply(reply)
  }

  return (
    <article className={`reply is-${reply.status}`} aria-label={`${CHANNEL_NAME[reply.channel]}: ${reply.title}`}>
      <header className="reply__head">
        <span className="reply__channel" title={CHANNEL_NAME[reply.channel]}>
          <Icon size={14} />
        </span>
        <div className="reply__who">
          <strong>{reply.who || reply.title}</strong>
          <span>
            {reply.who ? reply.title : CHANNEL_NAME[reply.channel]}
            {projectName && (
              <span className="tag" style={{ '--c': projectName.color } as React.CSSProperties}>
                <i />
                {projectName.name}
              </span>
            )}
          </span>
        </div>
        {reply.url &&
          (isInternal(reply.url) ? (
            <Link className="icon-btn" to={reply.url} title="Open het gesprek" aria-label="Open het gesprek">
              <ExternalLink size={15} />
            </Link>
          ) : (
            <a className="icon-btn" href={reply.url} target="_blank" rel="noreferrer" title="Open het gesprek" aria-label="Open het gesprek">
              <ExternalLink size={15} />
            </a>
          ))}
      </header>

      {reply.reason && <p className="reply__reason">{reply.reason}</p>}

      <textarea
        ref={box}
        className="reply__draft"
        aria-label="Jouw antwoord"
        placeholder={noAddress ? `Antwoorden doe je in ${CHANNEL_NAME[reply.channel]} zelf: open het gesprek met de knop rechtsboven.` : 'Nog geen concept. Typ je antwoord, of laat Claude er een schrijven met /chats-ophalen.'}
        value={text}
        disabled={locked}
        onChange={(e) => setText(e.target.value)}
        onBlur={saveDraft}
        rows={2}
      />
      {isMail && editable && <SignaturePreview sig={signature} />}

      <footer className="reply__foot">
        <Status reply={reply} />
        {reply.status === 'open' || reply.status === 'failed' ? (
          <>
            <button className="btn" onClick={makeTask} title="Geen snel antwoord: maak er een taak van">
              <ListPlus size={15} /> Taak
            </button>
            <button className="btn" onClick={() => dismissReply(reply)} title="Hoeft geen antwoord">
              <X size={15} /> Negeren
            </button>
            <button
              className="btn is-primary"
              disabled={!text.trim() || noAddress}
              onClick={() => void approveReply(reply, text)}
              title={noAddress ? `Versturen kan hier niet: open het gesprek in ${CHANNEL_NAME[reply.channel]}` : SENT_BY_APP.includes(reply.channel) ? 'Nu versturen' : 'Versturen via de Mac mini'}
            >
              <Check size={15} strokeWidth={2.5} /> Versturen
            </button>
          </>
        ) : reply.status === 'approved' ? (
          <button className="btn" onClick={() => reopenReply(reply)} title="Nog niet versturen">
            <RotateCcw size={15} /> Terugzetten
          </button>
        ) : null}
      </footer>

      {live ? (
        <LiveMailThread live={live} />
      ) : (
        <div className={`reply__thread${isMail ? ' is-mail' : ''}`}>
          {!isMail && more}
          {messages.map((m, i) => (
            <div key={i} className={`reply__msg${m.mine ? ' is-mine' : ''}`}>
              <div className="reply__meta">
                <b>{m.mine ? 'Jij' : m.author}</b> {time(m.at)}
              </div>
              <div className="reply__text">{m.text}</div>
            </div>
          ))}
          {isMail && more}
        </div>
      )}
    </article>
  )
}

function Status({ reply }: { reply: Reply }) {
  switch (reply.status) {
    case 'approved':
      return <span className="reply__status">Wacht op de Mac mini…</span>
    case 'sending':
      return <span className="reply__status">Versturen…</span>
    case 'sent':
      return <span className="reply__status is-ok">Verstuurd {time(reply.sentAt)}</span>
    case 'failed':
      return <span className="reply__status is-bad">Mislukt: {reply.error ?? 'onbekende fout'}</span>
    default:
      return <span className="reply__status">{CHANNEL_NAME[reply.channel]}</span>
  }
}
