import type { Bucket, Project, Recurrence } from '../model/types'
import { todayISO } from '../lib/dates'
import { parseQuickAdd } from '../lib/parse'
import { getIdToken } from '../data/session'
import { apiBase } from './capabilities'
import { splitSpeech } from './splitSpeech'

/** Eén herkende taak in het lijstje, nog te bewerken voor het toevoegen. */
export interface Draft {
  key: string
  title: string
  due: string | null
  dueTime: string | null
  recurrence: Recurrence | null
  projectId: string | null
  bucket: Bucket
}

export interface Analysis {
  drafts: Draft[]
  /** 'server' = AI, 'lokaal' = vaste regels (geen verbinding of geen server). */
  via: 'server' | 'lokaal'
}

const key = () => crypto.randomUUID()

/** Lokale route: eerst splitsen, dan de vaste parser per stuk. Werkt zonder verbinding. */
export function analyseLocal(text: string, projects: Project[], today = todayISO()): Draft[] {
  return splitSpeech(text).map((piece) => {
    const p = parseQuickAdd(piece, projects, today)
    return {
      key: key(),
      title: p.title || piece,
      due: p.due,
      dueTime: p.dueTime,
      recurrence: p.recurrence,
      projectId: p.projectId,
      bucket: 'now' as Bucket,
    }
  })
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

function fromServer(raw: unknown, projects: Project[]): Draft[] {
  const list = (raw as { todos?: unknown })?.todos
  if (!Array.isArray(list)) throw new Error('onverwacht antwoord')
  const known = new Set(projects.map((p) => p.id))
  return list
    .map((t): Draft | null => {
      const o = t as Record<string, unknown>
      if (!isString(o.title)) return null
      return {
        key: key(),
        title: o.title.trim(),
        due: isString(o.due) ? o.due : null,
        dueTime: isString(o.dueTime) ? o.dueTime : null,
        recurrence: (o.recurrence as Recurrence | null | undefined) ?? null,
        projectId: isString(o.projectId) && known.has(o.projectId) ? o.projectId : null,
        bucket: o.bucket === 'later' ? 'later' : 'now',
      }
    })
    .filter((d): d is Draft => d !== null)
}

/**
 * Splitsen en herkennen: eerst de server (AI, `dryRun` bewaart niets),
 * en bij geen server, geen verbinding of een fout de lokale route.
 */
export async function analyse(text: string, projects: Project[], today = todayISO()): Promise<Analysis> {
  const base = apiBase()
  if (base && navigator.onLine !== false) {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), 12_000)
    try {
      const token = await getIdToken()
      if (token) {
        const res = await fetch(`${base}/capture`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, dryRun: true, source: { type: 'voice' } }),
          signal: ctrl.signal,
        })
        if (res.ok) {
          const drafts = fromServer(await res.json(), projects)
          if (drafts.length) return { drafts, via: 'server' }
        }
      }
    } catch {
      /* val terug op de lokale route */
    } finally {
      window.clearTimeout(timer)
    }
  }
  return { drafts: analyseLocal(text, projects, today), via: 'lokaal' }
}
