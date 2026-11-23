import { LoginNeeded } from '../errors';
import { expire, getToken, serverSession } from './auth';
import { attachments, bodyHtml, bodyText, header, htmlToText, person, type Attachment, type Header, type Part } from './parse';
import { splitForward, toFilter, toRule, type RawFilter, type Rule, type RuleSpec } from './rules';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gmail<T>(email: string, path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${await getToken(email)}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 401) {
    expire(email);
    // Met een server-sessie haalt getToken stil een nieuw toegangsbewijs; één keer opnieuw proberen.
    if (retry && serverSession(email)) return gmail<T>(email, path, init, false);
    throw new LoginNeeded(email);
  }
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429 || /quota exceeded|rateLimitExceeded/i.test(body))
      throw new Error('Gmail vraagt om even rustiger aan te doen (te veel verzoeken per minuut). Probeer het over een minuut opnieuw.');
    throw new Error(`Gmail ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

interface RawMessage { id: string; labelIds?: string[]; internalDate: string; snippet: string; payload: Part & { headers: Header[] } }

export interface ThreadSummary {
  id: string; who: string; subject: string; snippet: string; date: number; unread: boolean; count: number;
  labels: string[];  // id's van eigen mappen (Gmail-labels van het type "user")
  saved: boolean;    // Opgeslagen = ster in Gmail
  draft: boolean;    // er staat een Gmail-concept in (bijv. door Claude gemaakt)
}
export interface Message {
  id: string; from: string; fromEmail: string; to: string; date: number; me: boolean;
  snippet: string; body: string; attachments: Attachment[];
  html?: string;  // HTML-versie, als die er is (alleen Gmail)
  // ruwe kopregels, nodig om te beantwoorden en door te sturen
  fromRaw: string; replyTo: string; toRaw: string; ccRaw: string; messageId: string; references: string;
}
export interface Thread {
  id: string; subject: string; messages: Message[]; labels: string[];
  inInbox: boolean; inTrash: boolean; inSpam: boolean; saved: boolean;
  draft: GmailDraft | null;  // concept in Gmail, bijv. door Claude via de Gmail-koppeling
}
/** Een concept zoals het in Gmail staat. */
export interface GmailDraft { id: string; to: string; cc: string; bcc: string; subject: string; body: string }
export interface Label { id: string; name: string }

const decodeEntities = (s: string) => new DOMParser().parseFromString(s, 'text/html').documentElement.textContent ?? s;
const first = (name: string) => name.split(/[\s@]/)[0];
const userLabels = (ids: string[]) => ids.filter((l) => l.startsWith('Label_'));

/** Wat de lijst toont: een label (INBOX = Nieuw), alle mail (geen label) en/of een zoekopdracht in Gmail-taal. */
export interface ListQuery { label?: string; q?: string }

// Gmail geeft bij een lijst alleen id's; de details kosten één verzoek per thread en tellen mee
// voor het limiet per minuut. Daarom onthouden we ze per account, met Gmail's historyId:
// verandert er iets aan een thread (nieuw bericht, gelezen, label), dan verandert die ook.
type Cached = Record<string, { h: string; s: ThreadSummary }>;
const CACHE_MAX = 500;
const caches = new Map<string, Cached>();
const cacheKey = (email: string) => `ec.threads.v3.${email}`;  // v3: met saved en draft
function cacheFor(email: string): Cached {
  if (!caches.has(email)) {
    let c: Cached = {};
    try { c = JSON.parse(localStorage.getItem(cacheKey(email)) || '{}') as Cached; } catch { /* leeg beginnen */ }
    caches.set(email, c);
  }
  return caches.get(email)!;
}
function saveCache(email: string) {
  const entries = Object.entries(cacheFor(email)).sort((a, b) => b[1].s.date - a[1].s.date).slice(0, CACHE_MAX);
  caches.set(email, Object.fromEntries(entries));
  try { localStorage.setItem(cacheKey(email), JSON.stringify(caches.get(email))); } catch { /* vol of geblokkeerd */ }
}

/** Bij uitloggen: onthouden threadgegevens van dit account weggooien. */
export function forget(email: string) {
  caches.delete(email);
  try { localStorage.removeItem(cacheKey(email)); } catch { /* geen opslag */ }
}

/** Threads met deelnemers, onderwerp en eigen mappen. */
export async function listThreads(email: string, query: ListQuery, max = 30): Promise<ThreadSummary[]> {
  const p = new URLSearchParams({ maxResults: String(max) });
  if (query.label) p.set('labelIds', query.label);
  if (query.q) p.set('q', query.q);
  if (query.label === 'SPAM' || query.label === 'TRASH') p.set('includeSpamTrash', 'true');
  const { threads = [] } = await gmail<{ threads?: { id: string; snippet: string; historyId: string }[] }>(email, `/threads?${p}`);
  const cache = cacheFor(email);
  const list = await Promise.all(threads.map(async (t): Promise<ThreadSummary> => {
    const hit = cache[t.id];
    if (hit && hit.h === t.historyId) return hit.s;
    const s = await summarize(email, t);
    cache[t.id] = { h: t.historyId, s };
    return s;
  }));
  saveCache(email);
  return list;
}

async function summarize(email: string, t: { id: string; snippet: string }): Promise<ThreadSummary> {
  const th = await gmail<{ messages: RawMessage[] }>(email,
    `/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
  const ms = th.messages;
  const names = [...new Set(ms.map((m) => {
    const p = person(header(m.payload.headers, 'From'));
    return p.email === email ? 'Jij' : p.name;
  }))];
  return {
    id: t.id,
    who: names.length > 1 ? names.map(first).join(', ') : names[0] ?? '',
    subject: header(ms[0].payload.headers, 'Subject') || '(geen onderwerp)',
    snippet: decodeEntities(t.snippet),
    date: Number(ms[ms.length - 1].internalDate),
    unread: ms.some((m) => m.labelIds?.includes('UNREAD')),
    count: ms.length,
    labels: [...new Set(ms.flatMap((m) => userLabels(m.labelIds ?? [])))],
    saved: ms.some((m) => m.labelIds?.includes('STARRED')),
    draft: ms.some((m) => m.labelIds?.includes('DRAFT')),
  };
}

