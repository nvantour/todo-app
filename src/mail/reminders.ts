// Herinneringen als afspraak in de eigen Google-agenda (sinds 2026-11-18; daarvoor localStorage).
// Daardoor: melding op iPhone en Mac ook als de app dicht is, overal dezelfde herinneringen,
// en Claude kan er via zijn agenda-koppeling ook een zetten. De app zet de thread bij afgaan
// terug in Nieuw. Afspraken staan op "vrij" en "privé", zodat collega's niets zien of merken.
//
// Herkenning: de regel "Email-Client thread: <id>" in de beschrijving. Die regel is genoeg;
// een afspraak die Claude zo aanmaakt, telt dus ook als herinnering.

import { LoginNeeded } from './errors';
import { expire, getToken } from './gmail/auth';

export interface Reminder {
  id: string;          // id van de agenda-afspraak
  account: string; threadId: string; at: number;
  subject: string; who: string;
  fired: boolean;      // afgegaan: thread staat weer in Nieuw met een geel label, tot Klaar
}

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const MARK = 'Email-Client thread:';  // naam van de vroegere losse app; niet wijzigen, bestaande herinneringen worden hierop gevonden
const cache = new Map<string, Reminder[]>();  // per account

async function cal<T>(email: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${await getToken(email)}`, 'Content-Type': 'application/json' } });
  // 403 = nog geen toestemming voor de agenda (nieuw sinds 2026-11-18): opnieuw inloggen vraagt die erbij.
  if (res.status === 401 || res.status === 403) { expire(email); throw new LoginNeeded(email); }
  if (!res.ok) throw new Error(`Agenda ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (res.status === 204 ? null : res.json()) as Promise<T>;
}

