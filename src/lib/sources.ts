import { CalendarClock, Database, Mail, MessageSquare, Mic, Sparkles, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Source, SourceType } from '../model/types'

export const SOURCE_ICON: Partial<Record<SourceType, LucideIcon>> = {
  mail: Mail,
  meeting: Users,
  calendar: CalendarClock,
  airtable: Database,
  chat: MessageSquare,
  voice: Mic,
  claude: Sparkles,
}

/** Wat je ziet als een bron geen eigen naam meegaf. */
export const SOURCE_NAME: Record<SourceType, string> = {
  manual: 'Zelf getypt',
  voice: 'Ingesproken',
  mail: 'Mail',
  meeting: 'Meeting',
  calendar: 'Agenda',
  airtable: 'Airtable',
  chat: 'Chat',
  claude: 'Claude',
  api: 'Koppeling',
}

/** Link binnen de app (bv. een mail-thread in de Mail-tab) of naar buiten (Airtable, Gmail, agenda)? */
export function isInternal(url: string): boolean {
  try {
    return new URL(url, window.location.origin).origin === window.location.origin
  } catch {
    return false
  }
}

/**
 * Waar de bron naartoe linkt. Meestal staat de link er al bij; zo niet, dan leiden we hem af uit het id
 * dat Claude of een scan meegaf: een Gmail-id opent de thread in de Mail-tab, een Chat-bericht de space.
 */
export function sourceHref(source: Source): string | undefined {
  if (source.url) return source.url
  const id = source.externalId?.trim()
  if (!id) return undefined
  if (source.type === 'mail') {
    const gmail = /^(?:gmail:)?([0-9a-f]{12,20})$/i.exec(id)
    if (gmail) return `/mail#mail-${gmail[1]}`
  }
  const space = /^spaces\/([^/]+)/.exec(id)
  if (space) return `https://mail.google.com/mail/u/0/#chat/space/${space[1]}`
  if (/^https?:\/\//.test(id)) return id
  return undefined
}