/** Haalt de thread op. Is `id` een bericht-id (zo geeft Claude een mail soms door), dan via dat bericht de thread. */
async function fetchThread(email: string, id: string): Promise<{ id: string; messages: RawMessage[] }> {
  try {
    return await gmail<{ id: string; messages: RawMessage[] }>(email, `/threads/${id}?format=full`);
  } catch (e) {
    let threadId: string | undefined;
    try { threadId = (await gmail<{ threadId?: string }>(email, `/messages/${id}?format=minimal`)).threadId; } catch { /* geen bericht-id */ }
    if (!threadId || threadId === id) throw e;
    return gmail<{ id: string; messages: RawMessage[] }>(email, `/threads/${threadId}?format=full`);
  }
}

export async function getThread(email: string, id: string): Promise<Thread> {
  const th = await fetchThread(email, id);
  const all = th.messages.flatMap((m) => m.labelIds ?? []);
  // Gmail-concept in deze thread: het draft-id staat niet in het bericht, dus via de conceptenlijst.
  const draftMsg = th.messages.filter((m) => m.labelIds?.includes('DRAFT')).at(-1);
  let draft: GmailDraft | null = null;
  if (draftMsg) {
    const { drafts = [] } = await gmail<{ drafts?: { id: string; message: { id: string } }[] }>(email, '/drafts?maxResults=100');
    const d = drafts.find((x) => x.message.id === draftMsg.id);
    const h = draftMsg.payload.headers;
    if (d) draft = { id: d.id, to: header(h, 'To'), cc: header(h, 'Cc'), bcc: header(h, 'Bcc'), subject: header(h, 'Subject'), body: bodyText(draftMsg.payload) };
  }
  const messages = th.messages
    .filter((m) => !m.labelIds?.includes('DRAFT'))
    .map((m) => {
      const h = m.payload.headers;
      const from = person(header(h, 'From'));
      return {
        id: m.id,
        from: from.email === email ? 'Jij' : from.name,
        fromEmail: from.email,
        to: header(h, 'To').split(',').map((x) => person(x).name).filter(Boolean).join(', '),
        date: Number(m.internalDate),
        me: from.email === email,
        snippet: decodeEntities(m.snippet),
        body: bodyText(m.payload),
        html: bodyHtml(m.payload),
        attachments: attachments(m.payload),
        fromRaw: header(h, 'From'),
        replyTo: header(h, 'Reply-To'),
        toRaw: header(h, 'To'),
        ccRaw: header(h, 'Cc'),
        messageId: header(h, 'Message-ID'),
        references: header(h, 'References'),
      };
    });
  return {
    id: th.id,
    subject: header(th.messages[0]?.payload.headers, 'Subject') || '(geen onderwerp)',
    messages,
    labels: [...new Set(userLabels(all))],
    inInbox: all.includes('INBOX'),
    inTrash: all.includes('TRASH'),
    inSpam: all.includes('SPAM'),
    saved: all.includes('STARRED'),
    draft,
  };
}

