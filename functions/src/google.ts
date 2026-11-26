import { HttpError } from './errors'
import { createGoogleApi, type GoogleApi } from './googleApi'
import {
  GOOGLE_SCOPES,
  GoogleReauthError,
  SCOPE_CALENDAR,
  SCOPE_CHAT_CREATE,
  SCOPE_CHAT_REACT,
  SCOPE_CHAT_MESSAGES,
  SCOPE_CHAT_SPACES,
  SCOPE_GMAIL_MODIFY,
  SCOPE_GMAIL_SETTINGS,
  buildAuthUrl,
  exchangeCode,
  fetchUserInfo,
  refreshAccessToken,
  revokeToken,
  splitScopes,
  type Fetch,
  type GoogleClientConfig,
} from './googleAuth'
import type { GoogleConnection, Repo } from './repo'
import { ensureDefaultRules } from './rules'
import { hashToken, randomId } from './tokens'

const STATE_TTL_MS = 10 * 60_000

export interface GoogleServiceDeps {
  repo: Repo
  /** null = client-id en -secret zijn niet ingesteld. */
  config: () => GoogleClientConfig | null
  fetch?: Fetch
  now?: () => Date
}

export interface GoogleStatus {
  /** Server kan koppelen (client-id en -secret staan er). */
  configured: boolean
  connected: boolean
  email?: string
  needsReauth?: boolean
  /** Welke onderdelen werken, op basis van wat Google echt heeft toegekend. */
  calendar?: boolean
  chat?: boolean
  /** Mail in het werk-OS (Gmail lezen en versturen). */
  mail?: boolean
  /** Antwoorden in Google Chat versturen (tab Antwoorden). */
  chatSend?: boolean
  /** Emoji zetten in Google Chat (tab Antwoorden). */
  chatReact?: boolean
  lastCalendarScan?: { at: string; found: number; created: number; error?: string }
  lastChatScan?: { at: string; found: number; created: number; error?: string }
}

export const hasCalendar = (c: Pick<GoogleConnection, 'scopes'>) => c.scopes.includes(SCOPE_CALENDAR)
export const hasChat = (c: Pick<GoogleConnection, 'scopes'>) => c.scopes.includes(SCOPE_CHAT_MESSAGES) && c.scopes.includes(SCOPE_CHAT_SPACES)

export const hasChatSend = (c: Pick<GoogleConnection, 'scopes'>) => c.scopes.includes(SCOPE_CHAT_CREATE)
export const hasChatReact = (c: Pick<GoogleConnection, 'scopes'>) => c.scopes.includes(SCOPE_CHAT_REACT)

export const hasMail = (c: Pick<GoogleConnection, 'scopes'>) => c.scopes.includes(SCOPE_GMAIL_MODIFY) && c.scopes.includes(SCOPE_GMAIL_SETTINGS)

export class GoogleService {
  private fetchImpl: Fetch
  private now: () => Date
  /** Toegangstokens duren een uur; hier houden we ze een tijdje vast (per serverinstantie). */
  private access = new Map<string, { token: string; expires: number }>()

  constructor(private deps: GoogleServiceDeps) {
    this.fetchImpl = deps.fetch ?? fetch
    this.now = deps.now ?? (() => new Date())
  }

  private cfg(): GoogleClientConfig {
    const c = this.deps.config()
    if (!c) throw new HttpError(501, 'not_available', 'Koppelen met Google is nog niet ingesteld op de server (GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET).')
    return c
  }

  async startConnect(uid: string, redirectUri: string, loginHint?: string): Promise<string> {
    const cfg = this.cfg()
    const state = randomId(24)
    await this.deps.repo.saveGoogleState({ hash: hashToken(state), uid, expiresAt: new Date(this.now().getTime() + STATE_TTL_MS).toISOString() })
    return buildAuthUrl(cfg, redirectUri, state, loginHint)
  }

  /** Verwerkt de terugkeer van Google. Geeft de gebruiker terug aan wie de koppeling hoort. */
  async finishConnect(code: string, state: string, redirectUri: string): Promise<{ uid: string; email: string; missing: string[] }> {
    const cfg = this.cfg()
    const saved = await this.deps.repo.consumeGoogleState(hashToken(state))
    if (!saved || new Date(saved.expiresAt) <= this.now()) throw new HttpError(400, 'bad_state', 'Deze koppelpoging is verlopen. Probeer het opnieuw.')
    const tokens = await exchangeCode(cfg, code, redirectUri, this.fetchImpl)
    if (!tokens.refresh_token) throw new HttpError(400, 'no_refresh_token', 'Google gaf geen blijvende toegang. Trek de toegang van deze app in je Google-account in en probeer het opnieuw.')
    const info = await fetchUserInfo(tokens.access_token, this.fetchImpl)
    const scopes = splitScopes(tokens.scope)
    await this.deps.repo.saveGoogle({
      uid: saved.uid,
      email: info.email,
      googleId: info.id,
      refreshToken: tokens.refresh_token,
      scopes,
      connectedAt: this.now().toISOString(),
    })
    this.access.set(saved.uid, { token: tokens.access_token, expires: this.now().getTime() + (tokens.expires_in - 60) * 1000 })
    await ensureDefaultRules(this.deps.repo, saved.uid)
    const wanted = GOOGLE_SCOPES.filter((s) => s !== 'openid' && s !== 'email')
    return { uid: saved.uid, email: info.email, missing: wanted.filter((s) => !scopes.includes(s)) }
  }

