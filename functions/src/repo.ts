import type { CalendarRule, Project, Reply, Suggestion, Todo } from '../../src/model/types'
import type { TokenKind } from './tokens'

/** Een toegangsbewijs. Het document-id is de SHA-256-hash van het token (zo zoek je op hash zonder iets af te lopen). */
export interface TokenRecord {
  /** Korte, publieke aanduiding (begin van de hash); hiermee verwijder je een token. */
  id: string
  hash: string
  uid: string
  name: string
  kind: TokenKind
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  clientId?: string
}

export interface OAuthClient {
  id: string
  name: string
  redirectUris: string[]
  createdAt: string
  /** Niet-gebruikte registraties ruimen we na een tijd op (Firestore TTL). */
  expiresAt: string
}

export interface AuthCode {
  hash: string
  uid: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  resource?: string
  expiresAt: string
}

/** Google-koppeling van een gebruiker. Alleen de server komt erbij; het refresh-token verlaat de server nooit. */
export interface GoogleConnection {
  uid: string
  /** Het Google-account waarmee gekoppeld is. */
  email: string
  /** Google-gebruikers-id; hetzelfde als `users/{id}` in de Chat-API. */
  googleId: string
  refreshToken: string
  /** Scopes die Google echt heeft toegekend (de gebruiker kan er bij het toestemmen één uitvinken). */
  scopes: string[]
  connectedAt: string
  /** Gezet als Google het refresh-token afwijst (ingetrokken of verlopen): opnieuw koppelen. */
  needsReauth?: boolean
}

/** Tijdelijke `state` tijdens het koppelen met Google (beschermt tegen vervalste terugkeer). */
export interface GoogleState {
  hash: string
  uid: string
  expiresAt: string
}

/** Een apparaat dat meldingen mag ontvangen (FCM-registratietoken). */
export interface PushDevice {
  /** Korte aanduiding (begin van de hash van het token). */
  id: string
  uid: string
  token: string
  /** Leesbare naam, bv. "iPhone" of "Chrome op Mac". */
  label: string
  createdAt: string
  lastSeenAt: string
}

/** Wat de server onthoudt over scans en meldingen, per gebruiker. */
export interface ServerState {
  /** De standaardregel (QBR) is eenmalig aangemaakt. */
  rulesSeeded?: boolean
  lastCalendarScan?: { at: string; found: number; created: number; error?: string }
  lastChatScan?: { at: string; found: number; created: number; error?: string }
  /** Dag waarop de ochtendmelding al is verstuurd (YYYY-MM-DD). */
  morningPushDay?: string
  /** Meldingen op taaktijd die al verstuurd zijn: sleutel `<todoId>|<due>|<dueTime>` -> verstuurd op (ISO). */
  notified?: Record<string, string>
}

/**
 * De ene deur naar de opslag. De logica kent alleen deze interface;
 * `MemoryRepo` is voor tests, `FirestoreRepo` voor echt.
 */
export interface Repo {
  listTodos(uid: string): Promise<Todo[]>
  getTodo(uid: string, id: string): Promise<Todo | null>
  saveTodo(uid: string, todo: Todo): Promise<void>
  listProjects(uid: string): Promise<Project[]>
  /** Open taken met precies deze dag als datum (voor de melding op taaktijd; scheelt lezen). */
  listTodosDueOn(uid: string, day: string): Promise<Todo[]>
  listSuggestions(uid: string): Promise<Suggestion[]>
  saveSuggestion(uid: string, suggestion: Suggestion): Promise<void>
  listCalendarRules(uid: string): Promise<CalendarRule[]>
  saveCalendarRule(uid: string, rule: CalendarRule): Promise<void>

  getGoogle(uid: string): Promise<GoogleConnection | null>
  listGoogle(): Promise<GoogleConnection[]>
  saveGoogle(conn: GoogleConnection): Promise<void>
  deleteGoogle(uid: string): Promise<void>
  saveGoogleState(state: GoogleState): Promise<void>
  /** Haalt de state op en verwijdert hem meteen: werkt maar één keer. */
  consumeGoogleState(hash: string): Promise<GoogleState | null>

  /** Tab Antwoorden. */
  listReplies(uid: string): Promise<Reply[]>
  getReply(uid: string, id: string): Promise<Reply | null>
  saveReply(uid: string, reply: Reply): Promise<void>

  listDevices(uid: string): Promise<PushDevice[]>
  /** Alle apparaten van alle gebruikers (voor de geplande meldingen). */
  listAllDevices(): Promise<PushDevice[]>
  saveDevice(device: PushDevice): Promise<void>
  deleteDevice(id: string): Promise<void>

  getState(uid: string): Promise<ServerState>
  /** Voegt velden samen met wat er al staat. */
  saveState(uid: string, patch: Partial<ServerState>): Promise<void>

  findToken(hash: string): Promise<TokenRecord | null>
  saveToken(record: TokenRecord): Promise<void>
  touchToken(hash: string, at: string): Promise<void>
  listTokens(uid: string): Promise<TokenRecord[]>
  /** Geeft false als er niets te verwijderen was. */
  deleteToken(uid: string, id: string): Promise<boolean>
  deleteTokenByHash(hash: string): Promise<void>

