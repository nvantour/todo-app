// Antwoorden en doorsturen opbouwen: ontvangers, onderwerp, citaat en de HTML-versie.

import type { Message, Outgoing, OutgoingFile, Thread } from './mail';

export type Mode = 'reply' | 'all' | 'fwd' | 'new';

export interface Draft {
  mode: Mode;
  threadId: string | null;  // null = nieuwe e-mail
  to: string; cc: string; bcc: string; showCc: boolean;
  subject: string; body: string;
  rem: string; remAt: string;  // herinnering na verzenden: preset-naam of 'custom' + datum/tijd
  gmailDraftId?: string;       // staat als concept in Gmail (zelf getypt en bewaard, of van Claude); na verzenden weggehaald
  savedAt?: number;            // laatst bewaard in Gmail
  att?: OutgoingFile[];        // bijlagen (gaan pas bij versturen mee, niet in het Gmail-concept)
  saving?: Promise<void>;      // bewaren dat nog loopt
}

/** Adreslijst splitsen op komma's buiten aanhalingstekens. */
export function splitAddrs(v: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (const ch of v) {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const addrOf = (v: string) => (/<([^>]+)>/.exec(v)?.[1] ?? v).trim().toLowerCase();

function uniqueExcept(list: string[], me: string) {
  const seen = new Set<string>([me]);
  return list.filter((a) => { const k = addrOf(a); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

const prefixed = (p: string, s: string) => new RegExp(`^${p}:`, 'i').test(s.trim()) ? s : `${p}: ${s}`;

/**
 * Citaat onder een concept weghalen ("On … wrote:" / "Op … schreef …:" en alles eronder, of een blok "> "-regels).
 * Gmail-concepten (bijv. van Claude) hebben het al; de app zet bij versturen zelf het citaat eronder.
 */
export function stripQuote(body: string): string {
  const lines = body.split('\n');
  const i = lines.findIndex((l, n) =>
    /^\s*(On|Op)\s.+(wrote|schreef[^:]*):\s*$/i.test(l) || (/^>/.test(l) && lines.slice(n).every((x) => !x.trim() || /^>/.test(x))));
  return (i < 0 ? body : lines.slice(0, i).join('\n')).trimEnd();
}

export const emptyDraft = (): Draft => ({ mode: 'new', threadId: null, to: '', cc: '', bcc: '', showCc: false, subject: '', body: '', rem: '', remAt: '' });

/** Concept voor een thread in de gekozen modus; de tekst blijft staan bij wisselen. */
export function draftFor(t: Thread, mode: Exclude<Mode, 'new'>, me: string, body = ''): Draft {
  const others = t.messages.filter((m) => !m.me);
  const last = others[others.length - 1] ?? t.messages[t.messages.length - 1];
  const base = { mode, threadId: t.id, bcc: '', body, showCc: false, rem: '', remAt: '' };
  if (mode === 'fwd') return { ...base, to: '', cc: '', subject: prefixed('Fwd', t.subject) };
  const target = last.me ? splitAddrs(last.toRaw) : splitAddrs(last.replyTo || last.fromRaw);
  if (mode === 'reply') return { ...base, to: uniqueExcept(target, me).join(', '), cc: '', subject: prefixed('Re', t.subject) };
  const to = uniqueExcept([...target, ...splitAddrs(last.toRaw)], me);
  const cc = uniqueExcept(splitAddrs(last.ccRaw), me).filter((a) => !to.some((x) => addrOf(x) === addrOf(a)));
  return { ...base, to: to.join(', '), cc: cc.join(', '), showCc: cc.length > 0, subject: prefixed('Re', t.subject) };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const toHtml = (s: string) => esc(s).replace(/\n/g, '<br>');
const stamp = (m: Message) => new Date(m.date).toLocaleString('nl-NL', { dateStyle: 'long', timeStyle: 'short' });

/** Volledig uitgaand bericht: tekst + handtekening + citaat (antwoord) of doorgestuurd bericht. */
export function outgoing(d: Draft, t: Thread | null, sig: { html: string; text: string }, asDraft = false): Outgoing {
  const lastIn = t?.messages[t.messages.length - 1];
  let text = d.body.trim(), html = `<div>${toHtml(d.body.trim())}</div>`;
  // Als Gmail-concept alleen de eigen tekst bewaren; handtekening en citaat komen er bij versturen onder.
  if (asDraft) return { ...headersFor(d, lastIn), text, html };
  if (sig.text) { text += `\n\n-- \n${sig.text}`; html += `<br><div class="gmail_signature">${sig.html}</div>`; }
  if (lastIn && d.mode === 'fwd') {
    const headerLines = [`Van: ${lastIn.fromRaw}`, `Datum: ${stamp(lastIn)}`, `Onderwerp: ${t!.subject}`, `Aan: ${lastIn.toRaw}`];
    text += `\n\n---------- Doorgestuurd bericht ----------\n${headerLines.join('\n')}\n\n${lastIn.body}`;
    html += `<br><br><div>---------- Doorgestuurd bericht ----------<br>${headerLines.map(toHtml).join('<br>')}<br><br>${toHtml(lastIn.body)}</div>`;
  } else if (lastIn) {
    const intro = `Op ${stamp(lastIn)} schreef ${lastIn.fromRaw}:`;
    text += `\n\n${intro}\n${lastIn.body.split('\n').map((l) => '> ' + l).join('\n')}`;
    html += `<br><div>${toHtml(intro)}<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${toHtml(lastIn.body)}</blockquote></div>`;
  }
  return { ...headersFor(d, lastIn), text, html, attachments: d.att?.length ? d.att : undefined };
}

function headersFor(d: Draft, lastIn: Message | undefined) {
  const replyTo = d.mode === 'reply' || d.mode === 'all';
  const refs = lastIn && replyTo ? [lastIn.references, lastIn.messageId].filter(Boolean).join(' ') : '';
  return {
    // Geen losse komma aan het eind (na aanvullen staat er een komma achter het laatste adres).
    to: splitAddrs(d.to).join(', '), cc: splitAddrs(d.cc).join(', '), bcc: splitAddrs(d.bcc).join(', '), subject: d.subject,
    threadId: replyTo ? d.threadId ?? undefined : undefined,
    inReplyTo: replyTo ? lastIn?.messageId || undefined : undefined,
    references: refs || undefined,
  };
}
