// Het datamodel van de app. Dit bestand is het contract tussen de schermen,
// de serverfuncties en externe koppelingen (zie docs/koppelingen.md).
// Datums zijn overal ISO-tekst: 'YYYY-MM-DD' voor dagen, volledige ISO voor tijdstippen.

/** 'now' = om nu te doen, 'later' = om niet te vergeten. */
export type Bucket = 'now' | 'later'

export type SourceType =
  | 'manual' // getypt in de app
  | 'voice' // ingesproken
  | 'mail' // de Mail-tab (Gmail)
  | 'meeting' // Granola
  | 'calendar' // agenda-afspraak
  | 'airtable'
  | 'chat' // Google Chat, Slack, Teams
  | 'claude' // via de MCP-koppeling
  | 'api' // Siri, Chrome-extensie, overig

export interface Source {
  type: SourceType
  /** Leesbare naam van de bron, bv. het onderwerp van de mail of de meetingtitel. */
  label?: string
  /** Link terug naar de bron. */
  url?: string
  /** Id in het bronsysteem; gebruikt om dubbele voorstellen te voorkomen. */
  externalId?: string
}

export interface Recurrence {
  freq: 'day' | 'week' | 'month' | 'year'
  /** Elke X dagen/weken/maanden/jaren. */
  interval: number
  /** Alleen bij freq 'week': 1 = maandag … 7 = zondag. */
  weekdays?: number[]
}

export interface Subtask {
  id: string
  title: string
  done: boolean
}

export interface Todo {
  id: string
  title: string
  note: string
  done: boolean
  completedAt: string | null
  due: string | null // YYYY-MM-DD
  dueTime: string | null // HH:mm
  bucket: Bucket
  projectId: string | null // null = geen klant (Overig)
  labelIds: string[]
  subtasks: Subtask[]
  estimateMin: number | null
  recurrence: Recurrence | null
  source: Source
  calendarEventId: string | null
  /** Kolom op het bord (TaskStatus.id). Ontbreekt of onbekend = de eerste open status. Afgevinkt = de Finished-status. */
  statusId?: string | null
  /** Geparkeerd in "Deze week": de maandag (YYYY-MM-DD) van die week. Een andere week = weer gewoon Vandaag. */
  weekOf?: string | null
  order: number
  createdAt: string
  updatedAt: string
}

/**
 * Een kolom op het bord. 'done' = afgevinkt: een taak die daarheen gaat wordt afgevinkt,
 * en elke afgevinkte taak staat daar. Er is precies één 'done'-status.
 */
export interface TaskStatus {
  id: string
  name: string
  kind: 'open' | 'done'
  order: number
}

/** Een project is in de praktijk meestal een klant. */
export interface Project {
  id: string
  name: string
  color: string
  /** Woorden waaraan de klant in vrije tekst herkend wordt. */
  keywords: string[]
  order: number
  archived: boolean
}

export interface Label {
  id: string
  name: string
  color: string
}

/** Een voorstel van AI of een koppeling; wordt pas een todo na akkoord. */
export interface Suggestion {
  id: string
  title: string
  note: string
  due: string | null
  projectId: string | null
  bucket: Bucket
  source: Source
  /** Waarom dit wordt voorgesteld, in één zin. */
  reason: string
  status: 'open' | 'accepted' | 'dismissed'
  createdAt: string
}

/** Regel voor de agenda-scan, bv. "QBR" → "QBR voorbereiden", 3 werkdagen ervoor. */
export interface CalendarRule {
  id: string
  match: string
  titleTemplate: string // {titel} wordt vervangen door de naam van de afspraak
  workdaysBefore: number
  enabled: boolean
}

/** Een punt op een overlegtje; een regel die eindigt op ':' is een tussenkopje (geen vinkje). */
export interface DiscussionItem {
  id: string
  text: string
  done: boolean
  doneAt: string | null
}

/** Een groep "om te bespreken": een klant of persoon met korte punten. */
export interface Discussion {
  id: string
  title: string
  projectId: string | null
  items: DiscussionItem[]
  order: number
  createdAt: string
  updatedAt: string
}

/** Kanaal van een gesprek op de tab Antwoorden. */
export type ReplyChannel = 'mail' | 'gchat' | 'slack' | 'teams' | 'airtable'

/**
 * open = wacht op Nino · approved = vinkje gezet (Teams/Slack: het verzendscript pakt hem op) ·
 * sending = wordt verstuurd · sent = verstuurd · failed = mislukt (zie error) · dismissed = genegeerd
 */
export type ReplyStatus = 'open' | 'approved' | 'sending' | 'sent' | 'failed' | 'dismissed'

export interface ReplyMessage {
  author: string
  text: string
  /** ISO-tijd, als bekend. */
  at: string | null
  /** Van Nino zelf. */
  mine?: boolean
}

/** Waar het antwoord heen gaat. Per kanaal gebruik je andere velden; zie docs/antwoorden.md. */
export interface ReplyTarget {
  /** mail: Gmail-thread-id. */
  threadId?: string
  /** gchat: `spaces/<id>`; thread: `spaces/<id>/threads/<id>` (leeg = nieuw bericht in de space). */
  space?: string
  thread?: string
  /** teams en slack: de webpagina met het invoerveld van het juiste gesprek of de juiste thread. */
  url?: string
  /** airtable: het record en (bij een antwoord op een reactie) de reactie waarop je reageert. */
  baseId?: string
  tableId?: string
  recordId?: string
  parentCommentId?: string
  /** slack: kanaal-id en (thread-)ts, ter info. */
  channel?: string
  ts?: string
}

/** Een gesprek dat op Nino's antwoord wacht, met een voorstel van Claude. */
export interface Reply {
  id: string
  channel: ReplyChannel
  /** Onderwerp, chatnaam of kanaal. */
  title: string
  /** Met wie: afzender of deelnemers. */
  who: string
  projectId: string | null
  /** Link naar het gesprek zelf. */
  url: string | null
  target: ReplyTarget
  /** Uniek per gesprek in het bronsysteem; voorkomt dubbele kaarten. */
  externalId: string
  /** Laatste berichten, oudste eerst. */
  messages: ReplyMessage[]
  /** Het antwoord dat verstuurd wordt. */
  draft: string
  /** Nino heeft het antwoord aangepast: een nieuwe ronde overschrijft het dan niet. */
  draftEdited: boolean
  /** Wat er gevraagd wordt, in één zin. */
  reason: string
  status: ReplyStatus
  error: string | null
  approvedAt: string | null
  sentAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AppData {
  todos: Todo[]
  projects: Project[]
  labels: Label[]
  suggestions: Suggestion[]
  calendarRules: CalendarRule[]
  discussions: Discussion[]
  /** Leeg = de standaardstatussen (zie DEFAULT_STATUSES in data/logic.ts). */
  statuses: TaskStatus[]
  /** Tab Antwoorden. */
  replies: Reply[]
}

export type NewTodo = Pick<Todo, 'title'> & Partial<Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>>
