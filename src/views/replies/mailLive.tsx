// Mail op een kaart van de tab Antwoorden tonen zoals in de Mail-tab: de echte mail uit Gmail,
// met opmaak en afbeeldingen, nieuwste bovenaan, en de handtekening die onder het antwoord komt.
// De gegevens komen uit mailData.ts.
import { useEffect, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import type { Message } from '../../mail/mail'
import { QUOTE, mailDoc } from '../../mail/render'
import { loadInline, withInline, type LiveThread, type MailSession, type Signature } from './mailData'

/** Afgeschermd kader (geen scripts) dat zo hoog wordt als de inhoud, ook als afbeeldingen later laden. */
export function MailFrame({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const f = ref.current
    if (!f) return
    let ro: ResizeObserver | null = null
    const fit = () => {
      const d = f.contentDocument
      // Het kader is zo hoog als de mail, tot een maximum (CSS); een langere mail schuift binnen het kader.
      if (d?.body) f.style.height = `${d.body.scrollHeight}px`
    }
    const onLoad = () => {
      fit()
      ro?.disconnect()
      const body = f.contentDocument?.body
      if (body) {
        ro = new ResizeObserver(fit)
        ro.observe(body)
      }
    }
    f.addEventListener('load', onLoad)
    onLoad() // het kader kan al geladen zijn voordat we luisteren
    return () => {
      f.removeEventListener('load', onLoad)
      ro?.disconnect()
    }
  }, [html])
  return <iframe ref={ref} className="reply__mailframe" title={title} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={html} />
}

/**
 * Elk citaatblok telt op de kaart als aangehaalde eerdere mail, ook dat van de app zelf (dat heeft geen
 * type="cite"). Zo blijft per mail alleen over wat de afzender nieuw schreef; "Citaat tonen" haalt het terug.
 */
const markQuotes = (html: string) => html.replace(/<blockquote(?![^>]*\btype=)/gi, '<blockquote type="cite"')

const time = (ms: number) => new Date(ms).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function LiveMessage({ m, session }: { m: Message; session: MailSession }) {
  const [quote, setQuote] = useState(false)
  const [inline, setInline] = useState<Record<string, string> | null>(null)
  const needsInline = !!m.html && !!m.inline?.length && /cid:/i.test(m.html)
  useEffect(() => {
    if (!needsInline) return
    let on = true
    void loadInline(session, m).then((map) => {
      if (on) setInline(map)
    })
    return () => {
      on = false
    }
  }, [needsInline, session, m])

  return (
    <div className={`reply__msg${m.me ? ' is-mine' : ''}`}>
      <div className="reply__meta">
        <b>{m.me ? 'Jij' : m.from}</b> {time(m.date)}
      </div>
      {m.html ? (
        <>
          <MailFrame html={mailDoc(markQuotes(withInline(m.html, inline)), true, quote)} title={`E-mail van ${m.me ? 'jou' : m.from}`} />
          {QUOTE.test(m.html) && (
            <button className="reply__more" onClick={() => setQuote((q) => !q)}>
              {quote ? 'Citaat verbergen' : 'Citaat tonen'}
            </button>
          )}
        </>
      ) : (
        <div className="reply__text">{m.body || m.snippet}</div>
      )}
      {m.attachments.length > 0 && (
        <div className="reply__files">
          {m.attachments.map((a, i) => (
            <span key={i} className="reply__file">
              <Paperclip size={12} /> {a.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** De mail-thread op de kaart: nieuwste mail bovenaan, eerst de laatste drie. */
export function LiveMailThread({ live }: { live: LiveThread }) {
  const [showAll, setShowAll] = useState(false)
  const newestFirst = [...live.thread.messages].reverse()
  const shown = showAll ? newestFirst : newestFirst.slice(0, 3)
  return (
    <div className="reply__thread is-mail">
      <div className="reply__threadhead">Eerdere mails</div>
      {shown.map((m) => (
        <LiveMessage key={m.id} m={m} session={live} />
      ))}
      {newestFirst.length > 3 && !showAll && (
        <button className="reply__more" onClick={() => setShowAll(true)}>
          {newestFirst.length - 3} eerdere {newestFirst.length - 3 === 1 ? 'mail' : 'mails'}
        </button>
      )}
    </div>
  )
}

/** De handtekening onder het antwoord, zoals hij met de mail meegaat. */
export function SignaturePreview({ sig }: { sig: Signature | null }) {
  if (!sig) return null
  if (!sig.html.trim()) {
    return (
      <p className="reply__nosig">
        Deze mail gaat zonder handtekening weg: in Gmail staat de standaard op "Geen handtekening". Zet in Gmail bij Instellingen › Handtekening de
        standaard voor nieuwe e-mails op jouw handtekening.
      </p>
    )
  }
  return (
    <div className="reply__sig" aria-label="Handtekening">
      <MailFrame html={mailDoc(sig.html, true, true)} title="Handtekening" />
    </div>
  )
}
