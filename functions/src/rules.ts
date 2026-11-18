import type { CalendarRule } from '../../src/model/types'
import { subtractWorkdays } from '../../src/lib/dates'
import type { Repo } from './repo'

/** Zelfde standaardregel als in de voorbeelddata van de app. */
export const DEFAULT_RULE: CalendarRule = { id: 'qbr', match: 'QBR', titleTemplate: '{titel} voorbereiden', workdaysBefore: 3, enabled: true }

/**
 * Maakt de standaardregel één keer aan. Daarna blijft de lijst van de gebruiker leidend:
 * wie de regel verwijdert, krijgt hem niet terug (dat onthouden we in `serverState`).
 */
export async function ensureDefaultRules(repo: Repo, uid: string): Promise<void> {
  const state = await repo.getState(uid)
  if (state.rulesSeeded) return
  const existing = await repo.listCalendarRules(uid)
  if (existing.length === 0) await repo.saveCalendarRule(uid, DEFAULT_RULE)
  await repo.saveState(uid, { rulesSeeded: true })
}

export interface RuleHit {
  rule: CalendarRule
  title: string
  /** Dag waarop de voorbereiding klaar moet zijn (YYYY-MM-DD). */
  due: string
}

/** Past de regels toe op de titel van één afspraak. Hoofdletters maken niet uit; een leeg woord telt niet. */
export function applyRules(rules: CalendarRule[], eventTitle: string, eventDay: string, today: string): RuleHit[] {
  const lower = eventTitle.toLowerCase()
  const hits: RuleHit[] = []
  for (const rule of rules) {
    const word = rule.match.trim().toLowerCase()
    if (!rule.enabled || !word || !lower.includes(word)) continue
    // een afspraak die al over minder werkdagen is dan de regel vraagt: vandaag beginnen
    const due = [subtractWorkdays(eventDay, rule.workdaysBefore), today].sort().reverse()[0]
    hits.push({ rule, title: rule.titleTemplate.split('{titel}').join(eventTitle).trim() || eventTitle, due })
  }
  return hits
}
