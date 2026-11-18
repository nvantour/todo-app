import { createHash, randomBytes } from 'node:crypto'

/** Van een token wordt alleen deze hash bewaard. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export type TokenKind = 'personal' | 'oauth_access' | 'oauth_refresh'

const PREFIX: Record<TokenKind, string> = { personal: 'tdp_', oauth_access: 'tda_', oauth_refresh: 'tdr_' }

export function generateToken(kind: TokenKind): string {
  return PREFIX[kind] + randomBytes(32).toString('base64url')
}

export const randomId = (bytes = 16): string => randomBytes(bytes).toString('base64url')

/** Haalt het token uit 'Authorization: Bearer <token>'. */
export function bearerFrom(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')
  return m ? m[1] : null
}
