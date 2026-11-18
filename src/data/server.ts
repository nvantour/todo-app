import { apiBase } from '../voice/capabilities'
import { getIdToken } from './session'

/** Een fout van de eigen server, met de tekst die de server in gewoon Nederlands meegaf. */
export class ServerError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Is er een server ingesteld? Zonder draait de app alleen op lokale opslag. */
export const hasServer = () => Boolean(apiBase())

/** Roept de eigen server aan met het inlogbewijs van de gebruiker. */
export async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
  const base = apiBase()
  if (!base) throw new ServerError(0, 'no_server', 'De app is niet met de server verbonden.')
  const token = await getIdToken()
  if (!token) throw new ServerError(401, 'unauthorized', 'Je bent niet ingelogd.')
  let res: Response
  try {
    res = await fetch(base + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers } })
  } catch {
    throw new ServerError(0, 'offline', 'Geen verbinding met de server.')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
    throw new ServerError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? `De server gaf een fout (${res.status}).`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}
