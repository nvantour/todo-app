import type { Repo } from './repo'
import { bearerFrom, hashToken } from './tokens'

export type AuthVia = 'idToken' | 'personal' | 'oauth'
export interface AuthResult {
  uid: string
  via: AuthVia
}

export interface AuthDeps {
  repo: Repo
  /** Controleert een Firebase ID-token (in productie `getAuth().verifyIdToken`). */
  verifyIdToken: (token: string) => Promise<{ uid: string; email?: string } | null>
  /** Optioneel: alleen deze e-mailadressen mogen met een ID-token in. */
  allowedEmails?: string[]
  now?: () => Date
}

const TOUCH_EVERY_MS = 5 * 60_000

/**
 * Wie belt er aan? Een Firebase ID-token (de app zelf) is een JWT met twee punten.
 * Al het andere is een persoonlijk of OAuth-token en wordt op hash opgezocht.
 */
export async function authenticate(header: string | undefined, deps: AuthDeps): Promise<AuthResult | null> {
  const token = bearerFrom(header)
  if (!token) return null
  const now = (deps.now ?? (() => new Date()))()

  if (token.split('.').length === 3) {
    let decoded: { uid: string; email?: string } | null = null
    try {
      decoded = await deps.verifyIdToken(token)
    } catch {
      return null
    }
    if (!decoded) return null
    if (deps.allowedEmails?.length && !deps.allowedEmails.includes((decoded.email ?? '').toLowerCase())) return null
    return { uid: decoded.uid, via: 'idToken' }
  }

  const hash = hashToken(token)
  const record = await deps.repo.findToken(hash)
  if (!record) return null
  if (record.kind === 'oauth_refresh') return null // een refresh-token geeft nooit toegang tot data
  if (record.expiresAt && new Date(record.expiresAt) <= now) return null
  if (!record.lastUsedAt || now.getTime() - new Date(record.lastUsedAt).getTime() > TOUCH_EVERY_MS) {
    await deps.repo.touchToken(hash, now.toISOString()).catch(() => undefined)
  }
  return { uid: record.uid, via: record.kind === 'personal' ? 'personal' : 'oauth' }
}
