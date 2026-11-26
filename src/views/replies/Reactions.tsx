import { useEffect, useRef, useState } from 'react'
import { SmilePlus } from 'lucide-react'
import type { Reply, ReplyMessage } from '../../model/types'
import { CHANNEL_NAME, REACTION_CHOICES, canReact, shownReactions } from '../../data/replies'
import { forgetReaction, reactToMessage } from '../../data/sendReply'

/**
 * De emoji onder een chatbericht (Google Chat, Teams, Slack), met een knop om er zelf een te zetten.
 * Klik op een emoji van een ander = dezelfde erbij zetten. Een mislukte emoji opnieuw aanklikken = opnieuw proberen.
 */
export function Reactions({ reply, message, onReacted }: { reply: Reply; message: ReplyMessage; onReacted: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const can = canReact(reply, message)
  const shown = shownReactions(reply, message)

  // Kiezer dicht bij klik ernaast of Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!shown.length && !can) return null

  function pick(emoji: string) {
    setOpen(false)
    // Staat hij er al als de jouwe (of is hij onderweg)? Dan niet nog een keer.
    if (shown.some((r) => r.emoji === emoji && r.mine && r.state !== 'failed')) return
    void reactToMessage(reply, message, emoji)
    onReacted(emoji)
  }

  function retry(emoji: string) {
    for (const q of reply.reactionQueue ?? []) if (q.status === 'failed' && q.emoji === emoji) forgetReaction(reply, q.id)
    pick(emoji)
  }

  const via = reply.channel === 'gchat' ? '' : ' (via de Mac mini)'

  return (
    <div className="reactions" ref={wrap}>
      {shown.map((r) => {
        const title =
          r.state === 'failed'
            ? `Niet gelukt: ${r.error ?? 'onbekende fout'}. Klik om het opnieuw te proberen.`
            : r.state === 'pending'
              ? `Wordt gezet${via}…`
              : r.mine
                ? `${r.count === 1 ? 'Jij' : `Jij en ${r.count - 1} ander${r.count === 2 ? '' : 'en'}`}`
                : `${r.count} ${r.count === 1 ? 'persoon' : 'personen'}${can ? ' · klik om er zelf ook een te zetten' : ''}`
        const clickable = can && (r.state === 'failed' || (!r.mine && !r.state))
        return (
          <button
            key={r.emoji}
            type="button"
            className={`reaction${r.mine ? ' is-mine' : ''}${r.state ? ` is-${r.state}` : ''}`}
            title={title}
            aria-label={`${r.emoji} ${r.count}. ${title}`}
            disabled={!clickable}
            onClick={() => (r.state === 'failed' ? retry(r.emoji) : pick(r.emoji))}
          >
            <span className="reaction__emoji">{r.emoji}</span>
            <span className="reaction__n">{r.count}</span>
          </button>
        )
      })}
      {can && (
        <span className="reaction-add">
          <button
            type="button"
            className="reaction-add__btn"
            title={`Emoji zetten in ${CHANNEL_NAME[reply.channel]}`}
            aria-label="Emoji zetten"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <SmilePlus size={15} />
          </button>
          {open && (
            <span className="reaction-pick" role="menu" aria-label="Kies een emoji">
              {REACTION_CHOICES.map((e) => (
                <button key={e} type="button" role="menuitem" onClick={() => pick(e)} aria-label={e}>
                  {e}
                </button>
              ))}
            </span>
          )}
        </span>
      )}
      {shown
        .filter((r) => r.state === 'failed')
        .map((r) => (
          <span key={`err-${r.emoji}`} className="reaction-err">
            {r.emoji} niet gezet: {r.error ?? 'onbekende fout'}.{' '}
            <button type="button" onClick={() => retry(r.emoji)}>
              Opnieuw
            </button>
          </span>
        ))}
    </div>
  )
}
