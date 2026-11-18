import { getIdToken } from '../data/session'
import { apiBase } from './capabilities'

export class TranscribeError extends Error {
  constructor(public kind: 'offline' | 'failed') {
    super(kind)
  }
}

/** Stuurt een opname naar de server en geeft de tekst terug. */
export async function transcribe(blob: Blob, signal?: AbortSignal): Promise<string> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new TranscribeError('offline')
  const token = await getIdToken()
  if (!token) throw new TranscribeError('failed')

  let res: Response
  try {
    res = await fetch(`${apiBase()}/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new TranscribeError('offline')
  }
  if (!res.ok) throw new TranscribeError('failed')
  const json = (await res.json()) as { text?: unknown }
  return typeof json.text === 'string' ? json.text : ''
}
