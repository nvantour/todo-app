// Losse logica van de wachter: geen netwerk, geen processen. Te testen met `node --test`.

/** Hoe vaak Claude het per onderdeel mag proberen voordat de wachter het laat liggen. */
export const MAX_ATTEMPTS = 2

/** Sleutel per onderdeel: een antwoord (reply-id) of een emoji (reply-id/emoji-id). */
export const replyKey = (r) => `reply:${r.id}`
export const reactionKey = (x) => `emoji:${x.replyId}/${x.reaction.id}`

/** Wat staat klaar en mag (nog) geprobeerd worden? */
export function pending({ replies = [], reactions = [] }, attempts = {}) {
  const keys = [...replies.map(replyKey), ...reactions.map(reactionKey)]
  return { keys, todo: keys.filter((k) => (attempts[k] ?? 0) < MAX_ATTEMPTS), givenUp: keys.filter((k) => (attempts[k] ?? 0) >= MAX_ATTEMPTS) }
}

/** Na een ronde: wat nog precies zo klaarstaat als ervoor, heeft Claude niet opgepakt → één poging erbij. */
export function countAttempts(before, after, attempts = {}) {
  const still = new Set(after)
  const next = {}
  for (const k of before) if (still.has(k)) next[k] = (attempts[k] ?? 0) + 1
  // Alleen bijhouden wat nog klaarstaat; de rest is afgehandeld.
  for (const k of after) if (!(k in next) && attempts[k]) next[k] = attempts[k]
  return next
}

/** Mislukte onderdelen waar nog geen melding over is geweest. */
export function newFailures(failed, notified = []) {
  const seen = new Set(notified)
  return failed.filter((f) => !seen.has(f.key))
}

/** Waar een klik op een melding naartoe gaat. `app` = bundle-id van de app die de link opent. */
export const TARGETS = {
  teamsChrome: { url: 'https://teams.microsoft.com/v2/', app: 'com.google.Chrome' },
  antwoorden: { url: 'https://work-apps-48770.web.app/antwoorden' },
}

/** Tekst van de melding bij een mislukking, en waar een klik erop naartoe gaat. */
export function failureText(f) {
  if (/niet ingelogd/i.test(f.error ?? '')) {
    if (f.channel === 'teams') {
      // De wachter werkt in Nino's eigen Chrome: daar moet hij inloggen.
      return { title: 'Teams in Chrome: niet ingelogd', body: `Klik hier om in te loggen op Teams in Chrome. Zet daarna de emoji of het antwoord opnieuw. (${f.what})`, target: TARGETS.teamsChrome }
    }
    const where = f.channel === 'slack' ? 'Slack' : f.channel
    return { title: `${where}: niet ingelogd`, body: `Log in op ${where}, dan probeert Claude het opnieuw als je de emoji of het antwoord opnieuw zet. (${f.what})`, target: TARGETS.antwoorden }
  }
  return { title: `${f.what} niet gelukt`, body: `${f.label}: ${f.error ?? 'onbekende fout'}`, target: TARGETS.antwoorden }
}

/** Lua-string met elke byte als \ddd: geen enkel teken uit een melding kan het commando breken. */
export const luaString = (s) => '"' + [...Buffer.from(String(s), 'utf8')].map((b) => '\\' + String(b).padStart(3, '0')).join('') + '"'

/** Het Hammerspoon-commando voor een klikbare melding (functie klikMelding uit klik-melding.lua). */
export function clickNotificationLua(title, body, target) {
  const fields = Object.entries(target).map(([k, v]) => `${k} = ${luaString(v)}`).join(', ')
  return `return klikMelding(${luaString(title)}, ${luaString(body)}, { ${fields} })`
}
