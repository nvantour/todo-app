import type { Todo } from '../../src/model/types'
import { buildBrief } from './brief'
import type { PushDevice, Repo } from './repo'
import type { TodoService } from './service'
import { hashToken } from './tokens'

export interface PushPayload {
  title: string
  body: string
  /** Waar een tik op de melding naartoe gaat (pad in de app). */
  url: string
  /** Meldingen met dezelfde tag vervangen elkaar op het apparaat. */
  tag: string
}

export interface SendOutcome {
  /** Tokens die niet meer bestaan en opgeruimd moeten worden. */
  invalid: string[]
  sent: number
}

/** Verstuurt één melding naar een rij apparaten. De echte versie (FCM) staat in fcm.ts; tests gebruiken een nep. */
export type PushSender = (tokens: string[], payload: PushPayload) => Promise<SendOutcome>

/** Een taak met tijd krijgt een melding zodra de tijd is aangebroken, tot dit aantal minuten te laat (de scheduler kan haperen). */
export const LATE_MINUTES = 30
const KEEP_NOTIFIED_MS = 2 * 86_400_000

const hhmm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/** Past de FCM-fouten toe: welke tokens zijn dood? Een "ongeldig argument" telt alleen als de rest van de groep wel lukte. */
export function deadTokens(tokens: string[], results: { success: boolean; code?: string }[]): string[] {
  const someOk = results.some((r) => r.success)
  return tokens.filter((_, i) => {
    const code = results[i]?.code
    if (!code) return false
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') return true
    return code === 'messaging/invalid-argument' && someOk
  })
}

export function notifiedKey(t: Pick<Todo, 'id' | 'due' | 'dueTime'>): string {
  return `${t.id}|${t.due}|${t.dueTime}`
}

export class PushService {
  constructor(
    private repo: Repo,
    private service: TodoService,
    private sender: PushSender,
  ) {}

  async register(uid: string, token: string, label: string): Promise<PushDevice> {
    const now = this.service.stamp()
    const id = hashToken(token).slice(0, 16)
    const existing = (await this.repo.listDevices(uid)).find((d) => d.id === id)
    const device: PushDevice = { id, uid, token, label: label.slice(0, 80), createdAt: existing?.createdAt ?? now, lastSeenAt: now }
    await this.repo.saveDevice(device)
    return device
  }

  async unregister(uid: string, id: string): Promise<boolean> {
    const mine = (await this.repo.listDevices(uid)).find((d) => d.id === id)
    if (!mine) return false
    await this.repo.deleteDevice(id)
    return true
  }

  /** Stuurt naar alle apparaten van de gebruiker en ruimt ongeldige tokens op. Geeft het aantal bereikte apparaten. */
  async sendToUser(uid: string, payload: PushPayload): Promise<number> {
    const devices = await this.repo.listDevices(uid)
    if (!devices.length) return 0
    const out = await this.sender(devices.map((d) => d.token), payload)
    for (const d of devices) if (out.invalid.includes(d.token)) await this.repo.deleteDevice(d.id)
    return out.sent
  }

  /** 's Ochtends één melding met wat vandaag moet. Per dag maar één keer, ook als de scheduler opnieuw start. */
  async morning(uid: string): Promise<boolean> {
    const today = this.service.today()
    const state = await this.repo.getState(uid)
    if (state.morningPushDay === today) return false
    if (!(await this.repo.listDevices(uid)).length) return false
    // eerst onthouden, dan versturen: liever een gemiste melding dan twee
    await this.repo.saveState(uid, { morningPushDay: today })
    const brief = await buildBrief(this.service, uid)
    const list = [...brief.overdue, ...brief.today]
    if (!list.length) return false
    const names = list.slice(0, 3).map((t) => t.title)
    const more = list.length - names.length
    const overdue = brief.overdue.length
    await this.sendToUser(uid, {
      title: list.length === 1 ? 'Vandaag: 1 taak' : `Vandaag: ${list.length} taken`,
      body: names.join(' · ') + (more > 0 ? ` en ${more} meer` : '') + (overdue ? ` (${overdue} achterstallig)` : ''),
      url: '/taken',
      tag: `ochtend-${today}`,
    })
    return true
  }

  /** Meldingen voor taken waarvan de tijd nu is aangebroken. Elke taak-tijd maar één keer. */
  async dueNow(uid: string): Promise<number> {
    const now = new Date(this.service.stamp())
    const today = this.service.today()
    if (!(await this.repo.listDevices(uid)).length) return 0
    const todos = (await this.repo.listTodosDueOn(uid, today)).filter((t) => t.dueTime)
    if (!todos.length) return 0
    const state = await this.repo.getState(uid)
    const notified = { ...(state.notified ?? {}) }
    const nowMin = minutes(hhmm(now))
    const due = todos.filter((t) => {
      const diff = nowMin - minutes(t.dueTime!)
      return diff >= 0 && diff <= LATE_MINUTES && !notified[notifiedKey(t)]
    })
    for (const [k, at] of Object.entries(notified)) if (now.getTime() - Date.parse(at) > KEEP_NOTIFIED_MS) delete notified[k]
    if (!due.length) {
      if (Object.keys(notified).length !== Object.keys(state.notified ?? {}).length) await this.repo.saveState(uid, { notified })
      return 0
    }
    for (const t of due) notified[notifiedKey(t)] = now.toISOString()
    await this.repo.saveState(uid, { notified }) // eerst vastleggen, dan versturen
    for (const t of due) {
      await this.sendToUser(uid, { title: `${t.dueTime} · ${t.title}`, body: 'Deze taak staat nu gepland.', url: '/taken', tag: notifiedKey(t) })
    }
    return due.length
  }

  /** Voor de geplande functies: alle gebruikers met minstens één apparaat. */
  async usersWithDevices(): Promise<string[]> {
    return [...new Set((await this.repo.listAllDevices()).map((d) => d.uid))]
  }
}
