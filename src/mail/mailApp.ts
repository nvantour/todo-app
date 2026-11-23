// De mailclient (eerder de losse app "Email-Client"), nu als tab in het werk-OS.
// Draait in een eigen Shadow DOM (zie MailView): eigen stijlen, eigen ids, niets lekt naar de todo-app.
// mountMail() tekent de mail in een host-element en geeft een functie terug om weer op te ruimen;
// de toestand (S) blijft bewaard, dus terug naar de Mail-tab = verder waar je was.
import css from './mail.css?inline';
import { htmlToText } from './gmail/parse';
import { rawMessage } from './gmail/api';
import { checkAccess, connectGoogle, type MailAccess } from './gmail/auth';
import { draftFor, emptyDraft, outgoing, stripQuote, type Draft, type Mode } from './compose';
import {
  MAX_SEND_BYTES, getVacation, setVacation, createDraft, createLabel, deleteDraft, getAttachment, updateDraft, getSignature, getThread, listLabels,
  inInbox, labelCounts, listThreads, LoginNeeded, markRead, markUnread, send, setInInbox, setLabel,
  setSaved, setSpam, setTrash, createRule, deleteRule, listForwardAddresses, listRules, ruleProblem,
  type GmailDraft, type OutgoingFile, type Vacation, type Label, type ListQuery, type Outgoing, type Rule, type RuleSpec, type Thread, type ThreadSummary,
} from './mail';
import * as R from './reminders';

/** Wat de mail van het werk-OS nodig heeft: taken maken, bespreekpunten, naar Instellingen. */
export interface MailHooks {
  /** Maak een taak in het werk-OS bij deze thread. Geeft de titel terug voor de melding. */
  makeTask(t: { subject: string; from: string; threadId: string; url: string }): string;
  /** Bespreekgroepen om een punt aan toe te voegen. */
  groups(): { id: string; title: string }[];
  /** Zet een punt in een bespreekgroep; geeft de groepsnaam terug. */
  addPoint(groupId: string, text: string): string;
  openSettings(): void;
}

let root!: ShadowRoot;      // het afgeschermde vak waar de mail in staat
let host!: HTMLElement;     // het element in de todo-app
let appEl!: HTMLElement;    // #app binnen het vak
let hooks!: MailHooks;
let access: MailAccess | null = null;

// Gepland verzenden liep via de server van de losse mailclient; dat komt later naar de server van het werk-OS.
const serverSession = (email: string): Record<string, string> | null => { void email; return null; };
const serverPost = async <T,>(path: string, body: unknown): Promise<T> => { void path; void body; throw new Error('Gepland verzenden komt later.'); };

const $ = (s: string) => root.querySelector(s) as HTMLElement;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const svg = (d: string) => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = { back: svg('M12 4l-6 6 6 6'), menu: svg('M3 6h14M3 10h14M3 14h14'), pen: svg('M4 16l1-4 8-8 3 3-8 8-4 1z') };
/** Smal = één kolom tegelijk; zelfde grens als de @container-regels in mail.css. */
const narrow = () => (host?.clientWidth ?? innerWidth) <= 700;

type Pane = 'nav' | 'list' | 'read';
const INBOX = 'INBOX';
const SEND_DELAY = 6000;  // tijd om verzenden ongedaan te maken
/** Vaste weergaven naast de eigen mappen. ALL = alle mail (geen label). */
const SYSTEM: Record<string, string> = {
  INBOX: 'Nieuw', STARRED: 'Opgeslagen', REMIND: 'Herinneringen', TODO: 'Todo', DRAFT: 'Concepten', SCHEDULED: 'Gepland', SENT: 'Verzonden', ALL: 'Alle mail', SPAM: 'Spam', TRASH: 'Prullenbak',
  RULES: 'Regels', SETTINGS: 'Instellingen',
};
const EMPTY: Record<string, string> = {
  INBOX: 'Alles is afgehandeld.', SPAM: 'Geen spam.', TRASH: 'De prullenbak is leeg.',
  STARRED: 'Sla een thread op om hem hier te bewaren. Nieuwe antwoorden komen er vanzelf bij, en terug in Nieuw.',
  REMIND: 'Geen herinneringen. Stel er een in op een e-mail, met een tijdstip dat je zelf kiest.',
  TODO: 'Geen todo’s. Maak er een vanuit een e-mail, of vraag Claude erom.',
  DRAFT: 'Geen concepten. Concepten die Claude in Gmail zet, verschijnen hier.',
};
const REMIND = 'REMIND';  // geen Gmail-label: komt uit src/reminders.ts
// Todo = de Gmail-map "Todo", zodat Claude (via de Gmail-koppeling) en een latere todo-app er ook bij kunnen.
const TODO = 'TODO';
const TODO_NAME = 'Todo';
const RULES = 'RULES';    // breed scherm zonder lijst: de Gmail-filters
const SETTINGS = 'SETTINGS';  // breed scherm: afwezigheidsmelding
const SCHEDULED = 'SCHEDULED';  // staat op de server, niet in Gmail
const WIDE = (v: string) => v === RULES || v === SETTINGS;

const UNREAD_KEY = 'mail:new-unread-only';
function savedUnreadOnly() {
  try { return localStorage.getItem(UNREAD_KEY) === '1'; } catch { return false; }
}

const S = {
  account: null as string | null,
  view: INBOX,                       // sleutel uit SYSTEM of het id van een map
  q: '',                             // actieve zoekopdracht (doorzoekt alle mail)
  qInput: '',                        // wat er in het zoekveld staat
  more: false,                       // Alle mail, Spam en Prullenbak tonen in het menu
  labels: [] as Label[],
  counts: {} as Record<string, number>,  // aantal threads per map in het menu
  unreadOnly: savedUnreadOnly(),      // bij Nieuw alleen ongelezen threads
  sig: { html: '', text: '' },
  threads: [] as ThreadSummary[],
  listState: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  sel: null as Set<string> | null,   // selectiemodus: gekozen threads
  open: null as string | null,
  thread: null as Thread | null,
  threadState: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  exp: new Set<number>(),
  drafts: new Map<string, Draft>(),  // antwoord-concepten per thread
  compose: null as Draft | null,     // nieuwe e-mail
  menu: null as 'map' | 'more' | 'remind' | 'ask' | 'discuss' | null,
  ask: null as { label: string; from: string } | null,  // aanbod: regel maken na kiezen van een map
  rules: [] as Rule[],
  rulesState: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  // het formulier voor een nieuwe regel; hier bewaard zodat opnieuw tekenen niets wist
  ruleDraft: { from: '', subject: '', body: '', act: 'label' as 'label' | 'forward', label: '', forward: '', skip: false },
  forwardTo: [] as string[],         // adressen waar Gmail naar mag doorsturen (in Gmail bevestigd)
  addingMap: false,
  keys: false,                       // overzicht van sneltoetsen in het menu
  images: new Set<string>(),         // berichten waarvan externe afbeeldingen getoond mogen worden
  quotes: new Set<string>(),         // berichten waarvan het citaat getoond wordt
  vacation: null as Vacation | null,  // afwezigheidsmelding zoals in Gmail
  scheduled: [] as Scheduled[],      // ingeplande berichten (server)
  planOpen: false,                   // keuzes voor gepland verzenden in het schrijfvenster
  needLogin: null as string | null,
  error: '',
  busy: false,
};

