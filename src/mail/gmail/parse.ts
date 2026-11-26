// Gmail-berichten (MIME-boom) omzetten naar leesbare tekst.
// Voorkeur voor de text/plain-versie; anders HTML naar tekst via DOMParser
// (een geparsed document voert geen scripts uit en laadt geen afbeeldingen).

export interface Header { name: string; value: string }
export interface Part {
  mimeType: string;
  filename?: string;
  headers?: Header[];
  body?: { data?: string; size: number; attachmentId?: string };
  parts?: Part[];
}

export const header = (headers: Header[] | undefined, name: string) =>
  headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

function decode(data: string, charset: string) {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

const charsetOf = (p: Part) => /charset="?([^";\s]+)/i.exec(header(p.headers, 'Content-Type'))?.[1] ?? 'utf-8';
const isAttachment = (p: Part) => !!p.filename || /^attachment/i.test(header(p.headers, 'Content-Disposition'));

function find(p: Part, mime: string): Part | null {
  if (p.mimeType === mime && p.body?.data && !isAttachment(p)) return p;
  for (const c of p.parts ?? []) { const f = find(c, mime); if (f) return f; }
  return null;
}

const BLOCK = /^(P|DIV|BR|LI|TR|H[1-6]|BLOCKQUOTE|PRE|TABLE|UL|OL|HR|SECTION|ARTICLE|HEADER|FOOTER)$/;

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,head,title').forEach((n) => n.remove());
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) { out += (n.textContent ?? '').replace(/\s+/g, ' '); return; }
    if (!(n instanceof Element)) return;
    const block = BLOCK.test(n.tagName);
    if (n.tagName === 'BR') { out += '\n'; return; }
    // Tabelregel met korte cellen (handtekening: "M | +31 6 …") op één regel, niet elke cel los.
    if (n.tagName === 'TR') {
      const cells = [...n.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
      if (cells.length > 1 && !n.querySelector('table')) {
        const texts = cells.map((c) => htmlToText(c.innerHTML));
        if (texts.every((t) => !t.includes('\n'))) { out += '\n' + texts.filter(Boolean).join(' ') + '\n'; return; }
      }
    }
    if (block) out += '\n';
    if (n.tagName === 'LI') out += '• ';
    n.childNodes.forEach(walk);
    if (block) out += '\n';
  };
  walk(doc.body);
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function bodyText(payload: Part): string {
  const plain = find(payload, 'text/plain');
  if (plain) return decode(plain.body!.data!, charsetOf(plain)).replace(/\r\n/g, '\n').trim();
  const html = find(payload, 'text/html');
  if (html) return htmlToText(decode(html.body!.data!, charsetOf(html)));
  return '';
}

/** HTML-versie van het bericht (rauw; de app toont die alleen in een afgeschermd kader). */
export function bodyHtml(payload: Part): string {
  const html = find(payload, 'text/html');
  return html ? decode(html.body!.data!, charsetOf(html)) : '';
}

export interface Attachment { name: string; size: number; id?: string; mime?: string }

export function attachments(p: Part, out: Attachment[] = []) {
  if (p.filename && p.body?.attachmentId) out.push({ name: p.filename, size: p.body.size, id: p.body.attachmentId, mime: p.mimeType });
  (p.parts ?? []).forEach((c) => attachments(c, out));
  return out;
}

/** Afbeelding in de mail zelf (src="cid:…"): Content-ID plus waar de bytes staan. */
export interface InlinePart { cid: string; mime: string; id?: string; data?: string }

export function inlineParts(p: Part, out: InlinePart[] = []) {
  const cid = header(p.headers, 'Content-ID').replace(/^\s*<|>\s*$/g, '').trim();
  if (cid && p.mimeType.startsWith('image/') && (p.body?.attachmentId || p.body?.data))
    out.push({ cid, mime: p.mimeType, id: p.body.attachmentId, data: p.body.data });
  (p.parts ?? []).forEach((c) => inlineParts(c, out));
  return out;
}

/** "Naam <adres>" → { name, email } */
export function person(v: string) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(v);
  return m ? { name: m[1].trim() || m[2], email: m[2].toLowerCase() } : { name: v.trim(), email: v.trim().toLowerCase() };
}