/** Inhoud van een bijlage als bytes. */
export async function getAttachment(email: string, messageId: string, id: string): Promise<Uint8Array> {
  const { data } = await gmail<{ data: string }>(email, `/messages/${messageId}/attachments/${id}`);
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const modify = (email: string, id: string, add: string[], remove: string[]) =>
  gmail(email, `/threads/${id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });

export const markRead = (email: string, id: string) => modify(email, id, [], ['UNREAD']);
export const markUnread = (email: string, id: string) => modify(email, id, ['UNREAD'], []);
/** Opgeslagen = ster. Gmail zet een nieuw antwoord op een gearchiveerde thread vanzelf terug in Nieuw. */
export const setSaved = (email: string, id: string, on: boolean) => on ? modify(email, id, ['STARRED'], []) : modify(email, id, [], ['STARRED']);
/** Staat de thread in Nieuw? (Nodig voor ongedaan maken: prullenbak en spam halen hem uit Nieuw.) */
export async function inInbox(email: string, id: string) {
  const th = await gmail<{ messages: { labelIds?: string[] }[] }>(email, `/threads/${id}?format=minimal`);
  return th.messages.some((m) => m.labelIds?.includes('INBOX'));
}
/** Naar de prullenbak (Gmail wist na 30 dagen) of terug. Let op: terugzetten zet hem niet terug in Nieuw. */
export const setTrash = (email: string, id: string, on: boolean) =>
  gmail(email, `/threads/${id}/${on ? 'trash' : 'untrash'}`, { method: 'POST' });
/** Spam haalt de thread ook uit Nieuw; "geen spam" zet hem terug in Nieuw. */
export const setSpam = (email: string, id: string, on: boolean) =>
  on ? modify(email, id, ['SPAM'], ['INBOX']) : modify(email, id, ['INBOX'], ['SPAM']);
export const setInInbox = (email: string, id: string, on: boolean) => on ? modify(email, id, ['INBOX'], []) : modify(email, id, [], ['INBOX']);
export const setLabel = (email: string, id: string, label: string, on: boolean) => on ? modify(email, id, [label], []) : modify(email, id, [], [label]);

/** Eigen mappen, alfabetisch. */
export async function listLabels(email: string): Promise<Label[]> {
  const { labels = [] } = await gmail<{ labels?: (Label & { type: string })[] }>(email, '/labels');
  return labels.filter((l) => l.type === 'user').map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

/**
 * Aantal threads per label (systeemlabels zoals INBOX en STARRED, of eigen mappen); bij de labels in `unread`
 * alleen de ongelezen threads. Een label dat faalt telt niet mee.
 */
export async function labelCounts(email: string, ids: string[], unread: string[] = []): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const l = await gmail<{ threadsTotal?: number; threadsUnread?: number }>(email, `/labels/${encodeURIComponent(id)}`);
      out[id] = (unread.includes(id) ? l.threadsUnread : l.threadsTotal) ?? 0;
    } catch { /* overslaan */ }
  }));
  return out;
}

export const createLabel = (email: string, name: string) =>
  gmail<Label>(email, '/labels', { method: 'POST', body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) });

/* ---------- regels = Gmail-filters (werken ook als de app dicht is) ---------- */

export type { Rule, RuleRow, RuleSpec } from './rules';
export { groupRules, parseAddresses, ruleProblem, sameRule, splitForward, toggleAddress } from './rules';

export async function listRules(email: string): Promise<Rule[]> {
  const { filter = [] } = await gmail<{ filter?: RawFilter[] }>(email, '/settings/filters');
  return filter.map(toRule);
}

/** Maakt het Gmail-filter bij een regel. Gmail stuurt alleen door naar adressen die het kent; dat leggen we uit. */
export async function createRule(email: string, spec: RuleSpec): Promise<Rule> {
  try {
    return toRule(await gmail<RawFilter>(email, '/settings/filters', { method: 'POST', body: JSON.stringify(toFilter(spec)) }));
  } catch (e) {
    const msg = (e as Error).message;
    if (/^Gmail 400/.test(msg) && /already exists/i.test(msg)) throw new Error('Deze regel bestaat al.');
    if (spec.forward && /^Gmail 4\d\d/.test(msg) && /forward/i.test(msg))
      throw new Error(`Gmail stuurt alleen door naar een adres dat het kent. Voeg ${spec.forward} eerst toe in Gmail (Instellingen › Doorsturen) en laat de ontvanger bevestigen; daarna kan de regel gemaakt worden.`);
    throw e;
  }
}

/**
 * Maakt een regel uit het formulier. Staan er meer doorstuuradressen in, dan één Gmail-filter per adres
 * (Gmail kent er per filter maar één). Alles of niets: mislukt er één, dan halen we de andere weer weg.
 */
export async function createRules(email: string, parts: RuleSpec[]): Promise<Rule[]> {
  const made: Rule[] = [];
  try {
    for (const part of parts.flatMap(splitForward)) made.push(await createRule(email, part));
    return made;
  } catch (e) {
    await Promise.allSettled(made.map((r) => deleteRule(email, r.id)));
    throw e;
  }
}

/** Adressen waar Gmail naar mag doorsturen: in Gmail toegevoegd en door de ontvanger bevestigd. */
export async function listForwardAddresses(email: string): Promise<string[]> {
  const { forwardingAddresses = [] } = await gmail<{ forwardingAddresses?: { forwardingEmail: string; verificationStatus?: string }[] }>(email, '/settings/forwardingAddresses');
  return forwardingAddresses.filter((a) => a.verificationStatus === 'accepted').map((a) => a.forwardingEmail).sort((a, b) => a.localeCompare(b, 'nl'));
}

/** Verwijdert alleen regels die de app zelf kan beschrijven (de controle zit in de app). */
export async function deleteRule(email: string, id: string) {
  const res = await fetch(`${BASE}/settings/filters/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await getToken(email)}` } });
  if (res.status === 401) { expire(email); throw new LoginNeeded(email); }
  if (!res.ok) throw new Error(`Gmail ${res.status}: regel verwijderen mislukt`);
}

/* ---------- afwezigheidsmelding (Gmail "vacation responder") ---------- */

export interface Vacation {
  enableAutoReply: boolean;
  responseSubject?: string;
  responseBodyPlainText?: string;
  responseBodyHtml?: string;
  restrictToContacts?: boolean;
  restrictToDomain?: boolean;
  startTime?: string;  // ms sinds 1970, als tekst
  endTime?: string;
}

export const getVacation = (email: string) => gmail<Vacation>(email, '/settings/vacation');
export const setVacation = (email: string, v: Vacation) => gmail<Vacation>(email, '/settings/vacation', { method: 'PUT', body: JSON.stringify(v) });

/** Handtekening van het hoofdadres, zoals ingesteld in Gmail. */
export async function getSignature(email: string): Promise<{ html: string; text: string }> {
  const { sendAs = [] } = await gmail<{ sendAs?: { sendAsEmail: string; isPrimary?: boolean; signature?: string }[] }>(email, '/settings/sendAs');
  const html = (sendAs.find((s) => s.sendAsEmail.toLowerCase() === email) ?? sendAs.find((s) => s.isPrimary))?.signature ?? '';
  return { html, text: html ? htmlToText(html) : '' };
}

export interface Outgoing {
  to: string; cc: string; bcc: string; subject: string; text: string; html: string;
  threadId?: string; inReplyTo?: string; references?: string;
  attachments?: OutgoingFile[];
}
/** Bijlage om mee te sturen; data is gewone base64. */
export interface OutgoingFile { name: string; mime: string; size: number; data: string }

/** Gmail weigert berichten boven ±25 MB. */
export const MAX_SEND_BYTES = 25 * 1024 * 1024;

// UTF-8 → base64 zonder btoa-fout op tekens buiten Latin-1.
function b64(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const wrap = (s: string) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const encHeader = (v: string) => /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`;
const oneLine = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

export const deleteDraft = async (email: string, id: string) => {
  const res = await fetch(`${BASE}/drafts/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await getToken(email)}` } });
  if (res.status === 401) { expire(email); throw new LoginNeeded(email); }
  if (!res.ok && res.status !== 404) throw new Error(`Gmail ${res.status}: concept verwijderen mislukt`);
};