function when(ms: number, long = false) {
  const d = new Date(ms), now = new Date();
  const time = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return long ? `vandaag ${time}` : time;
  const day = d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return long ? `${day} ${time}` : day;
}
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const kb = (n: number) => n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`;
const labelName = (id: string) => S.labels.find((l) => l.id === id)?.name ?? id;
const todoLabel = () => S.labels.find((l) => l.name === TODO_NAME)?.id;
/** Eigen mappen zonder de Todo-map (die heeft een eigen plek in het menu). */
const folders = () => S.labels.filter((l) => l.name !== TODO_NAME);
const viewTitle = () => S.q ? 'Zoekresultaten' : SYSTEM[S.view] ?? labelName(S.view);
const query = (): ListQuery => S.q ? { q: S.q } : S.view === 'ALL' ? {}
  : S.view === INBOX && S.unreadOnly ? { label: INBOX, q: 'is:unread' }
  : { label: S.view === TODO ? todoLabel() : S.view };
const gmailAccount = () => !!S.account;
const inNewView = () => S.view === INBOX && !S.q;

function pane(p: Pane) { if (appEl) appEl.dataset.pane = p; }

/** Fouten van mail-aanroepen: verlopen sessie apart tonen, de rest als melding. */
function fail(e: unknown) {
  if (e instanceof LoginNeeded) S.needLogin = e.email;
  else S.error = (e as Error).message;
}

function clearHash() { try { history.replaceState(null, '', location.pathname); } catch { /* geen history */ } }

/* ---------- melding onderin, met ongedaan maken ---------- */

let toastTimer = 0;
let toastUndo: (() => void) | null = null;
function toast(msg: string, undo?: () => void, ms = undo ? SEND_DELAY : 3200) {
  const el = $('#toast');
  toastUndo = undo ?? null;
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-a="undo">Maak ongedaan</button>' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.hidden = true; toastUndo = null; }, ms);
}

/* ---------- laden ---------- */

async function loadList() {
  if (!S.account) return;
  const account = S.account, key = JSON.stringify(query());
  if (S.view === TODO && !S.q && !todoLabel()) { S.threads = []; S.listState = 'ready'; render(); return; }
  if (S.view === RULES && !S.q) { S.threads = []; S.listState = 'ready'; await loadRules(); return; }
  if (S.view === SETTINGS && !S.q) { S.threads = []; S.listState = 'ready'; render(); return; }
  if (S.view === SCHEDULED && !S.q) { await loadScheduled(); return; }
  if (S.view === REMIND && !S.q) {
    S.threads = R.forAccount(account).map((r) => ({
      id: r.threadId, who: r.who, subject: r.subject, date: r.at, unread: false, count: 1, labels: [], saved: false, draft: false,
      snippet: r.fired ? 'Afgegaan, staat weer in Nieuw' : `Herinnering ${R.fmt(r.at)}`,
    }));
    S.listState = 'ready'; render(); return;
  }
  S.listState = 'loading'; S.error = ''; render();
  try {
    const threads = await listThreads(account, query());
    if (S.account !== account || JSON.stringify(query()) !== key) return;
    S.threads = threads; S.listState = 'ready';
    if (S.sel) S.sel = new Set([...S.sel].filter((id) => threads.some((t) => t.id === id)));
  } catch (e) { fail(e); S.listState = 'error'; }
  render();
  void loadCounts();
}

/**
 * Aantallen achter de mappen in het menu: bij Nieuw de ongelezen threads, bij Opgeslagen, eigen mappen, Concepten en Spam alles.
 * Na elke lijst opnieuw, maar hooguit eens per paar seconden: het zijn losse verzoeken per map.
 */
let countsBusy = false, countsAt = 0;
async function loadCounts(force = false) {
  if (!S.account || countsBusy || (!force && Date.now() - countsAt < 4000)) return;
  const account = S.account;
  countsBusy = true;
  try {
    const counts = await labelCounts(account, [INBOX, 'STARRED', 'DRAFT', 'SPAM', ...folders().map((l) => l.id)], [INBOX]);
    if (S.account !== account) return;
    S.counts = counts; countsAt = Date.now();
    render();
  } finally { countsBusy = false; }
}

async function loadRules() {
  if (!S.account) return;
  const account = S.account;
  S.rulesState = 'loading'; S.error = ''; render();
  try { const rules = await listRules(account); if (S.account === account) { S.rules = rules; S.rulesState = 'ready'; } }
  catch (e) { fail(e); S.rulesState = 'error'; }
  render();
  // Voor de suggesties bij "stuur door naar"; niet erg als dit mislukt.
  try { const to = await listForwardAddresses(account); if (S.account === account) { S.forwardTo = to; render(); } } catch { /* zonder suggesties verder */ }
}

/** Mappen en handtekening; niet erg als dit mislukt. */
async function loadMeta() {
  if (!S.account) return;
  const account = S.account;
  const [labels, sig, rems, vac] = await Promise.allSettled([listLabels(account), getSignature(account), R.load(account), getVacation(account)]);
  if (S.account !== account) return;
  if (vac.status === 'fulfilled') S.vacation = vac.value;
  if (rems.status === 'rejected') fail(rems.reason);
  else { fireDue(); if (S.view === REMIND && !S.q) loadList(); }
  if (labels.status === 'fulfilled') S.labels = labels.value;
  if (sig.status === 'fulfilled') S.sig = sig.value;
  render();
  void loadCounts(true);
}

async function openThread(id: string) {
  if (!S.account) return;
  const account = S.account;
  S.open = id; S.thread = null; S.threadState = 'loading'; S.exp = new Set(); S.error = ''; S.menu = null; S.compose = null;
  try { history.replaceState(null, '', '#mail-' + encodeURIComponent(id)); } catch { /* geen history */ }
  pane('read'); render(); $('#read').scrollTop = 0;
  try {
    const t = await getThread(account, id);
    if (S.open !== id || S.account !== account) return;
    S.thread = t; S.threadState = 'ready';
    const local = S.drafts.get(id);
    if (t.draft && !t.messages.length) S.compose = fromGmail(t, t.draft, account);  // los concept, nog geen thread
    else if (t.draft && (!local || (!local.body.trim() && !local.gmailDraftId))) S.drafts.set(id, fromGmail(t, t.draft, account));
    else if (!local) S.drafts.set(id, draftFor(t, 'reply', account));
    const row = S.threads.find((x) => x.id === id);
    if (row?.unread) { row.unread = false; markRead(account, id).catch(fail); }
  } catch (e) { fail(e); S.threadState = 'error'; }
  render();
}

/** Concept uit Gmail (bijv. van Claude) als concept in de app; ontbrekende velden aangevuld zoals bij beantwoorden. */
function fromGmail(t: Thread, g: GmailDraft, account: string): Draft {
  const base = t.messages.length ? draftFor(t, 'reply', account) : emptyDraft();
  return { ...base, to: g.to || base.to, cc: g.cc, bcc: g.bcc, showCc: !!(g.cc || g.bcc), subject: g.subject || base.subject, body: t.messages.length ? stripQuote(g.body) : g.body, gmailDraftId: g.id };
}

/** Thread opnieuw ophalen zonder de leespositie te verliezen (bijv. na verzenden). */
async function refreshThread() {
  if (!S.account || !S.open) return;
  const account = S.account, id = S.open;
  try {
    const t = await getThread(account, id);
    if (S.open === id && S.account === account) { S.thread = t; render(); }
  } catch (e) { fail(e); render(); }
}

function closeThread() {
  S.open = null; S.thread = null; S.menu = null; clearHash(); pane('list');
}

/** Andere lijst tonen (map, systeemweergave of zoekresultaten). */
function showList(view: string, q = '') {
  Object.assign(S, { view, q, qInput: q, threads: [], sel: null, compose: null, menu: null });
  closeThread();
  loadList();
}

/** Na een actie die de thread uit de lijst haalt: op desktop de volgende openen, op telefoon terug naar de lijst. */
function openNext(index: number) {
  const next = S.threads[Math.min(index, S.threads.length - 1)];
  if (narrow() || !next) { closeThread(); render(); } else openThread(next.id);
}

/* ---------- weergave ---------- */

/** Geen toegang tot de mail: uitleggen waarom en de juiste knop tonen. */
function loginHTML() {
  const a = access;
  const msg = !a ? 'Mail openen…'
    : a.ok ? ''
    : a.reason === 'no_server' ? 'De mail werkt zodra de app met de server is verbonden.'
    : a.reason === 'not_configured' ? 'Koppelen met Google is nog niet ingesteld op de server.'
    : a.reason === 'not_connected' ? 'Koppel je Google-account om je mail hier te openen.'
    : a.reason === 'reauth' ? `De koppeling met ${a.email ?? 'Google'} is verlopen. Koppel opnieuw.`
    : a.reason === 'no_mail' ? `Google is gekoppeld${a.email ? ` (${a.email})` : ''}, maar nog zonder toestemming voor Gmail. Koppel opnieuw en sta Gmail toe.`
    : a.message ?? 'De mail kon niet openen.';
  const canConnect = !!a && !a.ok && (a.reason === 'not_connected' || a.reason === 'reauth' || a.reason === 'no_mail');
  return `<div class="login"><p class="brand">Mail</p>
    ${S.error ? `<p class="error">${esc(S.error)}</p>` : ''}
    <p class="hint">${esc(S.busy ? 'Doorsturen naar Google…' : msg)}</p>
    <div class="logins">
      ${canConnect ? `<button class="btn pri" data-a="connect" ${S.busy ? 'disabled' : ''}>Koppel Google</button>` : ''}
      ${a && !a.ok && a.reason === 'error' ? '<button class="btn" data-a="retry">Probeer opnieuw</button>' : ''}
      <button class="btn" data-a="settings">Naar Instellingen</button>
    </div></div>`;
}

function navHTML() {
  const gmail = gmailAccount();
  const row = (id: string, name = SYSTEM[id], n = 0, what = '') =>
    `<button class="${S.view === id && !S.q ? 'on' : ''}" data-a="view" data-v="${esc(id)}" title="${esc(n && what ? `${name}: ${n} ${what}` : name)}"><span>${esc(name)}</span>${n ? `<span class="n">${n}</span>` : ''}</button>`;
  const remCount = S.account ? R.forAccount(S.account).filter((r) => !r.fired).length : 0;
  return `<div class="brand">Mail</div>
    ${gmail ? `<button class="btn pri block" data-a="compose">Nieuwe e-mail</button>` : ''}
    ${vacationOn() ? `<button class="ooo" data-a="view" data-v="${SETTINGS}">Afwezigheidsmelding staat aan${S.vacation?.endTime ? ` tot ${new Date(Number(S.vacation.endTime)).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}` : ''}</button>` : ''}
    <div class="navlist">${row(INBOX, SYSTEM[INBOX], S.counts[INBOX], 'ongelezen')}${gmail ? row('STARRED', SYSTEM.STARRED, S.counts.STARRED) + row(REMIND, SYSTEM[REMIND], remCount) : ''}</div>
    ${gmail ? `<div><div class="label">Mappen</div><div class="navlist">
      ${folders().map((l) => row(l.id, l.name, S.counts[l.id])).join('')}
      ${S.addingMap
        ? '<form id="mapform" class="mapform"><input class="field" id="newmap" type="text" placeholder="Naam van de map" aria-label="Naam van de map"><button class="btn">OK</button></form>'
        : '<button class="quiet" data-a="addmap">+ Map</button>'}
    </div></div>
    <div class="navlist">${row('DRAFT', SYSTEM.DRAFT, S.counts.DRAFT)}${row('SENT')}${S.more ? row('ALL') + row('SPAM', SYSTEM.SPAM, S.counts.SPAM) + row('TRASH') : '<button class="quiet" data-a="more">Meer</button>'}</div>
    <div class="navlist">${row(RULES)}${row(SETTINGS)}</div>` : ''}
    <div><div class="label">Account</div><div class="navlist">
      <div class="acc"><span class="prov" title="${esc(S.account ?? '')}">${esc(S.account ?? '')}</span>
        <button class="quiet" data-a="settings">Koppeling in Instellingen</button></div>
    </div></div>
    ${gmail ? `<div class="navkeys"><button class="quiet" data-a="keys">${S.keys ? 'Verberg sneltoetsen' : 'Sneltoetsen'}</button>
      ${S.keys ? `<dl class="keys">${SHORTCUTS.map(([k, v]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}</div>` : ''}`;
}

function itemHTML(t: ThreadSummary) {
  const rem = S.account ? R.get(S.account, t.id) : undefined;
  const chips = [
    rem?.fired ? '<span class="chip w">Herinnering</span>' : '',
    rem && !rem.fired && S.view !== REMIND ? `<span class="chip">Herinnering: ${esc(R.fmt(rem.at))}</span>` : '',
    t.saved && S.view !== 'STARRED' ? '<span class="chip a">Opgeslagen</span>' : '',
    t.labels.includes(todoLabel() ?? '') && S.view !== TODO ? '<span class="chip w">Todo</span>' : '',
    t.draft && S.view !== 'DRAFT' ? '<span class="chip">Concept</span>' : '',
    ...t.labels.filter((l) => l !== S.view && l !== todoLabel()).map((l) => `<span class="chip">${esc(labelName(l))}</span>`),
  ].join('');
  const picked = S.sel?.has(t.id);
  const pick = S.sel ? `<span class="pick ${picked ? 'on' : ''}" aria-hidden="true">${picked ? '✓' : ''}</span>` : '';
  return `<button class="item ${t.unread ? 'unread' : ''} ${S.open === t.id && !S.compose && !S.sel ? 'on' : ''}" data-a="${S.sel ? 'pick' : 'open'}" data-v="${esc(t.id)}"
      ${S.sel ? `role="checkbox" aria-checked="${!!picked}"` : ''}>
    <span class="r1"><span class="who">${pick}${t.unread ? '<span class="dot"></span>' : ''}${esc(t.who)}</span>${t.count > 1 ? `<span class="cnt">${t.count}</span>` : ''}<span class="time">${when(t.date)}</span></span>
    <span class="sub">${esc(t.subject)}</span>
    <span class="snip">${esc(t.snippet)}</span>
    <span class="chips">${chips}</span></button>`;
}

function reloginHTML(email: string) {
  return `<div class="relogin"><p>De koppeling met <b>${esc(email)}</b> is verlopen of mist toestemming voor Gmail. Koppel Google opnieuw.</p>
    <button class="btn pri" data-a="connect" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Bezig…' : 'Koppel opnieuw'}</button></div>`;
}

function bulkHTML() {
  if (!S.sel) return '';
  const n = S.sel.size, dis = n ? '' : 'disabled';
  const inTrash = S.view === 'TRASH' && !S.q;
  return `<div class="bulk"><span>${n} geselecteerd · <button class="link" data-a="selall">Selecteer alles</button></span>
    ${inNewView() ? `<button class="btn" data-a="bulk" data-v="done" ${dis}>Klaar</button>` : ''}
    <button class="btn" data-a="bulk" data-v="unread" ${dis}>Ongelezen</button>
    ${S.labels.length && !inTrash ? `<select id="bulkmap" aria-label="Zet in map" ${dis}><option value="">Map…</option>${folders().map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select>` : ''}
    ${inTrash ? `<button class="btn" data-a="bulk" data-v="untrash" ${dis}>Zet terug</button>` : `<button class="btn" data-a="bulk" data-v="trash" ${dis}>Verwijder</button>`}</div>`;
}

/** Staat de melding nu (of straks) aan? Een verlopen einddatum telt als uit. */
const vacationOn = () => !!S.vacation?.enableAutoReply && (!S.vacation.endTime || Number(S.vacation.endTime) > Date.now());

const dateInput = (ms?: string) => ms ? new Date(Number(ms)).toLocaleDateString('sv-SE') : '';  // yyyy-mm-dd

function settingsHTML() {
  const top = `<div class="top"><button class="icon" data-a="pane" data-v="nav" aria-label="Menu">${ICON.back}</button></div>`;
  const v = S.vacation, domain = S.account?.split('@')[1] ?? '';
  if (!v) return `<div class="doc">${top}<h2>Instellingen</h2><p class="hint">Instellingen ophalen…</p></div>`;
  return `<div class="doc">${top}
    <h2>Instellingen</h2>
    <form class="set" id="vacform">
      <h3>Afwezigheidsmelding</h3>
      <p class="hint">Dit is de afwezigheidsmelding van Gmail zelf: hij werkt ook als de app dicht is, en Gmail stuurt elke afzender hooguit eens per vier dagen een antwoord.</p>
      <label class="check"><input type="checkbox" id="v-on" ${v.enableAutoReply ? 'checked' : ''}> Afwezigheidsmelding aan</label>
      <div class="vdates"><label>Vanaf <input type="date" id="v-from" value="${dateInput(v.startTime)}"></label>
        <label>Tot <input type="date" id="v-to" value="${dateInput(v.endTime)}"></label></div>
      <label class="fld">Onderwerp <input class="field" type="text" id="v-subject" value="${esc(v.responseSubject ?? '')}" placeholder="Bijv. Afwezig tot en met maandag"></label>
      <label class="fld">Bericht <textarea id="v-body" placeholder="Bijv. Ik ben afwezig tot en met … en lees mijn mail daarna.">${esc(v.responseBodyPlainText || htmlToText(v.responseBodyHtml ?? ''))}</textarea></label>
      ${domain ? `<label class="check"><input type="checkbox" id="v-domain" ${v.restrictToDomain ? 'checked' : ''}> Alleen naar mensen binnen ${esc(domain)}</label>` : ''}
      <label class="check"><input type="checkbox" id="v-contacts" ${v.restrictToContacts ? 'checked' : ''}> Alleen naar mijn contacten</label>
      <div><button class="btn pri">Bewaar</button></div>
    </form></div>`;
}

async function saveVacation() {
  const account = S.account;
  if (!account) return;
  const val = (id: string) => ($(id) as HTMLInputElement).value;
  const checked = (id: string) => !!($(id) as HTMLInputElement | null)?.checked;
  const on = checked('#v-on'), body = val('#v-body').trim(), from = val('#v-from'), to = val('#v-to');
  if (on && !body) { toast('Schrijf eerst het bericht van de afwezigheidsmelding'); focus('#v-body'); return; }
  const startOfDay = (d: string) => String(new Date(`${d}T00:00:00`).getTime());
  // Zoals Gmail zelf: "tot" = tot het begin van die dag.
  if (from && to && Number(startOfDay(to)) <= Number(startOfDay(from))) { toast('De einddatum moet na de begindatum liggen'); return; }
  const v: Vacation = {
    enableAutoReply: on,
    responseSubject: val('#v-subject').trim(),
    responseBodyPlainText: body,
    responseBodyHtml: esc(body).replace(/\n/g, '<br>'),
    restrictToDomain: checked('#v-domain'),
    restrictToContacts: checked('#v-contacts'),
    ...(from ? { startTime: startOfDay(from) } : {}),
    ...(to ? { endTime: startOfDay(to) } : {}),
  };
  try { S.vacation = await setVacation(account, v); toast(on ? 'Afwezigheidsmelding staat aan' : 'Afwezigheidsmelding staat uit'); }
  catch (e) { fail(e); }
  render();
}

/** Eén regel als zin: "Afzender bevat X en onderwerp bevat Y → Map · stuur door naar adres". */
function ruleLine(r: RuleSpec) {
  const when = [
    r.from && `afzender bevat <b>${esc(r.from)}</b>`,
    r.subject && `onderwerp bevat <b>${esc(r.subject)}</b>`,
    r.body && `bericht bevat <b>${esc(r.body)}</b>`,
  ].filter(Boolean).join(' en ');
  const then = [
    r.label && `<b>${esc(labelName(r.label))}</b>`,
    r.forward && `stuur door naar <b>${esc(r.forward)}</b>`,
    r.skipInbox && 'niet in Nieuw',
  ].filter(Boolean).join(' · ');
  return `${when.charAt(0).toUpperCase()}${when.slice(1)} → ${then}`;
}

/** De regel zoals hij nu in het formulier staat. */
function draftRule(): RuleSpec {
  const d = S.ruleDraft, maps = folders();
  const spec: RuleSpec = { from: d.from.trim(), subject: d.subject.trim(), body: d.body.trim(), skipInbox: d.skip };
  if (d.act === 'forward' || !maps.length) spec.forward = d.forward.trim();
  else spec.label = maps.some((l) => l.id === d.label) ? d.label : maps[0].id;
  return spec;
}

function rulesHTML() {
  const top = `<div class="top"><button class="icon" data-a="pane" data-v="nav" aria-label="Menu">${ICON.back}</button></div>`;
  const d = S.ruleDraft, maps = folders(), fwd = d.act === 'forward' || !maps.length;
  const opts = maps.map((l) => `<option value="${esc(l.id)}"${l.id === d.label ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
  const rows = S.rulesState === 'loading' && !S.rules.length ? '<p class="hint">Regels ophalen…</p>'
    : S.rulesState === 'error' ? '<p class="hint">De regels konden niet laden. <button class="link" data-a="reload">Probeer opnieuw</button></p>'
    : S.rules.map((r) => r.simple
      ? `<div class="rule"><span>${ruleLine(r.simple)}</span>
          <button class="btn ghost" data-a="delrule" data-v="${esc(r.id)}">Verwijder</button></div>`
      : `<div class="rule other"><span>Andere Gmail-regel: ${esc(r.summary.replace(/Label_\w+/g, (id) => labelName(id)))}</span><span class="hint">Beheer in Gmail</span></div>`).join('')
      || '<p class="hint">Nog geen regels.</p>';
  return `<div class="doc">${top}
    <h2>Regels</h2>
    <p class="hint">Nieuwe mail die past gaat naar een map of wordt doorgestuurd, ook als de app dicht is (het zijn Gmail-filters). Vul één of meer voorwaarden in; alles wat je invult moet kloppen. Bestaande mail verandert niet.</p>
    <form class="ruleform" id="ruleform" novalidate>
      <label for="r-from">Als afzender bevat</label>
      <input type="text" id="r-from" value="${esc(d.from)}" placeholder="bijv. @klant.nl" autocomplete="off">
      <label for="r-subject">en onderwerp bevat</label>
      <input type="text" id="r-subject" value="${esc(d.subject)}" placeholder="bijv. factuur" autocomplete="off">
      <label for="r-body">en bericht bevat</label>
      <input type="text" id="r-body" value="${esc(d.body)}" placeholder="woorden uit de tekst" autocomplete="off">
      <span aria-hidden="true">→</span>
      <div class="then">
        <select id="r-act" aria-label="Wat er gebeurt">
          <option value="label"${fwd ? '' : ' selected'}${maps.length ? '' : ' disabled'}>naar map</option>
          <option value="forward"${fwd ? ' selected' : ''}>stuur door naar</option>
        </select>
        ${fwd
          ? `<input type="email" id="r-forward" value="${esc(d.forward)}" placeholder="naam@bedrijf.nl" list="r-fwdlist" aria-label="Doorsturen naar" autocomplete="off">
             <datalist id="r-fwdlist">${S.forwardTo.map((a) => `<option value="${esc(a)}"></option>`).join('')}</datalist>`
          : `<select id="r-label" aria-label="Map">${opts}</select>`}
      </div>
      <div class="end">
        <label><input type="checkbox" id="r-skip"${d.skip ? ' checked' : ''}> niet in Nieuw</label>
        <button class="btn pri">Voeg toe</button>
      </div>
    </form>
    ${S.error ? `<p class="error" role="alert">${esc(S.error)}</p>` : ''}
    ${fwd ? `<p class="hint">Gmail stuurt alleen door naar adressen die je in Gmail hebt toegevoegd en die de ontvanger heeft bevestigd${S.forwardTo.length ? ` (nu: ${S.forwardTo.map(esc).join(', ')})` : ''}. Een nieuw adres voeg je één keer toe in <a class="link" href="https://mail.google.com/mail/u/0/#settings/fwdandpop" target="_blank" rel="noopener">Gmail › Doorsturen</a>.</p>` : ''}
    <div>${rows}</div></div>`;
}

function listHTML() {
  let rows = '';
  if (S.needLogin) rows = reloginHTML(S.needLogin);
  else if (S.listState === 'loading' && !S.threads.length) rows = `<div class="none">${S.q ? 'Zoeken…' : 'Mail ophalen…'}</div>`;
  else if (S.listState === 'error') rows = `<div class="none">Deze lijst kon niet laden.<br><button class="link" data-a="reload">Probeer opnieuw</button></div>`;
  else if (S.view === SCHEDULED && !S.q) rows = scheduledHTML();
  else rows = S.threads.map(itemHTML).join('') || `<div class="none">${S.q ? 'Niets gevonden.' : inNewView() && S.unreadOnly ? 'Geen ongelezen mail.' : EMPTY[S.view] ?? 'Deze map is leeg.'}</div>`;
  const gmail = gmailAccount();
  return `<div class="head"><div class="hrow">
      <button class="icon mob" data-a="pane" data-v="nav" aria-label="Menu">${ICON.menu}</button>
      <h1>${esc(viewTitle())}</h1>
      ${gmail && S.threads.length && S.view !== REMIND && S.view !== SCHEDULED ? `<button class="link" data-a="selmode">${S.sel ? 'Annuleer' : 'Selecteer'}</button>` : ''}
      <button class="link" data-a="reload">Vernieuw</button>
      ${gmail ? `<button class="icon mob" data-a="compose" aria-label="Nieuwe e-mail">${ICON.pen}</button>` : ''}</div>
      ${gmail ? `<form id="searchform" role="search"><input class="field" id="q" type="search" placeholder="Zoek in alle mail" value="${esc(S.qInput)}" aria-label="Zoek in alle mail" enterkeyhint="search"></form>
        ${S.q ? '<button class="link clearq" data-a="clearq">Wis zoekopdracht</button>' : ''}` : ''}
      ${gmail && S.view === INBOX && !S.q ? `<div class="filter" role="group" aria-label="Welke mail">
        <button class="${S.unreadOnly ? '' : 'on'}" data-a="onlyunread" data-v="0" aria-pressed="${!S.unreadOnly}">Alles</button>
        <button class="${S.unreadOnly ? 'on' : ''}" data-a="onlyunread" data-v="1" aria-pressed="${S.unreadOnly}">Ongelezen${S.counts[INBOX] ? ` <span class="n">${S.counts[INBOX]}</span>` : ''}</button></div>` : ''}
      ${bulkHTML()}
      ${S.error ? `<p class="error">${esc(S.error)}</p>` : ''}</div>
    <div id="rows">${rows}</div>`;
}

/* ---------- HTML-mails: afgeschermd kader, geen scripts, externe afbeeldingen pas na klik ---------- */

const REMOTE_IMG = /<img[^>]+src\s*=\s*["']?https?:/i;
const QUOTE = /gmail_quote|<blockquote|divRplyFwdMsg|yahoo_quoted/i;

function mailDoc(html: string, images: boolean, quote: boolean) {
  const remote = images ? ' https: http:' : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'${remote}; img-src data:${remote}; font-src data:${remote}">
<base target="_blank"><style>
html,body{margin:0;background:#fff;color:#141412}
body{padding:14px 16px;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;overflow-wrap:anywhere}
img{max-width:100%;height:auto} table{max-width:100%} pre{white-space:pre-wrap}
${quote ? '' : '.gmail_quote,blockquote[type=cite],.yahoo_quoted,#divRplyFwdMsg,#divRplyFwdMsg~*{display:none!important}'}
</style></head><body>${html}</body></html>`;
}

function bodyHTML(m: Thread['messages'][number]) {
  if (!m.html) return `<div class="body">${esc(m.body || m.snippet)}</div>`;
  const images = S.images.has(m.id), quote = S.quotes.has(m.id);
  const opts = [
    REMOTE_IMG.test(m.html) && !images ? `<button class="link" data-a="images" data-v="${esc(m.id)}">Afbeeldingen tonen</button>` : '',
    QUOTE.test(m.html) ? `<button class="link" data-a="quote" data-v="${esc(m.id)}">${quote ? 'Citaat verbergen' : 'Citaat tonen'}</button>` : '',
  ].filter(Boolean).join(' · ');
  return `<iframe class="mailhtml" title="E-mail" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcdoc="${esc(mailDoc(m.html, images, quote))}"></iframe>
    ${opts ? `<div class="mailopts">${opts}</div>` : ''}`;
}

/** Kader zo hoog maken als de mail (ook als afbeeldingen later laden). */
const fitters = new WeakMap<HTMLIFrameElement, ResizeObserver>();
const on_load = ((ev: Event) => {
  const f = ev.target;
  if (!(f instanceof HTMLIFrameElement) || !f.classList.contains('mailhtml') || !f.contentDocument) return;
  const fit = () => { f.style.height = `${f.contentDocument!.documentElement.scrollHeight}px`; };
  fit();
  fitters.get(f)?.disconnect();
  const ro = new ResizeObserver(fit);
  ro.observe(f.contentDocument.body);
  fitters.set(f, ro);
});

/** Gekozen bestanden als bijlage aan het open concept toevoegen. */
async function addFiles(files: FileList | null) {
  const d = current();
  if (!d || !files?.length) return;
  const read = (f: File) => new Promise<OutgoingFile>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: f.name, mime: f.type, size: f.size, data: String(r.result).split(',')[1] ?? '' });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
  try { d.att = [...(d.att ?? []), ...await Promise.all([...files].map(read))]; }
  catch { toast('Een bestand kon niet worden gelezen'); }
  const total = d.att?.reduce((n, f) => n + f.size, 0) ?? 0;
  if (total > MAX_SEND_BYTES) toast(`Let op: bijlagen samen ${kb(total)}; Gmail staat maximaal 25 MB toe`);
  render();
}

/** Bij doorsturen: de bijlagen van het laatste bericht ophalen. */
async function originalFiles(account: string, t: Thread): Promise<OutgoingFile[]> {
  const m = t.messages.at(-1);
  const list = (m?.attachments ?? []).filter((a) => a.id);
  return Promise.all(list.map(async (a) => {
    const bytes = await getAttachment(account, m!.id, a.id!);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { name: a.name, mime: a.mime ?? 'application/octet-stream', size: a.size, data: btoa(bin) };
  }));
}

async function downloadAttachment(v: string) {
  const [messageId, i] = v.split(':'), account = S.account;
  const a = S.thread?.messages.find((m) => m.id === messageId)?.attachments[Number(i)];
  if (!a?.id || !account) return;
  toast(`${a.name} ophalen…`);
  try {
    const bytes = await getAttachment(account, messageId, a.id);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: a.mime || 'application/octet-stream' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: a.name });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    toast(`${a.name} gedownload`);
  } catch (e) { fail(e); render(); }
}