  getClient(id: string): Promise<OAuthClient | null>
  saveClient(client: OAuthClient): Promise<void>
  saveCode(code: AuthCode): Promise<void>
  /** Haalt de code op en verwijdert hem meteen: een code werkt maar één keer. */
  consumeCode(hash: string): Promise<AuthCode | null>
}

export class MemoryRepo implements Repo {
  todos = new Map<string, Todo[]>()
  projects = new Map<string, Project[]>()
  suggestions = new Map<string, Suggestion[]>()
  replies = new Map<string, Reply[]>()
  rules = new Map<string, CalendarRule[]>()
  google = new Map<string, GoogleConnection>()
  googleStates = new Map<string, GoogleState>()
  devices = new Map<string, PushDevice>()
  states = new Map<string, ServerState>()
  tokens = new Map<string, TokenRecord>()
  clients = new Map<string, OAuthClient>()
  codes = new Map<string, AuthCode>()

  private list<T extends { id: string }>(m: Map<string, T[]>, uid: string): T[] {
    if (!m.has(uid)) m.set(uid, [])
    return m.get(uid)!
  }
  private upsert<T extends { id: string }>(arr: T[], item: T) {
    const i = arr.findIndex((x) => x.id === item.id)
    if (i >= 0) arr[i] = structuredClone(item)
    else arr.push(structuredClone(item))
  }

  async listTodos(uid: string) {
    return structuredClone(this.list(this.todos, uid))
  }
  async getTodo(uid: string, id: string) {
    const t = this.list(this.todos, uid).find((x) => x.id === id)
    return t ? structuredClone(t) : null
  }
  async saveTodo(uid: string, todo: Todo) {
    this.upsert(this.list(this.todos, uid), todo)
  }
  async listProjects(uid: string) {
    return structuredClone(this.list(this.projects, uid))
  }
  async listTodosDueOn(uid: string, day: string) {
    return structuredClone(this.list(this.todos, uid).filter((t) => !t.done && t.due === day))
  }
  async listSuggestions(uid: string) {
    return structuredClone(this.list(this.suggestions, uid))
  }
  async listCalendarRules(uid: string) {
    return structuredClone(this.list(this.rules, uid))
  }
  async saveCalendarRule(uid: string, rule: CalendarRule) {
    this.upsert(this.list(this.rules, uid), rule)
  }

  async getGoogle(uid: string) {
    return structuredClone(this.google.get(uid) ?? null)
  }
  async listGoogle() {
    return structuredClone([...this.google.values()])
  }
  async saveGoogle(conn: GoogleConnection) {
    this.google.set(conn.uid, structuredClone(conn))
  }
  async deleteGoogle(uid: string) {
    this.google.delete(uid)
  }
  async saveGoogleState(state: GoogleState) {
    this.googleStates.set(state.hash, structuredClone(state))
  }
  async consumeGoogleState(hash: string) {
    const s = this.googleStates.get(hash) ?? null
    this.googleStates.delete(hash)
    return structuredClone(s)
  }

  async listReplies(uid: string) {
    return structuredClone(this.list(this.replies, uid))
  }
  async getReply(uid: string, id: string) {
    const r = this.list(this.replies, uid).find((x) => x.id === id)
    return r ? structuredClone(r) : null
  }
  async saveReply(uid: string, reply: Reply) {
    this.upsert(this.list(this.replies, uid), reply)
  }

  async listDevices(uid: string) {
    return structuredClone([...this.devices.values()].filter((d) => d.uid === uid))
  }
  async listAllDevices() {
    return structuredClone([...this.devices.values()])
  }
  async saveDevice(device: PushDevice) {
    this.devices.set(device.id, structuredClone(device))
  }
  async deleteDevice(id: string) {
    this.devices.delete(id)
  }

  async getState(uid: string) {
    return structuredClone(this.states.get(uid) ?? {})
  }
  async saveState(uid: string, patch: Partial<ServerState>) {
    this.states.set(uid, structuredClone({ ...(this.states.get(uid) ?? {}), ...patch }))
  }
  async saveSuggestion(uid: string, s: Suggestion) {
    this.upsert(this.list(this.suggestions, uid), s)
  }

  async findToken(hash: string) {
    return structuredClone(this.tokens.get(hash) ?? null)
  }
  async saveToken(r: TokenRecord) {
    this.tokens.set(r.hash, structuredClone(r))
  }
  async touchToken(hash: string, at: string) {
    const r = this.tokens.get(hash)
    if (r) r.lastUsedAt = at
  }
  async listTokens(uid: string) {
    return structuredClone([...this.tokens.values()].filter((t) => t.uid === uid))
  }
  async deleteToken(uid: string, id: string) {
    const r = [...this.tokens.values()].find((t) => t.uid === uid && t.id === id)
    if (!r) return false
    this.tokens.delete(r.hash)
    return true
  }
  async deleteTokenByHash(hash: string) {
    this.tokens.delete(hash)
  }

  async getClient(id: string) {
    return structuredClone(this.clients.get(id) ?? null)
  }
  async saveClient(c: OAuthClient) {
    this.clients.set(c.id, structuredClone(c))
  }
  async saveCode(c: AuthCode) {
    this.codes.set(c.hash, structuredClone(c))
  }
  async consumeCode(hash: string) {
    const c = this.codes.get(hash) ?? null
    this.codes.delete(hash)
    return structuredClone(c)
  }
}