/** Concept opnieuw in Gmail zetten (voor ongedaan maken van weggooien). */
export const createDraft = (email: string, m: Outgoing) =>
  gmail<{ id: string; message: { id: string; threadId: string } }>(email, '/drafts', { method: 'POST', body: JSON.stringify({ message: { raw: mime(m), threadId: m.threadId } }) });

export const updateDraft = (email: string, id: string, m: Outgoing) =>
  gmail<{ id: string }>(email, `/drafts/${id}`, { method: 'PUT', body: JSON.stringify({ id, message: { raw: mime(m), threadId: m.threadId } }) });

/**
 * Versturen. Met bijlagen via Gmail's upload-adres (het gewone adres kent een lage limiet);
 * dat neemt het bericht als RFC 2822 met de thread erbij in één multipart-verzoek.
 */
export async function send(email: string, m: Outgoing): Promise<{ id: string; threadId: string }> {
  if (!m.attachments?.length) {
    return gmail(email, '/messages/send', { method: 'POST', body: JSON.stringify({ raw: mime(m), threadId: m.threadId }) });
  }
  const boundary = 'ec-up-' + crypto.randomUUID();
  const body = [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(m.threadId ? { threadId: m.threadId } : {}),
    `--${boundary}`, 'Content-Type: message/rfc822', '', mimeRaw(m),
    `--${boundary}--`, '',
  ].join('\r\n');
  const res = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart', {
    method: 'POST', body,
    headers: { Authorization: `Bearer ${await getToken(email)}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
  });
  if (res.status === 401) { expire(email); throw new LoginNeeded(email); }
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Volledig bericht (RFC 2822), base64url, zoals Gmail het wil hebben. */
export const rawMessage = (m: Outgoing) => mime(m);
const mime = (m: Outgoing) => b64(mimeRaw(m)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function mimeRaw(m: Outgoing) {
  const boundary = 'ec-' + crypto.randomUUID();
  const mixed = m.attachments?.length ? 'ec-mix-' + crypto.randomUUID() : '';
  const head = [
    `To: ${oneLine(m.to)}`,
    m.cc.trim() && `Cc: ${oneLine(m.cc)}`,
    m.bcc.trim() && `Bcc: ${oneLine(m.bcc)}`,
    `Subject: ${encHeader(oneLine(m.subject))}`,
    m.inReplyTo && `In-Reply-To: ${oneLine(m.inReplyTo)}`,
    m.references && `References: ${oneLine(m.references)}`,
    'MIME-Version: 1.0',
    mixed ? `Content-Type: multipart/mixed; boundary="${mixed}"` : `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);
  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap(b64(body))].join('\r\n');
  const alternative = [part('text/plain', m.text), part('text/html', m.html), `--${boundary}--`].join('\r\n');
  if (!mixed) return [...head, '', alternative, ''].join('\r\n');
  const files = m.attachments!.map((f) => {
    const name = encHeader(f.name.replace(/["\r\n]/g, ''));
    return [`--${mixed}`, `Content-Type: ${f.mime || 'application/octet-stream'}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`, 'Content-Transfer-Encoding: base64', '', wrap(f.data)].join('\r\n');
  });
  return [...head, '', `--${mixed}`, `Content-Type: multipart/alternative; boundary="${boundary}"`, '', alternative,
    ...files, `--${mixed}--`, ''].join('\r\n');
}
