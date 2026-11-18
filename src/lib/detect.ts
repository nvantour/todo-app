import type { Project } from '../model/types'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Herkent de klant in vrije tekst (taak, titel van een agenda-afspraak,
 * naam van een Airtable-base, onderwerp van een mail) aan de hand van de
 * trefwoorden van elke klant. Geeft het id van de klant terug, of null.
 */
export function detectProject(text: string, projects: Project[]): string | null {
  const haystack = text.toLowerCase()
  let best: { id: string; length: number } | null = null
  for (const project of projects) {
    if (project.archived) continue
    for (const keyword of project.keywords) {
      const k = keyword.trim().toLowerCase()
      if (!k) continue
      // hele woorden, zodat "rai" niet matcht in "trainen"
      const hit = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(k)}($|[^\\p{L}\\p{N}])`, 'u').test(haystack)
      if (hit && (!best || k.length > best.length)) best = { id: project.id, length: k.length }
    }
  }
  return best?.id ?? null
}
