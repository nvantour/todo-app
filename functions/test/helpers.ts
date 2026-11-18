import type { Project } from '../../src/model/types'
import { handleApi, type ApiDeps, type ApiRequest } from '../src/api'
import type { AiCapture } from '../src/capture'
import { MemoryRepo } from '../src/repo'
import { TodoService } from '../src/service'
import { generateToken, hashToken } from '../src/tokens'

export const UID = 'nino'
/** Woensdag 18 november 2026, 11:00 in Nederland. */
export const NOW = new Date('2026-11-18T10:00:00Z')
export const TODAY = '2026-11-18'

export const projects: Project[] = [
  { id: 'wehkamp', name: 'Wehkamp', color: '#f00', keywords: ['wehkamp', 'wehkamp.nl'], order: 0, archived: false },
  { id: 'keesing', name: 'Keesing', color: '#0f0', keywords: ['keesing'], order: 1, archived: false },
  { id: 'oud', name: 'Oud', color: '#000', keywords: ['oudklant'], order: 2, archived: true },
]

export function setup(opts: { now?: Date; ai?: AiCapture | null } = {}) {
  const repo = new MemoryRepo()
  repo.projects.set(UID, structuredClone(projects))
  let n = 0
  const service = new TodoService(repo, { now: () => opts.now ?? NOW, newId: () => `id-${++n}` })
  const idTokens = new Map([['eyJ.valid.jwt', { uid: UID, email: 'nino@example.com' }]])
  const deps: ApiDeps = {
    service,
    ai: opts.ai ?? null,
    auth: { repo, now: () => opts.now ?? NOW, verifyIdToken: async (t) => idTokens.get(t) ?? null },
    transcribe: async (audio, mime) => `transcript ${audio.length} ${mime}`,
  }
  return { repo, service, deps }
}

export const ID_AUTH = { authorization: 'Bearer eyJ.valid.jwt' }

export function call(deps: ApiDeps, method: string, path: string, body?: unknown, headers: Record<string, string> = ID_AUTH, query: Record<string, string> = {}) {
  const req: ApiRequest = { method, path, query, headers, body }
  return handleApi(req, deps)
}

/** Maakt direct een persoonlijk token aan in de opslag en geeft het token zelf terug. */
export async function personalToken(repo: MemoryRepo, name = 'test') {
  const token = generateToken('personal')
  const hash = hashToken(token)
  await repo.saveToken({ id: hash.slice(0, 12), hash, uid: UID, name, kind: 'personal', createdAt: NOW.toISOString(), lastUsedAt: null, expiresAt: null })
  return token
}