function composerHTML(d: Draft) {
  const tabs = d.threadId
    ? `<div class="modes">${([['reply', 'Beantwoord'], ['all', 'Allen beantwoorden'], ['fwd', 'Stuur door']] as [Mode, string][])
        .map(([m, l]) => `<button class="tab ${d.mode === m ? 'on' : ''}" data-a="mode" data-v="${m}">${l}</button>`).join('')}</div>`
    : '';
  return `<div class="reply">${tabs}
    <div class="frow"><label for="c-to">Aan</label><input id="c-to" type="text" value="${esc(d.to)}" placeholder="e-mailadres, gescheiden door komma's" autocomplete="off">${d.showCc ? '' : '<button class="link" data-a="cc">Cc/Bcc</button>'}</div>
    ${d.showCc ? `<div class="frow"><label for="c-cc">Cc</label><input id="c-cc" type="text" value="${esc(d.cc)}" autocomplete="off"></div>
      <div class="frow"><label for="c-bcc">Bcc</label><input id="c-bcc" type="text" value="${esc(d.bcc)}" autocomplete="off"></div>` : ''}
    ${d.threadId ? '' : `<div class="frow"><label for="c-subject">Onderwerp</label><input id="c-subject" type="text" value="${esc(d.subject)}"></div>`}
    <textarea id="c-body" placeholder="Schrijf je bericht…" aria-label="Bericht">${esc(d.body)}</textarea>
    ${S.sig.text ? `<div class="sig">${esc(S.sig.text)}</div>` : ''}
    ${d.mode === 'fwd' ? '<div class="based">Het laatste bericht wordt meegestuurd.</div>' : ''}
    ${d.att?.length ? `<div class="atts">${d.att.map((f, i) => `<span class="att">${esc(f.name)} · ${kb(f.size)}<button data-a="rmatt" data-v="${i}" aria-label="Verwijder bijlage ${esc(f.name)}">×</button></span>`).join('')}</div>` : ''}
    ${d.mode === 'fwd' && S.thread?.messages.at(-1)?.attachments.some((a) => a.id) ? '<div class="based">De bijlagen van het oorspronkelijke bericht gaan ook mee.</div>' : ''}
    ${d.gmailDraftId && !d.savedAt ? '<div class="based">Concept uit Gmail, bijvoorbeeld van Claude. Pas het gerust aan; na versturen ruimt de app het concept in Gmail op.</div>' : ''}
    <div class="row">
      <select id="c-rem" aria-label="Herinnering na verzenden"><option value="">Geen herinnering</option>
        ${Object.keys(R.SEND_PRESETS).map((k) => `<option value="${k}" ${d.rem === k ? 'selected' : ''}>Herinner me ${k.toLowerCase()}</option>`).join('')}
        <option value="custom" ${d.rem === 'custom' ? 'selected' : ''}>Eigen tijdstip…</option></select>
      ${d.rem === 'custom' ? `<input type="datetime-local" id="c-remat" value="${esc(d.remAt)}" aria-label="Tijdstip herinnering">` : ''}
      <label class="btn">Bijlage<input type="file" id="c-file" multiple hidden></label>
      <span class="sp"></span><span class="cstatus" id="c-status">${d.savedAt ? `Bewaard in Gmail ${when(d.savedAt)}` : ''}</span>
      ${d.gmailDraftId ? '<button class="btn" data-a="dropdraft">Gooi concept weg</button>' : d.threadId ? '' : '<button class="btn" data-a="discard">Gooi weg</button>'}
      <button class="btn pri" data-a="send">Verstuur</button></div>
    ${S.planOpen ? `<div class="plan"><span>Verstuur op:</span>
      ${planPresets().map((p) => `<button class="btn" data-a="planat" data-v="${p.at}">${p.label}</button>`).join('')}
      <input type="datetime-local" id="c-planat" aria-label="Eigen verzendtijd"><button class="btn" data-a="planat">Plan in</button></div>` : ''}</div>`;
}

