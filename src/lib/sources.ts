import { CalendarClock, Database, Mail, MessageSquare, Mic, Sparkles, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SourceType } from '../model/types'

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
