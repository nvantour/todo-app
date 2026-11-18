import type { NewTodo, Project } from '../model/types'
import { findAirtableUrl } from '../lib/airtable'
import { parseQuickAdd } from '../lib/parse'
import { PROVISIONAL_TITLE, airtableSource, attachAirtable } from './airtable'
import { store } from './store'

/**
 * Voegt een getypte zin toe als taak; datum, tijd, herhaling en klant worden uit de zin gehaald.
 * Staat er een Airtable-link in, dan wordt die de bron van de taak (en de rest van de zin de titel).
 */
export function addFromText(text: string, projects: Project[], defaults: Partial<NewTodo> = {}) {
  const raw = text.trim()
  if (!raw) return null
  const airtable = findAirtableUrl(raw)
  const parsed = parseQuickAdd(airtable ? airtable.rest || PROVISIONAL_TITLE : raw, projects)
  const id = store.addTodo({
    ...defaults,
    title: parsed.title,
    due: parsed.due ?? defaults.due ?? null,
    dueTime: parsed.dueTime,
    recurrence: parsed.recurrence,
    projectId: parsed.projectId ?? defaults.projectId ?? null,
    ...(airtable ? { source: airtableSource(airtable.ref) } : {}),
  })
  if (airtable) void attachAirtable(id, airtable.ref)
  return id
}
