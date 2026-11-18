// Een Airtable-link omzetten naar de naam van het record en de base.
// Bronnen:
//   https://airtable.com/developers/web/api/get-record        (GET /v0/{baseId}/{tableIdOrName}/{recordId}, scope data.records:read)
//   https://airtable.com/developers/web/api/get-base-schema   (GET /v0/meta/bases/{baseId}/tables, scope schema.bases:read)
//   https://airtable.com/developers/web/api/list-bases        (GET /v0/meta/bases, scope schema.bases:read)
import { parseAirtableUrl } from '../../src/lib/airtable'
import { HttpError, badRequest } from './errors'
import type { Fetch } from './googleAuth'

export interface AirtableResolved {
  url: string
  baseId: string
  baseName: string | null
  tableId: string | null
  recordId: string
  recordName: string | null
  /** Leesbare bron: "Recordnaam (Basenaam)". */
  label: string
}

const API = 'https://api.airtable.com/v0'

/** Een celwaarde als korte tekst; Airtable geeft ook lijsten en objecten terug. */
export function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(cellText).filter(Boolean).join(', ') || null
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return cellText(o.name ?? o.text ?? o.value ?? o.email)
  }
  return null
}

export function buildLabel(recordName: string | null, baseName: string | null): string {
  if (recordName && baseName) return `${recordName} (${baseName})`
  return recordName ?? (baseName ? `Airtable-record in ${baseName}` : 'Airtable-record')
}

export async function resolveAirtable(url: string, token: string, fetchImpl: Fetch = fetch): Promise<AirtableResolved> {
  const ref = parseAirtableUrl(url)
  if (!ref) throw badRequest('Dit is geen link naar een Airtable-record.', 'bad_airtable_url')
  const headers = { Authorization: `Bearer ${token}` }

  async function get<T>(path: string): Promise<T | null> {
    const res = await fetchImpl(`${API}${path}`, { headers })
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'airtable_forbidden', 'Airtable weigerde de toegang. Controleer de rechten van het token (data.records:read en schema.bases:read) en of de base erbij zit.')
    if (res.status === 404) return null
    if (!res.ok) throw new HttpError(502, 'airtable_unavailable', `Airtable gaf een fout (${res.status}).`)
    return (await res.json()) as T
  }

  // naam van de base (alleen wat het token mag zien)
  let baseName: string | null = null
  try {
    let offset: string | undefined
    for (let i = 0; i < 5 && baseName === null; i++) {
      const page = await get<{ bases: { id: string; name: string }[]; offset?: string }>(`/meta/bases${offset ? `?offset=${encodeURIComponent(offset)}` : ''}`)
      baseName = page?.bases.find((b) => b.id === ref.baseId)?.name ?? null
      offset = page?.offset
      if (!offset) break
    }
  } catch (e) {
    if (!(e instanceof HttpError) || e.code !== 'airtable_forbidden') throw e
    // zonder schema-rechten blijft de basenaam leeg; het record zelf proberen we toch
  }

  // het record en de naam van het eerste veld (de "primaire" kolom)
  let tables: { id: string; primaryFieldId: string }[] = []
  try {
    tables = (await get<{ tables: { id: string; primaryFieldId: string }[] }>(`/meta/bases/${ref.baseId}/tables`))?.tables ?? []
  } catch (e) {
    if (!(e instanceof HttpError) || e.code !== 'airtable_forbidden') throw e
  }
  // Staat er geen tabel in de link, dan werkt het record-adres ook met een andere tabel van de base:
  // Airtable zoekt het record dan in de hele base (zie de documentatie van get-record).
  const tableForCall = ref.tableId ?? tables[0]?.id
  let recordName: string | null = null
  let tableId = ref.tableId
  if (tableForCall) {
    const rec = await get<{ id: string; fields: Record<string, unknown> }>(`/${ref.baseId}/${tableForCall}/${ref.recordId}?returnFieldsByFieldId=true`)
    if (!rec) throw new HttpError(404, 'not_found', 'Dit Airtable-record is niet gevonden (of het token heeft er geen toegang toe).')
    const table = tables.find((t) => t.id === tableId) ?? tables.find((t) => t.primaryFieldId in rec.fields) ?? tables.find((t) => t.id === tableForCall)
    if (table) {
      tableId = table.id
      recordName = cellText(rec.fields[table.primaryFieldId])
    }
  }

  return { url: ref.url, baseId: ref.baseId, baseName, tableId, recordId: ref.recordId, recordName, label: buildLabel(recordName, baseName) }
}