/** Opent Claude met alleen het thread-id; Claude haalt de inhoud zelf op via de Gmail-koppeling. */
function claudeLink(t: Thread) {
  const prompt = `Haal via de Gmail-koppeling de Gmail-thread met id ${t.id} op. `;
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

function barHTML(t: Thread) {
  if (t.inTrash) return '<div class="bar"><button class="btn pri" data-a="untrash">Zet terug</button></div>';
  if (t.inSpam) return '<div class="bar"><button class="btn pri" data-a="unspam">Geen spam</button><button class="btn" data-a="trash">Verwijder</button></div>';
  const maps = t.labels.filter((l) => l !== todoLabel()).map(labelName);
  const rem = R.get(S.account!, t.id);
  return `<div class="bar">
      ${t.inInbox ? '<button class="btn pri" data-a="done">Klaar</button>' : '<button class="btn" data-a="tonew">Zet terug in Nieuw</button>'}
      <button class="btn ${t.saved ? 'on' : ''}" data-a="save" aria-pressed="${t.saved}">${t.saved ? 'Opgeslagen' : 'Opslaan'}</button>
      <button class="btn" data-a="task" title="Maak een taak in het werk-OS, met een link naar deze mail">Maak taak</button>
      <button class="btn ${S.menu === 'discuss' ? 'on' : ''}" data-a="menu" data-v="discuss" title="Zet deze mail op een bespreeklijst">Bespreek</button>
      <button class="btn ${rem ? 'on' : ''}" data-a="menu" data-v="remind">${rem ? (rem.fired ? 'Herinnering' : `Herinnering: ${esc(R.fmt(rem.at))}`) : 'Herinner me'}</button>
      <button class="btn ${S.menu === 'map' ? 'on' : ''}" data-a="menu" data-v="map">${maps.length ? esc(maps.join(', ')) : 'Map'}</button>
      <button class="btn ${S.menu === 'more' ? 'on' : ''}" data-a="menu" data-v="more">Meer</button>
      <a class="btn" href="${esc(claudeLink(t))}" target="_blank" rel="noopener" title="Opent Claude; Claude leest de thread via de Gmail-koppeling">Vraag Claude</a></div>`;
}

function menuHTML(t: Thread) {
  if (S.menu === 'map') return `<div class="menu"><span>Map:</span>
      ${folders().map((l) => `<button class="btn ${t.labels.includes(l.id) ? 'on' : ''}" data-a="label" data-v="${esc(l.id)}">${esc(l.name)}</button>`).join('')
        || '<span class="hint">Nog geen mappen. Maak er een via “+ Map” in het menu.</span>'}</div>`;
  if (S.menu === 'ask' && S.ask) return `<div class="menu"><span>Voortaan alle mail van <b>${esc(S.ask.from)}</b> naar ${esc(labelName(S.ask.label))}?</span>
      <button class="btn pri" data-a="mkrule">Maak regel</button><button class="btn" data-a="menu" data-v="ask">Nee</button></div>`;
  if (S.menu === 'remind') {
    const rem = R.get(S.account!, t.id);
    return `<div class="menu"><span>Herinner me:</span>
      ${R.threadPresets().map((p) => `<button class="btn" data-a="remind" data-v="${p.at}">${p.label}</button>`).join('')}
      <input type="datetime-local" id="remat" aria-label="Eigen tijdstip"><button class="btn" data-a="remindat">Stel in</button>
      ${rem ? '<button class="btn ghost" data-a="unremind">Verwijder herinnering</button>' : ''}</div>`;
  }
  if (S.menu === 'discuss') {
    const groups = hooks.groups();
    return `<div class="menu"><span>Bespreek met:</span>
      ${groups.map((g) => `<button class="btn" data-a="discussto" data-v="${esc(g.id)}">${esc(g.title)}</button>`).join('')
        || '<span class="hint">Nog geen bespreekgroepen. Maak er een bij Om te bespreken.</span>'}</div>`;
  }
  if (S.menu === 'more') return `<div class="menu">
      <button class="btn" data-a="unread">Markeer als ongelezen</button>
      <button class="btn" data-a="spam">Spam</button>
      <button class="btn" data-a="trash">Verwijder</button></div>`;
  return '';
}

function readHTML() {
  const top = `<div class="top"><button class="icon" data-a="pane" data-v="list" aria-label="Terug">${ICON.back}</button></div>`;
  if (S.compose) return `<div class="doc">${top}<div class="titleblock"><h2>${S.compose.gmailDraftId ? 'Concept' : 'Nieuwe e-mail'}</h2></div>${composerHTML(S.compose)}</div>`;
  if (S.view === RULES && !S.q) return rulesHTML();
  if (S.view === SETTINGS && !S.q) return settingsHTML();
  if (!S.open) return '<div class="empty">Kies een thread om te lezen.</div>';
  if (S.needLogin && !S.thread) return `<div class="doc">${top}${reloginHTML(S.needLogin)}</div>`;
  if (S.threadState === 'loading') return `<div class="doc">${top}<p class="hint">Thread openen…</p></div>`;
  if (S.threadState === 'error' || !S.thread) return `<div class="doc">${top}<p class="hint">Deze thread kon niet laden. <button class="link" data-a="open" data-v="${esc(S.open)}">Probeer opnieuw</button></p></div>`;
  const t = S.thread, n = t.messages.length, gmail = gmailAccount();
  const people = [...new Set(t.messages.map((m) => m.me ? 'jij' : m.from))].join(', ');
  const msgs = t.messages.map((m, i) => {
    const open = i === n - 1 || S.exp.has(i);
    return `<div class="msg ${m.me ? 'me' : ''}">
      <button class="mh" data-a="exp" data-v="${i}" aria-expanded="${open}"><b>${esc(m.from)}</b>${open
        ? (m.to ? `<span class="pre">aan ${esc(m.to)}</span>` : '')
        : `<span class="pre">${esc(flat(m.snippet))}</span>`}<span class="time">${when(m.date, true)}</span></button>
      ${open ? `${bodyHTML(m)}${m.attachments.length
        ? `<div class="atts">${m.attachments.map((a, ai) => a.id
          ? `<button class="att" data-a="att" data-v="${esc(m.id)}:${ai}" title="Download">${esc(a.name)} · ${kb(a.size)}</button>`
          : `<span class="att">${esc(a.name)} · ${kb(a.size)}</span>`).join('')}</div>` : ''}` : ''}
    </div>`;
  }).join('');
  const draft = S.drafts.get(t.id);
  const canReply = gmail && draft && !t.inTrash && !t.inSpam;
  return `<div class="doc">${top}${gmail ? barHTML(t) + menuHTML(t) : ''}
    <div class="titleblock"><h2>${esc(t.subject)}</h2>
      <div class="meta"><span>${n} ${n > 1 ? 'berichten' : 'bericht'} · ${esc(people)}</span>
        ${t.inTrash ? '<span class="chip">In de prullenbak</span>' : t.inSpam ? '<span class="chip">Spam</span>' : ''}</div></div>
    <div class="thread">${msgs}</div>
    ${canReply ? composerHTML(draft) : ''}</div>`;
}

/** Cursorpositie in een tekstveld; een e-mailveld geeft die niet prijs. */
function caret(el: HTMLInputElement): number | null { try { return el.selectionStart; } catch { return null; } }

function render() {
  const app = appEl;
  if (!app) return;
  if (!S.account) { app.className = 'solo'; app.innerHTML = loginHTML(); return; }
  if (!app.querySelector('#nav')) {
    app.className = 'app';
    app.innerHTML = '<nav id="nav" class="pane"></nav><section id="list" class="pane"></section><section id="read" class="pane"></section>';
  }
  // Het zoekveld en het regelformulier behouden focus en cursor als er opnieuw getekend wordt.
  const active = root.activeElement as HTMLInputElement | null;
  const keep = active && (active.id === 'q' || active.id in RULE_FIELDS) ? { id: active.id, at: caret(active) } : null;
  app.classList.toggle('wide', WIDE(S.view) && !S.q);
  $('#nav').innerHTML = navHTML();
  $('#list').innerHTML = listHTML();
  $('#read').innerHTML = readHTML();
  if (keep) {
    const el = $(`#${keep.id}`) as HTMLInputElement | null;
    el?.focus();
    if (el && keep.at !== null) try { el.setSelectionRange(keep.at, keep.at); } catch { /* dit soort veld kent geen cursorpositie */ }
  }
}

/* ---------- acties op threads ---------- */

async function withLogin(fn: () => Promise<unknown>) {
  if (S.busy) return;
  S.busy = true; S.error = ''; render();
  try { await fn(); }
  catch (e) { S.error = (e as Error).message; }
  finally { S.busy = false; render(); }
}

/**
 * Eén actie op een of meer threads, met ongedaan maken.
 * `leaves`: de threads horen daarna niet meer in deze lijst.
 */
async function act(ids: string[], o: { run: (id: string) => Promise<unknown>; undo: (id: string) => Promise<unknown>; msg: string; leaves: boolean }) {
  const account = S.account;
  if (!account || !ids.length) return;
  const index = S.threads.findIndex((x) => ids.includes(x.id));
  const openHit = !!S.open && ids.includes(S.open);
  try { await Promise.all(ids.map(o.run)); }
  catch (e) { fail(e); loadList(); return; }
  if (o.leaves) S.threads = S.threads.filter((x) => !ids.includes(x.id));
  if (S.sel) { S.sel = null; }
  toast(o.msg, async () => {
    await Promise.all(ids.map(o.undo)).catch(fail);
    if (S.account !== account) return;
    await loadList();
    if (openHit && ids.length === 1) openThread(ids[0]);
  });
  if (openHit && o.leaves) openNext(Math.max(index, 0));
  else if (openHit) refreshThread();
  else render();
}

const plural = (ids: string[], one: string, many: string) => ids.length === 1 ? one : `${ids.length} ${many}`;

function done(ids: string[]) {
  const account = S.account!;
  // Een afgegane herinnering is hiermee afgehandeld; een toekomstige blijft staan.
  ids.forEach((id) => { if (R.get(account, id)?.fired) R.markDone(account, id).catch(fail); });
  const saved = ids.length === 1 && (S.thread?.id === ids[0] ? S.thread.saved : S.threads.find((x) => x.id === ids[0])?.saved);
  return act(ids, {
    run: (id) => setInInbox(account, id, false), undo: (id) => setInInbox(account, id, true),
    msg: saved ? 'Afgehandeld. De thread blijft in Opgeslagen.' : plural(ids, 'Afgehandeld', 'threads afgehandeld'), leaves: inNewView(),
  });
}

/* ---------- opgeslagen en herinneringen ---------- */

async function toggleSaved() {
  const t = S.thread, account = S.account;
  if (!t || !account) return;
  const on = !t.saved;
  try { await setSaved(account, t.id, on); } catch (e) { fail(e); render(); return; }
  t.saved = on;
  const row = S.threads.find((x) => x.id === t.id);
  if (row) row.saved = on;
  if (S.view === 'STARRED' && !S.q && !on) S.threads = S.threads.filter((x) => x.id !== t.id);
  toast(on ? 'Opgeslagen. Nieuwe antwoorden komen in deze thread én in Nieuw.' : 'Niet meer opgeslagen');
  render();
}

function askNotify() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

async function remindThread(t: Thread, at: number) {
  const account = S.account!;
  const who = t.messages.filter((m) => !m.me).at(-1)?.from ?? t.messages.at(-1)?.to ?? '';
  try { await R.set(account, t.id, at, t.subject, who); } catch (e) { fail(e); render(); return; }
  S.menu = null;
  toast(`Herinnering ingesteld: ${R.fmt(at)} (staat in je agenda)`);
  askNotify();
  if (S.view === REMIND) loadList(); else render();
}

/** Afgegane herinneringen: thread terug in Nieuw, ongelezen, met een geel label. */
let firing = false;
async function fireDue() {
  if (firing) return;
  firing = true;
  try {
    if (!S.account) return;
    for (const r of R.due(S.account)) {
      try { await setInInbox(r.account, r.threadId, true); await markUnread(r.account, r.threadId); }
      catch { continue; }  // bijv. sessie verlopen: volgende keer opnieuw
      await R.markFired(r.account, r.threadId).catch(() => {});
      toast(`Herinnering: ${r.subject}`);
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('Herinnering', { body: r.subject, tag: r.threadId }); } catch { /* niet ondersteund */ }
      }
      if (r.account === S.account && (inNewView() || S.view === REMIND)) await loadList(); else render();
    }
  } finally { firing = false; }
}
/**
 * Welke threads staan nu in Nieuw? Prullenbak en spam halen ze daar uit, en Gmail zet ze
 * bij terugzetten niet vanzelf terug. Zo kan ongedaan maken de oude toestand herstellen.
 */
