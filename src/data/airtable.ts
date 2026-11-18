import type { Source } from '../model/types'
import { findAirtableUrl, parseAirtableUrl, type AirtableRef } from '../lib/airtable'
import { apiCall, hasServer } from './server'
import { getSession } from './session'
import { store } from './store'

interface Resolved {
  label: string
  recordName: string | null
  projectId: string | null
}

/** De bron van een taak die uit een Airtable-link komt. Zonder server blijft het label algemeen. */
export function airtableSource(ref: AirtableRef, label = 'Airtable-record'): Source {
  return { type: 'airtable', label, url: ref.url, externalId: ref.recordId }
}

export const PROVISIONAL_TITLE = 'Bekijk Airtable-record'

/**
 * Zet een Airtable-link als bron op een taak. De link is meteen bewaard; daarna probeert de server
 * de naam van het record en de base op te halen. Lukt dat niet (geen server, geen sleutel, geen
 * toegang), dan blijft de link gewoon staan.
 */
export async function attachAirtable(todoId: string, ref: AirtableRef): Promise<'named' | 'link-only'> {
  store.updateTodo(todoId, { source: airtableSource(ref) })
  const session = getSession()
  if (!hasServer() || session.status !== 'signedIn') return 'link-only'
  try {
    const r = await apiCall<Resolved>('/airtable/resolve', { method: 'POST', body: JSON.stringify({ url: ref.url }) })
    const todo = store.getSnapshot().todos.find((t) => t.id === todoId)
    if (!todo) return 'link-only'
    store.updateTodo(todoId, {
      source: airtableSource(ref, r.label),
      ...(todo.projectId === null && r.projectId ? { projectId: r.projectId } : {}),
      ...(todo.title === PROVISIONAL_TITLE && r.recordName ? { title: `Bekijk ${r.recordName}` } : {}),
    })
    return 'named'
  } catch {
    return 'link-only'
  }
}

export { findAirtableUrl, parseAirtableUrl }
