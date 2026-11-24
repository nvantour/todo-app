// Adressen aanvullen: "eda" typen → Eda's volledige adres. Het adresboek komt uit je eigen mail
// (mensen die je mailde tellen zwaarder dan mensen die jou mailden, recent zwaarder dan lang geleden).

export interface Contact { name: string; email: string; score: number }
export interface ContactRow { from: string; to: string; cc: string; date: number; sent: boolean }

const DAY = 86_400_000;
/** Afzenders waar je nooit naar terugschrijft. */
const ROBOT = /(^|[._-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounce[s]?|calendar-notification)([._+-]|@)/i;

/** "Naam <adres>" of los adres → { name, email }. */
export function parsePerson(v: string): { name: string; email: string } | null {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(v);
  const email = (m ? m[2] : v).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = (m?.[1] ?? '').trim();
  return { name: name && name.toLowerCase() !== email ? name : '', email };
}

/** Komma's buiten aanhalingstekens. */
function split(v: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (const ch of v) {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function buildContacts(rows: ContactRow[], me: string, now = Date.now()): Contact[] {
  const map = new Map<string, Contact>();
  const add = (raw: string, weight: number, date: number) => {
    const p = parsePerson(raw);
    if (!p || p.email === me.toLowerCase() || ROBOT.test(p.email)) return;
    const recent = now - date < 30 * DAY ? 2 : now - date < 120 * DAY ? 1.4 : 1;
    const c = map.get(p.email) ?? { name: '', email: p.email, score: 0 };
    c.score += weight * recent;
    if (p.name && !c.name) c.name = p.name;
    map.set(p.email, c);
  };
  for (const r of rows) {
    if (r.sent) for (const a of [...split(r.to), ...split(r.cc)]) add(a, 3, r.date);
    else add(r.from, 1, r.date);
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Beste treffers voor wat je typt; adressen die al in het veld staan vallen af. */
export function matchContacts(list: Contact[], query: string, exclude: Set<string> = new Set(), max = 6): Contact[] {
  const q = norm(query.trim());
  if (!q) return [];
  const hits: { c: Contact; rank: number }[] = [];
  for (const c of list) {
    if (exclude.has(c.email)) continue;
    const name = norm(c.name), email = c.email, local = email.split('@')[0];
    let rank = -1;
    if (name.startsWith(q) || email.startsWith(q)) rank = 0;
    else if (name.split(/[\s.,'-]+/).some((w) => w.startsWith(q)) || local.split(/[._-]+/).some((w) => w.startsWith(q))) rank = 1;
    else if (q.length >= 3 && (name.includes(q) || email.includes(q))) rank = 2;
    if (rank >= 0) hits.push({ c, rank });
  }
  return hits.sort((a, b) => a.rank - b.rank || b.c.score - a.c.score).slice(0, max).map((h) => h.c);
}

/** Het adres waar de cursor in staat: van de vorige komma tot de cursor. */
export function tokenAt(value: string, caret: number): { start: number; end: number; text: string } {
  let start = caret, quoted = false;
  for (let i = 0; i < caret; i++) if (value[i] === '"') quoted = !quoted;
  while (start > 0) {
    const ch = value[start - 1];
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) break;
    start--;
  }
  let end = caret;
  while (end < value.length && value[end] !== ',') end++;
  const text = value.slice(start, caret).trimStart();
  return { start: caret - text.length, end, text };
}

export const formatContact = (c: { name: string; email: string }) =>
  !c.name ? c.email : /[",;<>@()]/.test(c.name) ? `"${c.name.replace(/"/g, '')}" <${c.email}>` : `${c.name} <${c.email}>`;

/** Het getypte stuk vervangen door het gekozen adres, met een komma erachter voor het volgende. */
export function insertContact(value: string, caret: number, c: Contact): { value: string; caret: number } {
  const t = tokenAt(value, caret);
  const before = value.slice(0, t.start).replace(/\s*$/, '');
  const after = value.slice(t.end).replace(/^,?\s*/, '');
  const head = (before ? `${before} ` : '') + `${formatContact(c)}, `;
  return { value: head + after, caret: head.length };
}

/** Adressen die al in een veld staan. */
export const addressesIn = (value: string) => new Set(split(value).map((a) => parsePerson(a)?.email).filter((e): e is string => !!e));