async function inboxBefore(ids: string[]): Promise<Set<string>> {
  if (inNewView()) return new Set(ids);
  const known = (id: string) => S.thread?.id === id ? S.thread.inInbox : undefined;
  const flags = await Promise.all(ids.map(async (id) => known(id) ?? inInbox(S.account!, id)));
  return new Set(ids.filter((_, i) => flags[i]));
}

async function trash(ids: string[]) {
  let inbox: Set<string>;
  try { inbox = await inboxBefore(ids); } catch (e) { fail(e); render(); return; }
  return act(ids, {
    run: (id) => setTrash(S.account!, id, true),
    undo: async (id) => { await setTrash(S.account!, id, false); if (inbox.has(id)) await setInInbox(S.account!, id, true); },
    msg: plural(ids, 'In de prullenbak', 'threads in de prullenbak'), leaves: S.view !== 'TRASH' || !!S.q,
  });
}
function untrash(ids: string[]) {
  return act(ids, {
    run: (id) => setTrash(S.account!, id, false), undo: (id) => setTrash(S.account!, id, true),
    msg: plural(ids, 'Teruggezet', 'threads teruggezet'), leaves: S.view === 'TRASH' && !S.q,
  });
}
async function spam(ids: string[], on: boolean) {
  if (!on) {
    // "Geen spam": terug in Nieuw, zoals Gmail doet. Ongedaan maken = weer spam.
    return act(ids, {
      run: (id) => setSpam(S.account!, id, false), undo: (id) => setSpam(S.account!, id, true),
      msg: 'Geen spam, terug in Nieuw', leaves: S.view === 'SPAM' && !S.q,
    });
  }
  let inbox: Set<string>;
  try { inbox = await inboxBefore(ids); } catch (e) { fail(e); render(); return; }
  return act(ids, {
    run: (id) => setSpam(S.account!, id, true),
    undo: async (id) => { await setLabel(S.account!, id, 'SPAM', false); if (inbox.has(id)) await setInInbox(S.account!, id, true); },
    msg: 'Gemarkeerd als spam', leaves: S.view !== 'SPAM' || !!S.q,
  });
}

