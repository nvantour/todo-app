// Regels = Gmail-filters. Hier alleen het vertalen tussen een Gmail-filter en de vorm die de app
// zelf kan tonen, maken en verwijderen. Geen netwerk, zodat het los te testen is.

/**
 * Een regel die de app zelf kan beschrijven: voorwaarden die allemaal moeten kloppen
 * (wat leeg is telt niet mee) en wat er dan met de mail gebeurt.
 */
export interface RuleSpec {
  from?: string;       // afzender bevat
  subject?: string;    // onderwerp bevat
  body?: string;       // bericht bevat (Gmail: "bevat de woorden", zelfde taal als het zoekveld)
  label?: string;      // naar deze map (id van een eigen Gmail-label)
  forward?: string;    // doorsturen naar dit adres
  skipInbox: boolean;  // niet in Nieuw
}

export interface Rule {
  id: string;
  /** Alleen gezet als de app het filter volledig kan beschrijven (en dus mag verwijderen); anders null. */
  simple: RuleSpec | null;
  /** Leesbare omschrijving voor andere Gmail-filters. */
  summary: string;
}

export interface RawFilter {
  id: string;
  criteria?: Record<string, string | number | boolean>;
  action?: { addLabelIds?: string[]; removeLabelIds?: string[]; forward?: string };
}

const CRITERIA: Record<string, 'from' | 'subject' | 'body'> = { from: 'from', subject: 'subject', query: 'body' };
const ACTIONS = ['addLabelIds', 'removeLabelIds', 'forward'];
const NAMES: Record<string, string> = { from: 'afzender', to: 'aan', subject: 'onderwerp', query: 'bevat', negatedQuery: 'bevat niet' };

export function toRule(f: RawFilter): Rule {
  const c = f.criteria ?? {}, a = f.action ?? {};
  const keys = Object.keys(c), add = a.addLabelIds ?? [], remove = a.removeLabelIds ?? [];
  // Alleen afzender/onderwerp/bericht als voorwaarde, en als actie hooguit één eigen map, doorsturen en "niet in Nieuw".
  const knownCriteria = keys.length > 0 && keys.every((k) => k in CRITERIA && typeof c[k] === 'string' && String(c[k]).trim() !== '');
  const label = add.length === 1 && add[0].startsWith('Label_') ? add[0] : undefined;
  const knownAction = Object.keys(a).every((k) => ACTIONS.includes(k))
    && add.length === (label ? 1 : 0) && remove.every((l) => l === 'INBOX') && !!(label || a.forward);
  let simple: RuleSpec | null = null;
  if (knownCriteria && knownAction) {
    simple = { skipInbox: remove.includes('INBOX') };
    for (const k of keys) simple[CRITERIA[k]] = String(c[k]);
    if (label) simple.label = label;
    if (a.forward) simple.forward = a.forward;
  }
  const parts = [
    ...keys.map((k) => `${NAMES[k] ?? k}: ${c[k]}`),
    a.forward && `doorsturen naar ${a.forward}`,
    remove.includes('INBOX') && 'niet in inbox',
    add.length && `labels: ${add.join(', ')}`,
  ].filter(Boolean);
  return { id: f.id, simple, summary: parts.join(' · ') };
}

/** Het Gmail-filter dat bij een regel hoort. Lege voorwaarden gaan niet mee. */
export function toFilter(s: RuleSpec): Omit<RawFilter, 'id'> {
  const criteria: Record<string, string> = {};
  if (s.from?.trim()) criteria.from = s.from.trim();
  if (s.subject?.trim()) criteria.subject = s.subject.trim();
  if (s.body?.trim()) criteria.query = s.body.trim();
  const action: NonNullable<RawFilter['action']> = {};
  if (s.label) action.addLabelIds = [s.label];
  if (s.skipInbox) action.removeLabelIds = ['INBOX'];
  if (s.forward?.trim()) action.forward = s.forward.trim();
  return { criteria, action };
}

/** Wat er nog mis is met een regel; null als hij gemaakt kan worden. */
export function ruleProblem(s: RuleSpec): { field: 'from' | 'label' | 'forward'; message: string } | null {
  if (!s.from?.trim() && !s.subject?.trim() && !s.body?.trim())
    return { field: 'from', message: 'Vul in waar de regel op let: afzender, onderwerp of bericht' };
  if (s.forward !== undefined) {
    if (!s.forward.trim()) return { field: 'forward', message: 'Vul het adres in waar de mail naartoe moet' };
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s.forward.trim())) return { field: 'forward', message: 'Dat is geen geldig e-mailadres' };
  } else if (!s.label) return { field: 'label', message: 'Kies een map' };
  return null;
}
