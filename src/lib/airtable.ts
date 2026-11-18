// Airtable-links herkennen. Een link naar een record ziet eruit als
//   https://airtable.com/app…/tbl…/viw…/rec…?blocks=hide
// of, bij een interface, https://airtable.com/app…/pag…/rec…
// (voorvoegsels uit https://support.airtable.com/docs/finding-airtable-ids).

export interface AirtableRef {
  /** De link zoals geplakt, zonder tekst eromheen. */
  url: string
  baseId: string
  tableId: string | null
  recordId: string
}

const URL_RE = /https?:\/\/(?:www\.)?airtable\.com\/[^\s<>"')]+/i
const ID = (prefix: string) => new RegExp(`^${prefix}[A-Za-z0-9]{10,}$`)

/** Leest één Airtable-recordlink. Geeft null als het geen link naar een record is. */
export function parseAirtableUrl(raw: string): AirtableRef | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (!/^(www\.)?airtable\.com$/i.test(u.hostname)) return null
  const parts = u.pathname.split('/').filter(Boolean)
  const baseId = parts.find((p) => ID('app').test(p))
  const recordId = parts.find((p) => ID('rec').test(p))
  if (!baseId || !recordId) return null
  const tableId = parts.find((p) => ID('tbl').test(p)) ?? null
  return { url: u.toString(), baseId, tableId, recordId }
}

/** Zoekt een Airtable-recordlink in een stuk tekst (een geplakte zin). */
export function findAirtableUrl(text: string): { ref: AirtableRef; rest: string } | null {
  const m = URL_RE.exec(text)
  if (!m) return null
  const ref = parseAirtableUrl(m[0])
  if (!ref) return null
  const rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim()
  return { ref, rest }
}
