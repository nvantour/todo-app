import { CalendarCheck, LayoutGrid, ListChecks, Mail, MessagesSquare, Reply, Sparkles, Sun, type LucideIcon } from 'lucide-react'
import type { NavId } from '../lib/navOrder'

export interface NavItem {
  path: string
  /** Naam in de zijbalk en in Instellingen. */
  label: string
  /** Kortere naam voor de telefoonbalk. */
  short: string
  icon: LucideIcon
}

export const NAV_ITEMS: Record<NavId, NavItem> = {
  vandaag: { path: '/vandaag', label: 'Vandaag', short: 'Vandaag', icon: Sun },
  taken: { path: '/taken', label: 'Taken', short: 'Taken', icon: ListChecks },
  bespreken: { path: '/bespreken', label: 'Om te bespreken', short: 'Bespreken', icon: MessagesSquare },
  meetings: { path: '/meetings', label: 'Meetings', short: 'Meetings', icon: CalendarCheck },
  mail: { path: '/mail', label: 'Mail', short: 'Mail', icon: Mail },
  antwoorden: { path: '/antwoorden', label: 'Antwoorden', short: 'Antwoorden', icon: Reply },
  voorstellen: { path: '/voorstellen', label: 'Voorstellen', short: 'Voorstellen', icon: Sparkles },
  klanten: { path: '/klanten', label: 'Per klant', short: 'Per klant', icon: LayoutGrid },
}