async function unread(ids: string[]) {
  const account = S.account;
  if (!account) return;
  try { await Promise.all(ids.map((id) => markUnread(account, id))); } catch (e) { fail(e); render(); return; }
  S.threads.forEach((t) => { if (ids.includes(t.id)) t.unread = true; });
  S.sel = null;
  toast(plural(ids, 'Gemarkeerd als ongelezen', 'threads gemarkeerd als ongelezen'));
  if (S.open && ids.includes(S.open)) closeThread();  // openen zou hem meteen weer gelezen maken
  render();
}

async function bulkLabel(label: string) {
  const account = S.account, ids = [...(S.sel ?? [])];
  if (!account || !ids.length) return;
  try { await Promise.all(ids.map((id) => setLabel(account, id, label, true))); } catch (e) { fail(e); render(); return; }
  S.threads.forEach((t) => { if (ids.includes(t.id) && !t.labels.includes(label)) t.labels = [...t.labels, label]; });
  S.sel = null;
  toast(`${plural(ids, '1 thread', 'threads')} in map ${labelName(label)}`);
  render();
}

/** Taak in het werk-OS met een link terug naar deze thread (opent hier in de Mail-tab). */
function makeTask() {
  const t = S.thread;
  if (!t) return;
  const from = t.messages.filter((m) => !m.me).at(-1)?.from ?? '';
  const title = hooks.makeTask({ subject: t.subject, from, threadId: t.id, url: `${location.origin}/mail#mail-${encodeURIComponent(t.id)}` });
  toast(`Taak gemaakt: ${title}`);
}

/** Punt op een bespreeklijst: onderwerp en afzender, zodat je weet waar het over ging. */
function discussTo(groupId: string) {
  const t = S.thread;
  if (!t) return;
  const from = t.messages.filter((m) => !m.me).at(-1)?.from;
  const group = hooks.addPoint(groupId, `${t.subject}${from ? ` (mail van ${from})` : ''}`);
  S.menu = null;
  toast(`Op de bespreeklijst van ${group}`);
  render();
}

/** Gmail-concept weggooien, met ongedaan maken (zet het concept opnieuw in Gmail). */
async function dropGmailDraft() {
  const d = current(), account = S.account;
  if (!d?.gmailDraftId || !account) return;
  clearTimeout(saveTimers.get(d));
  await d.saving?.catch(() => {});
  const back: Outgoing = {
    to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, text: d.body,
    html: `<div>${esc(d.body).replace(/\n/g, '<br>')}</div>`, threadId: d.threadId ?? undefined,
  };
  try { await deleteDraft(account, d.gmailDraftId); } catch (e) { fail(e); render(); return; }
  if (d.threadId && S.thread) { S.thread.draft = null; S.drafts.set(d.threadId, draftFor(S.thread, 'reply', account)); }
  else { S.compose = null; pane('list'); }
  const row = S.threads.find((x) => x.id === (d.threadId ?? S.open));
  if (row) row.draft = false;
  if (S.view === 'DRAFT' && !S.q) { S.threads = S.threads.filter((x) => x.id !== (d.threadId ?? S.open)); closeThread(); }
  render();
  toast('Concept weggegooid', async () => {
    try { await createDraft(account, back); } catch (e) { fail(e); }
    await loadList();
    if (d.threadId) openThread(d.threadId);
  });
}

async function toggleLabel(id: string) {
  const t = S.thread, account = S.account;
  if (!t || !account) return;
  const on = !t.labels.includes(id);
  try { await setLabel(account, t.id, id, on); } catch (e) { fail(e); render(); return; }
  t.labels = on ? [...t.labels, id] : t.labels.filter((l) => l !== id);
  const row = S.threads.find((x) => x.id === t.id);
  if (row) row.labels = t.labels;
  if (S.view === id && !S.q && !on) S.threads = S.threads.filter((x) => x.id !== t.id);
  toast(on ? `In map ${labelName(id)}` : `Uit map ${labelName(id)}`);
  // Zoals in het prototype: na het kiezen van een map aanbieden er een regel van te maken.
  const from = t.messages.filter((m) => !m.me).at(-1)?.fromEmail;
  if (on && from) { S.ask = { label: id, from }; S.menu = 'ask'; }
  render();
}

/* ---------- versturen ---------- */

/* ---------- gepland verzenden (via de server; verstuurt ook als de app dicht is) ---------- */

interface Scheduled {
  id: string; sendAt: number | null; status: string; error: string | null; threadId: string | null;
  draft: { mode: Mode; to: string; cc: string; bcc: string; subject: string; body: string; threadId: string | null } | null;
}

function planPresets() {
  const d = (days: number, h: number) => { const x = new Date(); x.setDate(x.getDate() + days); x.setHours(h, 0, 0, 0); return x.getTime(); };
  const mon = ((8 - new Date().getDay()) % 7) || 7;
  return [{ label: 'Morgen 08:00', at: d(1, 8) }, { label: 'Maandag 08:00', at: d(mon, 8) }];
}

async function loadScheduled() {
  const session = S.account && serverSession(S.account);
  if (!session) { S.scheduled = []; S.listState = 'ready'; render(); return; }
  S.listState = 'loading'; render();
  try { S.scheduled = (await serverPost<{ items: Scheduled[] }>('/schedule/list', session)).items; S.listState = 'ready'; }
  catch (e) { fail(e); S.listState = 'error'; }
  render();
}

function scheduledHTML() {
  if (!S.account || !serverSession(S.account)) return '<div class="none">Gepland verzenden werkt zodra je via de server bent ingelogd (uitloggen en opnieuw inloggen).</div>';
  if (!S.scheduled.length) return '<div class="none">Niets ingepland. Kies “Plan” in het schrijfvenster.</div>';
  return S.scheduled.map((x) => `<div class="item sched">
    <span class="r1"><span class="who">${esc(x.draft?.to || '(geen ontvanger)')}</span><span class="time">${x.sendAt ? R.fmt(x.sendAt) : ''}</span></span>
    <span class="sub">${esc(x.draft?.subject || '(geen onderwerp)')}</span>
    <span class="snip">${x.status === 'error' ? `Versturen mislukt: ${esc(x.error ?? '')}` : `Wordt verstuurd ${x.sendAt ? R.fmt(x.sendAt) : ''}`}</span>
    <span class="chips"><button class="link" data-a="unschedule" data-v="${esc(x.id)}">Annuleer en bewerk</button></span></div>`).join('');
}

async function scheduleSend(at: number) {
  const d = current(), account = S.account;
  if (!d || !account) return;
  const session = serverSession(account);
  if (!session) { toast('Gepland verzenden werkt zodra je via de server bent ingelogd'); return; }
  if (!d.to.trim()) { toast('Vul in aan wie je de e-mail stuurt'); focus('#c-to'); return; }
  if (!d.body.trim() && d.mode !== 'fwd') { toast('Schrijf eerst een bericht'); focus('#c-body'); return; }
  const t = d.threadId && S.thread?.id === d.threadId ? S.thread : null;
  const out = outgoing(d, t, S.sig);
  clearTimeout(saveTimers.get(d));
  try {
    if (d.mode === 'fwd' && t) out.attachments = [...(out.attachments ?? []), ...await originalFiles(account, t)];
    await serverPost('/schedule', {
      ...session, raw: rawMessage(out), threadId: out.threadId ?? null, sendAt: at,
      draft: { mode: d.mode, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, body: d.body, threadId: d.threadId },
    });
  } catch (e) { toast((e as Error).message); return; }
  // Concept uit beeld en uit Gmail; het staat nu op de server.
  await d.saving?.catch(() => {});
  if (d.gmailDraftId) deleteDraft(account, d.gmailDraftId).catch(() => {});
  if (d.threadId && t) S.drafts.set(d.threadId, draftFor(t, 'reply', account)); else S.compose = null;
  S.planOpen = false;
  toast(`Ingepland voor ${R.fmt(at)}. Wordt verstuurd, ook als de app dicht is.`);
  render();
}

async function unschedule(id: string) {
  const session = S.account && serverSession(S.account);
  if (!session) return;
  try {
    const { draft } = await serverPost<{ draft: Scheduled['draft'] }>('/schedule/cancel', { ...session, id });
    S.scheduled = S.scheduled.filter((x) => x.id !== id);
    toast('Niet meer ingepland; het bericht staat weer open');
    if (draft?.threadId) {
      await openThread(draft.threadId);
      if (S.thread) S.drafts.set(draft.threadId, { ...draftFor(S.thread, draft.mode === 'new' ? 'reply' : draft.mode, S.account!), ...draft, threadId: draft.threadId });
    } else if (draft) { S.compose = { ...emptyDraft(), ...draft, threadId: null, mode: 'new' }; pane('read'); }
    render();
  } catch (e) { fail(e); render(); }
}

