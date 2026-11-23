import { runCalendarScan, type PrepJudge } from './calendarScan'
import { runReplyScan } from './replyScan'
import type { GoogleService } from './google'
import type { PushService } from './push'
import type { Repo } from './repo'
import type { TodoService } from './service'

export interface JobDeps {
  repo: Repo
  service: TodoService
  google: GoogleService
  prepJudge: PrepJudge | null
  push: PushService
  onError?: (e: unknown) => void
}

/** Voert iets uit voor elke gebruiker met een werkende Google-koppeling; een fout bij de één stopt de rest niet. */
async function forConnected(deps: JobDeps, fn: (uid: string) => Promise<unknown>): Promise<number> {
  let n = 0
  for (const c of await deps.repo.listGoogle()) {
    if (c.needsReauth) continue
    try {
      await fn(c.uid)
      n++
    } catch (e) {
      deps.onError?.(e)
    }
  }
  return n
}

export const calendarScanAll = (d: JobDeps) =>
  forConnected(d, (uid) => runCalendarScan({ repo: d.repo, service: d.service, google: d.google, ai: d.prepJudge, onError: d.onError }, uid))

export const chatScanAll = (d: JobDeps) =>
  forConnected(d, (uid) => runReplyScan({ repo: d.repo, service: d.service, google: d.google, ai: null, onError: d.onError }, uid))

async function forDevices(d: JobDeps, fn: (uid: string) => Promise<unknown>) {
  for (const uid of await d.push.usersWithDevices()) {
    try {
      await fn(uid)
    } catch (e) {
      d.onError?.(e)
    }
  }
}

export const morningPushAll = (d: JobDeps) => forDevices(d, (uid) => d.push.morning(uid))
export const dueNowPushAll = (d: JobDeps) => forDevices(d, (uid) => d.push.dueNow(uid))
