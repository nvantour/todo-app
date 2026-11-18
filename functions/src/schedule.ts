import type { Todo } from '../../src/model/types'
import { HttpError } from './errors'
import { hasCalendar, type GoogleService } from './google'
import { SCAN_DAYS } from './calendarScan'
import { TZ, busyFromEvents, findFreeSlot } from './slots'
import type { TodoService } from './service'

export interface ScheduleResult {
  todo: Todo
  eventId: string
  start: string
  end: string
  /** Het blok valt na de datum van de taak. */
  afterDue: boolean
}

/** Zoekt het eerstvolgende vrije blok in de agenda en maakt daar een afspraak voor de taak. */
export async function scheduleTodo(
  deps: { service: TodoService; google: GoogleService },
  uid: string,
  id: string,
  minutes: number,
  opts: { replace?: boolean } = {},
): Promise<ScheduleResult> {
  const { service, google } = deps
  const todo = await service.getTodo(uid, id)
  if (todo.done) throw new HttpError(409, 'already_done', 'Deze taak is al afgevinkt.')
  if (todo.calendarEventId && !opts.replace) throw new HttpError(409, 'already_scheduled', 'Deze taak staat al in je agenda.')
  const conn = await google.connection(uid)
  if (!hasCalendar(conn)) throw new HttpError(409, 'google_scope_missing', 'De agenda is niet gekoppeld (toestemming ontbreekt). Koppel opnieuw in Instellingen.')
  const api = await google.api(uid)
  const now = new Date(service.stamp())
  const events = await api.listEvents(now.toISOString(), new Date(now.getTime() + (SCAN_DAYS + 3) * 86_400_000).toISOString())
  const slot = findFreeSlot(busyFromEvents(events), now, minutes, SCAN_DAYS)
  if (!slot) throw new HttpError(409, 'no_free_slot', `Geen vrij blok van ${minutes} minuten in de komende ${SCAN_DAYS} dagen.`)

  const description = [todo.note.trim(), todo.source.url ? `Bron: ${todo.source.url}` : '', 'Ingepland vanuit je todo-app.'].filter(Boolean).join('\n\n')
  const created = await api.insertEvent({
    summary: todo.title,
    description,
    start: { dateTime: slot.start.toISOString(), timeZone: TZ },
    end: { dateTime: slot.end.toISOString(), timeZone: TZ },
  })
  // een eerder ingepland blok vervangen we; lukt het opruimen niet, dan blijft de nieuwe afspraak staan
  if (todo.calendarEventId && opts.replace) await api.deleteEvent(todo.calendarEventId).catch(() => undefined)
  const updated = await service.updateTodo(uid, id, { estimateMin: todo.estimateMin ?? minutes })
  const saved = { ...updated, calendarEventId: created.id }
  await service.repo.saveTodo(uid, saved)
  return { todo: saved, eventId: created.id, start: slot.start.toISOString(), end: slot.end.toISOString(), afterDue: todo.due !== null && slot.day > todo.due }
}
