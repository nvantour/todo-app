import type { Todo } from '../model/types'

/** Open taken die bij een mail horen, per thread-id (taak van "Maak taak", of van Claude met gmail:<id>). */
export function openMailTasks(todos: Todo[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const t of todos) {
    if (t.done || t.source?.type !== 'mail') continue
    const id = /^(?:gmail:)?([0-9a-f]{10,})$/i.exec(t.source.externalId ?? '')?.[1] ?? /#mail-([0-9a-f]+)/i.exec(t.source.url ?? '')?.[1]
    if (id && !out.has(id)) out.set(id, t.title)
  }
  return out
}
