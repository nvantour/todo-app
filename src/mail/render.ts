// Een HTML-mail veilig tonen: in een afgeschermd kader, zonder scripts.
// Gedeeld door de Mail-tab (mailApp.ts) en de kaarten op de tab Antwoorden.

/** Herkent of er een aangehaalde eerdere mail in zit. */
export const QUOTE = /gmail_quote|<blockquote|divRplyFwdMsg|yahoo_quoted/i;

/**
 * Het document voor in het kader. `images` = afbeeldingen van buiten de mail toestaan;
 * `quote` = de aangehaalde eerdere mail ook tonen.
 */
export function mailDoc(html: string, images: boolean, quote: boolean) {
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
