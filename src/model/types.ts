// Het datamodel van de app. Dit bestand is het contract tussen de schermen,
// de serverfuncties en externe koppelingen (zie docs/koppelingen.md).
// Datums zijn overal ISO-tekst: 'YYYY-MM-DD' voor dagen, volledige ISO voor tijdstippen.

/** 'now' = om nu te doen, 'later' = om niet te vergeten. */
export type Bucket = 'now' | 'later'

export type SourceType =
  | 'manual' // getypt in de app
  | 'voice' // ingesproken
  | 'mail' // Helder Mail / Gmail
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
  order: number
  createdAt: string
  updatedAt: string
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

export interface AppData {
  todos: Todo[]
  projects: Project[]
  labels: Label[]
  suggestions: Suggestion[]
  calendarRules: CalendarRule[]
  discussions: Discussion[]
}

export type NewTodo = Pick<Todo, 'title'> & Partial<Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>>
