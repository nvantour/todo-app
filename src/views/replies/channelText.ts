import type { Reply, ReplyChannel } from '../../model/types'
import { CHANNEL_NAME } from '../../data/replies'

/** Naam van de tool in de balk: bij mail heet hij zoals de tool zelf. */
export const brandName = (channel: ReplyChannel) => (channel === 'mail' ? 'Gmail' : CHANNEL_NAME[channel])

/** Waar het gesprek staat, zoals de tool het zelf noemt: `# kanaal`, de space, het record of het onderwerp. */
export function whereLabel(reply: Reply): string {
  const t = reply.title.trim()
  if (reply.channel === 'slack') return t.startsWith('#') ? `# ${t.slice(1)}` : t
  return t
}

/** Hoe het invoerveld in de tool heet, als placeholder en als label boven het concept. */
export function composeLabel(reply: Reply): string {
  switch (reply.channel) {
    case 'gchat':
      return reply.target.thread ? 'Antwoord in thread' : `Bericht aan ${reply.title}`
    case 'slack':
      return reply.target.ts || reply.target.url?.includes('/thread/') ? 'Antwoord in thread' : `Bericht aan ${whereLabel(reply)}`
    case 'teams':
      return 'Antwoorden'
    case 'airtable':
      return reply.target.parentCommentId ? 'Antwoord op reactie' : 'Reactie op record'
    case 'mail':
      return 'Antwoord'
  }
}