  async status(uid: string): Promise<GoogleStatus> {
    const configured = this.deps.config() !== null
    const conn = await this.deps.repo.getGoogle(uid)
    if (!conn) return { configured, connected: false }
    const state = await this.deps.repo.getState(uid)
    return {
      configured,
      connected: true,
      email: conn.email,
      needsReauth: conn.needsReauth === true,
      calendar: hasCalendar(conn),
      chat: hasChat(conn),
      mail: hasMail(conn),
      chatSend: hasChatSend(conn),
      chatReact: hasChatReact(conn),
      lastCalendarScan: state.lastCalendarScan,
      lastChatScan: state.lastChatScan,
    }
  }

  async disconnect(uid: string): Promise<void> {
    const conn = await this.deps.repo.getGoogle(uid)
    if (!conn) return
    await revokeToken(conn.refreshToken, this.fetchImpl)
    await this.deps.repo.deleteGoogle(uid)
    this.access.delete(uid)
  }

  async connection(uid: string): Promise<GoogleConnection> {
    const conn = await this.deps.repo.getGoogle(uid)
    if (!conn) throw new HttpError(409, 'google_not_connected', 'Google is nog niet gekoppeld. Doe dat in Instellingen.')
    if (conn.needsReauth) throw new HttpError(409, 'google_reauth', 'De koppeling met Google is verlopen. Koppel opnieuw in Instellingen.')
    return conn
  }

  /** Een werkend toegangstoken voor deze gebruiker (ververst zo nodig). */
  async accessToken(uid: string): Promise<string> {
    const conn = await this.connection(uid)
    const cached = this.access.get(uid)
    if (cached && cached.expires > this.now().getTime()) return cached.token
    try {
      const t = await refreshAccessToken(this.cfg(), conn.refreshToken, this.fetchImpl)
      this.access.set(uid, { token: t.access_token, expires: this.now().getTime() + (t.expires_in - 60) * 1000 })
      return t.access_token
    } catch (e) {
      if (e instanceof GoogleReauthError) {
        await this.deps.repo.saveGoogle({ ...conn, needsReauth: true })
        this.access.delete(uid)
        throw new HttpError(409, 'google_reauth', 'De koppeling met Google is verlopen. Koppel opnieuw in Instellingen.')
      }
      throw e
    }
  }

  /**
   * Toegangstoken voor de mail in de app zelf (de browser praat rechtstreeks met Gmail).
   * Alleen als de koppeling de Gmail-rechten heeft; het verversingstoken verlaat de server nooit.
   */
  async mailToken(uid: string): Promise<{ accessToken: string; expiresAt: string; email: string }> {
    const conn = await this.connection(uid)
    if (!hasMail(conn)) throw new HttpError(409, 'google_mail_scope', 'Mail is nog niet toegestaan. Koppel Google opnieuw in Instellingen en sta Gmail toe.')
    const accessToken = await this.accessToken(uid)
    const expires = this.access.get(uid)?.expires ?? this.now().getTime() + 5 * 60_000
    return { accessToken, expiresAt: new Date(expires).toISOString(), email: conn.email }
  }

  /** Antwoord in Google Chat plaatsen, als Nino zelf. Alleen aangeroepen na het vinkje in de app. */
  async sendChat(uid: string, space: string, text: string, thread?: string): Promise<void> {
    const conn = await this.connection(uid)
    if (!hasChatSend(conn)) throw new HttpError(409, 'google_chat_send_scope', 'Versturen in Google Chat is nog niet toegestaan. Koppel Google opnieuw in Instellingen.')
    await (await this.api(uid)).createMessage(space, text, thread)
  }

  /** Emoji op een Chat-bericht zetten, als Nino zelf. Alleen aangeroepen na een klik in de app. */
  async reactChat(uid: string, message: string, emoji: string): Promise<void> {
    const conn = await this.connection(uid)
    if (!hasChatReact(conn)) throw new HttpError(409, 'google_chat_react_scope', 'Emoji zetten in Google Chat is nog niet toegestaan. Koppel Google opnieuw in Instellingen.')
    await (await this.api(uid)).createReaction(message, emoji)
  }

  async api(uid: string): Promise<GoogleApi> {
    return createGoogleApi(await this.accessToken(uid), this.fetchImpl)
  }
}