/* ---------- concepten bewaren in Gmail (ook zichtbaar op telefoon en voor Claude) ---------- */

const saveTimers = new WeakMap<Draft, number>();
const SAVE_DELAY = 1500;

function setSaveStatus(d: Draft, text: string) {
  if (current() === d) { const el = root.getElementById('c-status'); if (el) el.textContent = text; }
}

/** Na typen even wachten en dan bewaren; elke toetsaanslag schuift het op. */
function scheduleSave(d: Draft) {
  clearTimeout(saveTimers.get(d));
  saveTimers.set(d, window.setTimeout(() => { d.saving = saveDraft(d); }, SAVE_DELAY));
}

async function saveDraft(d: Draft) {
  const account = S.account;
  if (!account) return;
  await d.saving?.catch(() => {});  // niet twee keer tegelijk aanmaken
  if (!d.body.trim() && !d.subject.trim() && !d.to.trim()) return;
  const t = d.threadId && S.thread?.id === d.threadId ? S.thread : null;
  if (d.threadId && !t) return;
  setSaveStatus(d, 'Bewaren…');
  try {
    const out = outgoing(d, t, S.sig, true);
    if (d.gmailDraftId) await updateDraft(account, d.gmailDraftId, out);
    else d.gmailDraftId = (await createDraft(account, out)).id;
    d.savedAt = Date.now();
    setSaveStatus(d, `Bewaard in Gmail ${when(d.savedAt)}`);
  } catch (e) {
    setSaveStatus(d, 'Niet bewaard');
    if (e instanceof LoginNeeded) { fail(e); render(); }
  }
}

/** Het concept dat nu in beeld is. */
const current = (): Draft | null => S.compose ?? (S.open ? S.drafts.get(S.open) ?? null : null);

// render() tekent synchroon, dus het veld bestaat al.
function focus(sel: string) { root.querySelector<HTMLElement>(sel)?.focus(); }

function sendDraft() {
  const d = current(), account = S.account;
  if (!d || !account) return;
  if (!d.to.trim()) { toast('Vul in aan wie je de e-mail stuurt'); focus('#c-to'); return; }
  if (!d.body.trim() && d.mode !== 'fwd') { toast('Schrijf eerst een bericht'); focus('#c-body'); return; }
  const remAt = d.rem === 'custom' ? new Date(d.remAt).getTime() : d.rem ? R.SEND_PRESETS[d.rem]?.() ?? NaN : 0;
  if (d.rem && (Number.isNaN(remAt) || remAt <= Date.now())) { toast('Kies een tijdstip in de toekomst voor de herinnering'); focus('#c-remat'); return; }
  const t = d.threadId && S.thread?.id === d.threadId ? S.thread : null;
  const out = outgoing(d, t, S.sig);
  const total = (out.attachments ?? []).reduce((n, f) => n + f.size, 0);
  if (total > MAX_SEND_BYTES) { toast(`Bijlagen samen ${kb(total)}; Gmail staat maximaal 25 MB toe`); return; }
  clearTimeout(saveTimers.get(d));
  // Concept uit beeld halen; bij ongedaan maken of een fout komt het terug.
  const restore = () => {
    if (d.threadId) S.drafts.set(d.threadId, d); else { S.compose = d; pane('read'); }
    render();
  };
  if (d.threadId && t) S.drafts.set(d.threadId, draftFor(t, 'reply', account));
  else if (d.threadId) S.drafts.delete(d.threadId);
  else S.compose = null;
  render();
  let cancelled = false;
  const timer = window.setTimeout(async () => {
    if (cancelled) return;
    try {
      if (d.mode === 'fwd' && t) out.attachments = [...(out.attachments ?? []), ...await originalFiles(account, t)];
      const sent = await send(account, out);
      // Concept is verstuurd: uit Gmail halen (eerst een lopende bewaar-actie laten afronden).
      d.saving?.catch(() => {}).finally(() => { if (d.gmailDraftId) deleteDraft(account, d.gmailDraftId).catch(() => {}); });
      if (remAt) {
        R.set(account, sent.threadId, remAt, t?.subject ?? out.subject, d.to).catch(fail);
        askNotify();
      }
      const remNote = remAt ? `, herinnering ${R.fmt(remAt)}` : '';
      // Zoals in het prototype: een beantwoorde thread gaat uit Nieuw.
      const wasNew = !!t?.inInbox && (d.mode === 'reply' || d.mode === 'all');
      if (wasNew) {
        await setInInbox(account, t!.id, false);
        if (inNewView()) S.threads = S.threads.filter((x) => x.id !== t!.id);
        toast(`Verstuurd en uit Nieuw gehaald${remNote}`, async () => {
          await setInInbox(account, t!.id, true).catch(fail);
          if (S.account === account && inNewView()) loadList();
          else refreshThread();
        });
      } else toast(`Verstuurd${remNote}`);
      if (d.threadId && S.open === d.threadId) refreshThread(); else render();
    } catch (e) {
      fail(e); restore();
      toast('Versturen mislukt. Je bericht staat er weer.');
    }
  }, SEND_DELAY);
  toast('Wordt verstuurd…', () => { cancelled = true; clearTimeout(timer); restore(); toast('Niet verstuurd. Je bericht staat er weer.'); });
}

/* ---------- knoppen ---------- */

const openIds = () => (S.open ? [S.open] : []);

const actions: Record<string, (v: string) => unknown> = {
  connect: () => withLogin(connectGoogle),
  retry: () => { void start(); },
  settings: () => hooks.openSettings(),
  task: () => makeTask(),
  discussto: (v) => discussTo(v),
  view: (v) => showList(v),
  more: () => { S.more = true; render(); },
  keys: () => { S.keys = !S.keys; render(); },
  images: (v) => { S.images.add(v); render(); },
  quote: (v) => { if (S.quotes.has(v)) S.quotes.delete(v); else S.quotes.add(v); render(); },
  att: (v) => downloadAttachment(v),
  plan: () => { S.planOpen = !S.planOpen; render(); },
  planat: (v) => {
    const at = v ? Number(v) : new Date(($('#c-planat') as HTMLInputElement | null)?.value ?? '').getTime();
    if (!at || Number.isNaN(at)) { toast('Kies eerst een datum en tijd'); focus('#c-planat'); return; }
    if (at <= Date.now() + 60_000) { toast('Kies een tijdstip in de toekomst'); return; }
    scheduleSend(at);
  },
  unschedule: (v) => unschedule(v),
  rmatt: (v) => { const d = current(); if (d?.att) { d.att.splice(Number(v), 1); render(); } },
  clearq: () => showList(S.view),
  onlyunread: (v) => {
    S.unreadOnly = v === '1';
    try { localStorage.setItem(UNREAD_KEY, S.unreadOnly ? '1' : '0'); } catch { /* alleen voor nu */ }
    S.threads = []; S.sel = null; loadList();
  },
  addmap: () => { S.addingMap = true; render(); focus('#newmap'); },
  reload: () => { loadList(); loadMeta(); },
  open: (v) => openThread(v),
  exp: (v) => { const i = Number(v); if (S.exp.has(i)) S.exp.delete(i); else S.exp.add(i); render(); },
  pane: (v) => pane(v as Pane),
  done: () => done(openIds()),
  trash: () => trash(openIds()),
  untrash: () => untrash(openIds()),
  spam: () => spam(openIds(), true),
  unspam: () => spam(openIds(), false),
  unread: () => unread(openIds()),
  tonew: async () => {
    const t = S.thread, account = S.account;
    if (!t || !account) return;
    try { await setInInbox(account, t.id, true); t.inInbox = true; toast('Terug in Nieuw'); if (inNewView()) loadList(); else render(); }
    catch (e) { fail(e); render(); }
  },
  menu: (v) => { S.menu = S.menu === v ? null : v as 'map' | 'more' | 'remind' | 'ask' | 'discuss'; render(); },
  save: () => toggleSaved(),
  dropdraft: () => dropGmailDraft(),
  mkrule: async () => {
    const ask = S.ask, account = S.account;
    if (!ask || !account) return;
    try { const r = await createRule(account, { from: ask.from, label: ask.label, skipInbox: false }); S.rules = [...S.rules, r]; toast(`Regel gemaakt: ${ask.from} → ${labelName(ask.label)}`); }
    catch (e) { fail(e); }
    S.ask = null; S.menu = null; render();
  },
  delrule: async (v) => {
    const r = S.rules.find((x) => x.id === v), account = S.account;
    if (!r?.simple || !account) return;  // filters die de app niet kan beschrijven laat hij met rust
    const spec = r.simple;
    S.error = '';
    try { await deleteRule(account, v); } catch (e) { fail(e); render(); return; }
    S.rules = S.rules.filter((x) => x.id !== v);
    toast('Regel verwijderd', async () => {
      try { const back = await createRule(account, spec); S.rules = [...S.rules, back]; } catch (e) { fail(e); }
      render();
    });
    render();
  },
  remind: (v) => { if (S.thread) remindThread(S.thread, Number(v)); },
  remindat: () => {
    const v = ($('#remat') as HTMLInputElement | null)?.value, at = v ? new Date(v).getTime() : NaN;
    if (!v || Number.isNaN(at)) { toast('Kies eerst een datum en tijd'); focus('#remat'); return; }
    if (at <= Date.now()) { toast('Kies een tijdstip in de toekomst'); return; }
    if (S.thread) remindThread(S.thread, at);
  },
  unremind: () => {
    if (!S.thread || !S.account) return;
    R.remove(S.account, S.thread.id).then(() => {
      S.menu = null; toast('Herinnering verwijderd');
      if (S.view === REMIND) loadList(); else render();
    }, (e) => { fail(e); render(); });
  },
  label: (v) => toggleLabel(v),
  selmode: () => { S.sel = S.sel ? null : new Set(); render(); },
  pick: (v) => { if (!S.sel) return; if (S.sel.has(v)) S.sel.delete(v); else S.sel.add(v); render(); },
  selall: () => { if (S.sel) { S.sel = new Set(S.threads.map((t) => t.id)); render(); } },
  bulk: (v) => {
    const ids = [...(S.sel ?? [])];
    if (!ids.length) return;
    if (v === 'done') done(ids);
    else if (v === 'trash') trash(ids);
    else if (v === 'untrash') untrash(ids);
    else if (v === 'unread') unread(ids);
  },
  compose: () => { S.compose = emptyDraft(); S.menu = null; pane('read'); render(); focus('#c-to'); },
  discard: () => {
    if (S.compose?.gmailDraftId) return dropGmailDraft();
    if (S.compose) clearTimeout(saveTimers.get(S.compose));
    S.compose = null; pane('list'); render();
  },
  mode: (v) => {
    const t = S.thread, d = current();
    if (!t || !d || !S.account) return;
    const next = { ...draftFor(t, v as Exclude<Mode, 'new'>, S.account, d.body), gmailDraftId: d.gmailDraftId, att: d.att };
    S.drafts.set(t.id, next); scheduleSave(next);
    render(); focus(v === 'fwd' ? '#c-to' : '#c-body');
  },
  cc: () => { const d = current(); if (d) { d.showCc = true; render(); focus('#c-cc'); } },
  send: () => sendDraft(),
  undo: () => { const u = toastUndo; toastUndo = null; $('#toast').hidden = true; u?.(); },
};