interface Event {
  id: string; summary?: string; description?: string; start?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

function toReminder(account: string, e: Event): Reminder | null {
  const threadId = e.extendedProperties?.private?.ecThread ?? new RegExp(`${MARK}\\s*([0-9a-f]+)`, 'i').exec(e.description ?? '')?.[1];
  const when = e.start?.dateTime ?? e.start?.date;
  if (!threadId || !when || e.extendedProperties?.private?.ecDone === '1') return null;
  return {
    id: e.id, account, threadId, at: Date.parse(when),
    subject: (e.summary ?? '').replace(/^Herinnering:\s*/, '') || '(geen onderwerp)',
    who: e.extendedProperties?.private?.ecWho ?? '',
    fired: e.extendedProperties?.private?.ecFired === '1',
  };
}

/** Herinneringen van de afgelopen 60 dagen en later ophalen (afgehandelde tellen niet mee). */
export async function load(account: string) {
  const p = new URLSearchParams({
    q: MARK, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
    timeMin: new Date(Date.now() - 60 * 864e5).toISOString(),
  });
  const { items = [] } = await cal<{ items?: Event[] }>(account, `?${p}`);
  cache.set(account, items.map((e) => toReminder(account, e)).filter((r): r is Reminder => !!r));
  await migrateLocal(account);
}

export const forAccount = (account: string) => [...(cache.get(account) ?? [])].sort((a, b) => a.at - b.at);
export const get = (account: string, threadId: string) => cache.get(account)?.find((r) => r.threadId === threadId);
export const due = (account: string, now = Date.now()) => forAccount(account).filter((r) => !r.fired && r.at <= now);

/** Nieuwe herinnering (vervangt een bestaande op dezelfde thread). */
export async function set(account: string, threadId: string, at: number, subject: string, who: string) {
  const old = get(account, threadId);
  if (old) await remove(account, threadId);
  const link = `${location.origin}/#mail-${encodeURIComponent(threadId)}`;
  const e = await cal<Event>(account, '', {
    method: 'POST',
    body: JSON.stringify({
      summary: `Herinnering: ${subject}`,
      description: [...(who ? [`Van/aan: ${who}`] : []), `Open in Mail: ${link}`, `Open in Gmail: https://mail.google.com/mail/u/0/#all/${threadId}`, '', `${MARK} ${threadId}`].join('\n'),
      start: { dateTime: new Date(at).toISOString() },
      end: { dateTime: new Date(at + 5 * 60_000).toISOString() },
      transparency: 'transparent',   // telt niet als bezet
      visibility: 'private',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
      extendedProperties: { private: { ec: 'reminder', ecThread: threadId, ecWho: who } },
    }),
  });
  const r = toReminder(account, e)!;
  cache.set(account, [...(cache.get(account) ?? []).filter((x) => x.threadId !== threadId), r]);
  return r;
}

export async function remove(account: string, threadId: string) {
  const r = get(account, threadId);
  if (!r) return;
  await cal(account, `/${r.id}`, { method: 'DELETE' }).catch((e) => { if (!/ 410| 404/.test(String(e))) throw e; });
  cache.set(account, (cache.get(account) ?? []).filter((x) => x.threadId !== threadId));
}

const patchPrivate = (account: string, id: string, props: Record<string, string>) =>
  cal(account, `/${id}`, { method: 'PATCH', body: JSON.stringify({ extendedProperties: { private: props } }) });

export async function markFired(account: string, threadId: string) {
  const r = get(account, threadId);
  if (!r) return;
  await patchPrivate(account, r.id, { ecFired: '1' });
  r.fired = true;
}

/** Na Klaar: afgegane herinnering is afgehandeld. De afspraak blijft in de agenda als geschiedenis. */
export async function markDone(account: string, threadId: string) {
  const r = get(account, threadId);
  if (!r) return;
  await patchPrivate(account, r.id, { ecDone: '1' });
  cache.set(account, (cache.get(account) ?? []).filter((x) => x.threadId !== threadId));
}

/** Eenmalig: herinneringen uit de oude browseropslag naar de agenda. */
async function migrateLocal(account: string) {
  let old: { account: string; threadId: string; at: number; subject: string; who: string; fired?: boolean }[] = [];
  try { old = JSON.parse(localStorage.getItem('ec.reminders') || '[]'); } catch { return; }
  const mine = old.filter((r) => r.account === account && !r.fired && r.at > Date.now());
  for (const r of mine) await set(account, r.threadId, r.at, r.subject, r.who);
  try {
    const rest = old.filter((r) => r.account !== account);
    if (rest.length) localStorage.setItem('ec.reminders', JSON.stringify(rest)); else localStorage.removeItem('ec.reminders');
  } catch { /* geen opslag */ }
}

/* ---------- tijdstippen ---------- */

const at = (d: Date, h: number, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.getTime(); };
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

/** Snelle keuzes in een thread, zoals in Slack. */
export function threadPresets(): { label: string; at: number }[] {
  const now = new Date();
  const monday = addDays(((8 - now.getDay()) % 7) || 7);
  return [
    { label: 'Over 1 uur', at: Date.now() + 3600_000 },
    ...(now.getHours() < 17 ? [{ label: 'Vanavond 18:00', at: at(now, 18) }] : []),
    { label: 'Morgen 09:00', at: at(addDays(1), 9) },
    { label: 'Maandag 09:00', at: at(monday, 9) },
  ];
}

/** Keuzes na verzenden: tijd om te zien of er gereageerd is. */
export const SEND_PRESETS: Record<string, () => number> = {
  'Morgen 09:00': () => at(addDays(1), 9),
  'Over 3 dagen': () => at(addDays(3), 9),
  'Over een week': () => at(addDays(7), 9),
};

/** "morgen 09:00", "ma 23 nov 09:00" */
export function fmt(ms: number) {
  const d = new Date(ms), now = new Date();
  const time = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `vandaag ${time}`;
  if (d.toDateString() === addDays(1).toDateString()) return `morgen ${time}`;
  return `${d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}