const on_click = ((ev: Event) => {
  const el = (ev.target as Element).closest<HTMLElement>('[data-a]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  actions[el.dataset.a!]?.(el.dataset.v ?? '');
});

/* ---------- sneltoetsen (zoals in Gmail) ---------- */

const SHORTCUTS: [string, string][] = [
  ['E', 'Klaar'], ['R', 'Beantwoorden'], ['A', 'Allen beantwoorden'], ['F', 'Doorsturen'],
  ['C', 'Nieuwe e-mail'], ['J / K', 'Volgende / vorige thread'], ['/', 'Zoeken'],
  ['Backspace', 'Verwijderen'], ['Esc', 'Terug / menu sluiten'], ['?', 'Dit overzicht'],
];

/** Volgende (+1) of vorige (-1) thread in de lijst openen; zonder open thread de eerste. */
function step(dir: 1 | -1) {
  const i = S.threads.findIndex((t) => t.id === S.open);
  const next = i < 0 ? S.threads[0] : S.threads[i + dir];
  if (next) openThread(next.id);
}

/** Schrijfvenster van de open thread in een modus zetten en erheen springen. */
function replyMode(mode: Exclude<Mode, 'new'>) {
  const t = S.thread, d = current();
  if (!t || !S.account || t.inTrash || t.inSpam) return;
  const next = { ...draftFor(t, mode, S.account, d?.body ?? ''), gmailDraftId: d?.gmailDraftId, att: d?.att };
  S.drafts.set(t.id, next); scheduleSave(next);
  pane('read'); render();
  const field = mode === 'fwd' ? '#c-to' : '#c-body';
  root.querySelector(field)?.scrollIntoView({ block: 'center' });
  focus(field);
}

// Niet tijdens typen (behalve Esc), niet met Cmd/Ctrl/Alt, en alleen bij een Gmail-account.
const on_keydown = ((ev: KeyboardEvent) => {
  if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  // Een venster van de todo-app zelf (taakdetail, zoeken) heeft voorrang.
  if (document.querySelector('[role="dialog"]')) return;
  const target = (ev.composedPath()[0] ?? ev.target) as HTMLElement;
  const typing = !!target.closest?.('input, textarea, select, [contenteditable]');
  if (ev.key === 'Escape') {
    if (typing) target.blur();
    else if (S.menu) { S.menu = null; render(); }
    else if (narrow() && appEl.dataset.pane === 'read') pane('list');
    else return;
    ev.preventDefault();
    return;
  }
  if (typing || !gmailAccount() || ev.repeat) return;
  const open = S.thread && S.thread.id === S.open ? S.thread : null;
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  switch (key) {
    case 'Backspace': case 'Delete': {
      // Open thread of de geselecteerde threads naar de prullenbak; niet in de prullenbak zelf.
      const ids = S.sel?.size ? [...S.sel] : open && !open.inTrash && !S.compose ? [open.id] : [];
      if (!ids.length || (S.view === 'TRASH' && !S.q)) return;
      trash(ids);
      break;
    }
    case 'e': {
      if (S.sel?.size && inNewView()) done([...S.sel]);
      else if (open?.inInbox && !S.compose) done([open.id]);
      else return;
      break;
    }
    case 'r': if (!open || S.compose) return; replyMode('reply'); break;
    case 'a': if (!open || S.compose) return; replyMode('all'); break;
    case 'f': if (!open || S.compose) return; replyMode('fwd'); break;
    case 'c': actions.compose(''); break;
    case 'j': step(1); break;
    case 'k': step(-1); break;
    case '/': {
      if (WIDE(S.view)) showList(INBOX);
      pane('list'); render(); focus('#q');
      break;
    }
    case '?': S.keys = !S.keys; if (narrow()) pane('nav'); render(); break;
    default: return;
  }
  ev.preventDefault();
});

// Typen in het schrijfvenster: alleen opslaan, niet opnieuw tekenen (anders verspringt de cursor).
const FIELDS: Record<string, keyof Draft> = { 'c-to': 'to', 'c-cc': 'cc', 'c-bcc': 'bcc', 'c-subject': 'subject', 'c-body': 'body', 'c-remat': 'remAt' };
const RULE_FIELDS: Record<string, 'from' | 'subject' | 'body' | 'forward'> = { 'r-from': 'from', 'r-subject': 'subject', 'r-body': 'body', 'r-forward': 'forward' };
const on_input = ((ev: Event) => {
  const el = ev.target as HTMLInputElement;
  if (el.id === 'q') { S.qInput = el.value; if (!el.value && S.q) showList(S.view); return; }
  // Typen in het regelformulier: alleen onthouden, niet opnieuw tekenen.
  const rule = RULE_FIELDS[el.id];
  if (rule) { S.ruleDraft[rule] = el.value; return; }
  const key = FIELDS[el.id], d = current();
  if (key && d) { (d as unknown as Record<string, string>)[key] = el.value; if (key !== 'remAt') scheduleSave(d); }
});

const on_change = ((ev: Event) => {
  const el = ev.target as HTMLSelectElement;
  if (el.id === 'bulkmap' && el.value) bulkLabel(el.value);
  if (el.id === 'c-file') addFiles((el as unknown as HTMLInputElement).files);
  if (el.id === 'r-act') { S.ruleDraft.act = el.value === 'forward' ? 'forward' : 'label'; render(); focus(S.ruleDraft.act === 'forward' ? '#r-forward' : '#r-label'); }
  if (el.id === 'r-label') S.ruleDraft.label = el.value;
  if (el.id === 'r-skip') S.ruleDraft.skip = (el as unknown as HTMLInputElement).checked;
  if (el.id === 'c-rem') { const d = current(); if (d) { d.rem = el.value; render(); if (d.rem === 'custom') focus('#c-remat'); } }
});

const on_submit = (async (ev: Event) => {
  const form = ev.target as HTMLElement;
  if (form.id === 'searchform') {
    ev.preventDefault();
    const q = S.qInput.trim();
    showList(S.view, q);
    ($('#q') as HTMLInputElement | null)?.blur();  // toetsenbord op telefoon dicht
    return;
  }
  if (form.id === 'vacform') { ev.preventDefault(); saveVacation(); return; }
  if (form.id === 'ruleform') {
    ev.preventDefault();
    const account = S.account, spec = draftRule(), problem = ruleProblem(spec);
    if (!account) return;
    if (problem) { toast(problem.message); focus(`#r-${problem.field}`); return; }
    S.error = '';
    try {
      const r = await createRule(account, spec);
      S.rules = [...S.rules, r];
      S.ruleDraft = { ...S.ruleDraft, from: '', subject: '', body: '', forward: '', skip: false };
      toast(spec.forward ? `Regel toegevoegd: nieuwe mail die past gaat door naar ${spec.forward}` : 'Regel toegevoegd');
    }
    catch (e) { fail(e); }
    render();
    return;
  }
  if (form.id !== 'mapform') return;
  ev.preventDefault();
  const name = ($('#newmap') as HTMLInputElement).value.trim(), account = S.account;
  if (!name || !account) { S.addingMap = false; render(); return; }
  try {
    const l = await createLabel(account, name);
    S.labels = [...S.labels, l].sort((a, b) => a.name.localeCompare(b.name, 'nl'));
    toast(`Map ${l.name} gemaakt`);
  } catch (e) { fail(e); }
  S.addingMap = false; render();
});

/* ---------- start ---------- */

let started = false;

/** Toegang bepalen en (opnieuw) laden. */
async function start() {
  access = null; S.error = ''; render();
  access = await checkAccess();
  if (!access.ok) { S.account = null; render(); return; }
  const first = S.account !== access.email;
  S.account = access.email;
  render();
  const raw = /^#mail-(.+)$/.exec(location.hash)?.[1];
  const fromHash = raw ? decodeURIComponent(raw) : undefined;
  if (first) loadMeta();
  await loadList();
  if (fromHash && !S.needLogin) openThread(fromHash);
  else if (fromHash) { S.open = fromHash; render(); }
  fireDue();
}

/**
 * Tekent de mail in `el` (een Shadow DOM met eigen stijlen) en start luisteraars en herinneringen.
 * Geeft een opruimfunctie terug; de toestand blijft bewaard voor de volgende keer.
 */
export function mountMail(el: HTMLElement, h: MailHooks, theme: string): () => void {
  host = el; hooks = h;
  host.dataset.theme = theme;
  root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${css}</style><main id="app"></main><div id="toast" role="status" hidden></div>`;
  appEl = root.getElementById('app') as HTMLElement;
  pane(narrow() && (S.open || S.compose) ? 'read' : 'list');

  root.addEventListener('click', on_click);
  root.addEventListener('input', on_input);
  root.addEventListener('change', on_change);
  root.addEventListener('submit', on_submit);
  root.addEventListener('load', on_load, true);
  document.addEventListener('keydown', on_keydown);
  const onVisible = () => { if (!document.hidden) fireDue(); };
  document.addEventListener('visibilitychange', onVisible);
  const timer = window.setInterval(() => { fireDue(); void loadCounts(); }, 30_000);
  // Bij wisselen tussen breed en smal: smal de open thread laten zien, anders de lijst.
  let wasNarrow = narrow();
  const ro = new ResizeObserver(() => {
    if (narrow() === wasNarrow) return;
    wasNarrow = narrow();
    pane(wasNarrow && (S.open || S.compose) ? 'read' : 'list');
  });
  ro.observe(host);

  if (!started || !S.account) { started = true; void start(); }
  else {
    render();
    void loadList();
    // via een link uit een taak (…/mail#mail-<id>): die thread openen
    const raw = /^#mail-(.+)$/.exec(location.hash)?.[1];
    if (raw && decodeURIComponent(raw) !== S.open) void openThread(decodeURIComponent(raw));
  }

  return () => {
    root.removeEventListener('click', on_click);
    root.removeEventListener('input', on_input);
    root.removeEventListener('change', on_change);
    root.removeEventListener('submit', on_submit);
    root.removeEventListener('load', on_load, true);
    document.removeEventListener('keydown', on_keydown);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
    ro.disconnect();
    clearTimeout(toastTimer);
  };
}

/** Thema van de todo-app volgen (licht, donker of zoals het apparaat). */
export function setMailTheme(theme: string) { if (host) host.dataset.theme = theme; }
