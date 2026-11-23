// Pure logica voor de reply-sender: geen browser, geen netwerk.
// Alles hier is te testen met `node --test`.

export const CHANNELS = ['teams', 'slack']

export const DEFAULT_API_BASE = 'https://work-apps-48770.web.app/api'

// ---------- Opdrachtregel ----------

/** Leest de vlaggen. Onbekende vlaggen geven een fout, zodat typfouten opvallen. */
export function parseArgs(argv) {
  const opts = { login: false, dryRun: false, headful: false, once: false, intervalMs: 15000 }
  for (const arg of argv) {
    if (arg === '--login') opts.login = true
    else if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--headful') opts.headful = true
    else if (arg === '--once') opts.once = true
    else if (arg.startsWith('--interval=')) {
      const s = Number(arg.slice('--interval='.length))
      if (!Number.isFinite(s) || s < 5) throw new Error('--interval moet een getal in seconden zijn (minimaal 5)')
      opts.intervalMs = s * 1000
    } else if (arg === '--help' || arg === '-h') opts.help = true
    else throw new Error(`Onbekende vlag: ${arg}`)
  }
  return opts
}

// ---------- Welke replies pakken we op ----------

/**
 * Bepaalt of een reply verstuurd mag worden.
 * Alleen `approved` + teams/slack. `sending` wordt bewust overgeslagen:
 * dat betekent dat een eerdere poging halverwege is gestopt — Nino lost dat zelf op.
 */
export function shouldProcess(reply, seenIds = new Set()) {
  if (!reply || typeof reply !== 'object') return false
  if (!reply.id || seenIds.has(reply.id)) return false
  if (!CHANNELS.includes(reply.channel)) return false
  return reply.status === 'approved'
}

/** Kijkt of de reply genoeg informatie heeft om te versturen. Geeft een Nederlandse reden terug. */
export function validateReply(reply) {
  if (typeof reply.draft !== 'string' || reply.draft.trim() === '') {
    return { ok: false, error: 'Lege tekst — niets te versturen' }
  }
  const url = reply.target?.url
  if (!url) return { ok: false, error: 'Geen link naar het gesprek (target.url ontbreekt)' }
  const check = checkTargetUrl(url, reply.channel)
  if (!check.ok) return check
  return { ok: true }
}

const TEAMS_HOSTS = ['teams.microsoft.com', 'teams.cloud.microsoft', 'teams.live.com']

/** Alleen https-links naar het juiste product: zo kan een rare link nooit ergens anders typen. */
export function checkTargetUrl(url, channel) {
  let u
  try {
    u = new URL(url)
  } catch {
    return { ok: false, error: 'Link naar het gesprek is ongeldig' }
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'Link naar het gesprek is geen https' }
  const host = u.hostname.toLowerCase()
  if (channel === 'teams') {
    if (!TEAMS_HOSTS.includes(host)) return { ok: false, error: `Link is geen Teams-link (${host})` }
    return { ok: true }
  }
  if (channel === 'slack') {
    if (host !== 'app.slack.com' || !u.pathname.startsWith('/client/')) {
      return { ok: false, error: 'Link is geen Slack-link (verwacht https://app.slack.com/client/...)' }
    }
    return { ok: true, isThread: parseSlackUrl(url)?.thread != null }
  }
  return { ok: false, error: `Onbekend kanaal: ${channel}` }
}

/**
 * Teams-deeplinks (`/l/chat/...`, `/l/message/...`) openen eerst een "download de app"-pagina
 * (launcher) waar de knop "De web-app gebruiken" in een browser zonder scherm niets doet.
 * Daarom openen we meteen de web-app-variant: `https://teams.microsoft.com/_#/l/...`.
 * Getest 2026-11-23: die route gaat direct door naar de web-app (of naar het inlogscherm).
 */
export function teamsWebUrl(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    return url
  }
  if (!TEAMS_HOSTS.includes(u.hostname.toLowerCase())) return url
  // Launcher-link: de echte bestemming staat in ?url=
  if (u.pathname.startsWith('/dl/launcher/')) {
    const inner = u.searchParams.get('url')
    if (inner && inner.startsWith('/')) return `https://teams.microsoft.com${inner}`
    return url
  }
  if (u.pathname.startsWith('/l/')) {
    return `https://teams.microsoft.com/_#${u.pathname}${u.search}`
  }
  return url
}

/** Haalt team, kanaal en (optioneel) thread-ts uit een Slack-link. */
export function parseSlackUrl(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const m = u.pathname.match(/^\/client\/([^/]+)\/([^/]+)(?:\/thread\/([^/]+))?/)
  if (!m) return null
  const [, team, channel, thread] = m
  return { team, channel, thread: thread ? decodeURIComponent(thread) : null }
}

// ---------- Login-schermen ----------

const LOGIN_PATTERNS = {
  teams: [/^https:\/\/login\.microsoftonline\.com\//i, /^https:\/\/login\.live\.com\//i, /^https:\/\/login\.microsoft\.com\//i],
  slack: [/^https:\/\/([a-z0-9-]+\.)?slack\.com\/(signin|sign_in|ssb\/signin|workspace-signin|check-login)/i, /[?&]redir=/i],
}

/** True als de huidige pagina een inlogscherm is. */
export function isLoginUrl(url, channel) {
  return (LOGIN_PATTERNS[channel] || []).some((re) => re.test(url || ''))
}

export function loginError(channel) {
  const naam = channel === 'teams' ? 'Teams' : 'Slack'
  return `Niet ingelogd bij ${naam} — draai het script met --login`
}

// ---------- Tekst naar toetsen ----------

/**
 * Zet de tekst om in stappen: stukken tekst en tussendoor een nieuwe regel (Shift+Enter).
 * De tekst zelf wordt niet aangepast; alleen Windows-regeleinden (\r\n) worden een gewone nieuwe regel.
 */
export function textToSteps(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const steps = []
  lines.forEach((line, i) => {
    if (i > 0) steps.push({ type: 'newline' })
    if (line.length > 0) steps.push({ type: 'text', value: line })
  })
  return steps
}

/**
 * Maakt tekst vergelijkbaar: witruimte samenvoegen, rare spaties gewoon maken.
 * Teams en Slack tonen tekst net iets anders (andere spaties, links), dus we vergelijken losjes.
 */
export function normalizeText(text) {
  return String(text ?? '')
    .replace(/[   ]/g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Klopt de tekst in het invoerveld met het concept? */
export function composerMatches(composerText, draft) {
  return normalizeText(composerText) === normalizeText(draft)
}

/**
 * Staat het verstuurde bericht als laatste eigen bericht in het gesprek?
 * `lastOwnText` is de tekst van het laatste eigen bericht (of null).
 * We accepteren ook dat het bericht extra tekst bevat (bijv. "Bewerkt", tijd, naam),
 * maar het hele concept moet erin staan.
 */
export function lastMessageMatches(lastOwnText, draft) {
  if (lastOwnText == null) return false
  const have = normalizeText(lastOwnText)
  const want = normalizeText(draft)
  return want.length > 0 && have.includes(want)
}

// ---------- Statusovergangen ----------

/**
 * Welke statussen het script naar de server stuurt.
 * - normaal: eerst `sending` (vóór het typen), daarna `sent` of `failed`.
 * - dry-run: niets — de reply blijft `approved`.
 */
export function statusPlan({ dryRun }) {
  if (dryRun) return { before: null, success: null, failure: null }
  return { before: 'sending', success: 'sent', failure: 'failed' }
}

const ALLOWED = {
  approved: ['sending'],
  sending: ['sent', 'failed'],
}

/** Mag het script deze statuswissel doen? (Het script zet nooit iets terug naar approved.) */
export function canTransition(from, to) {
  return (ALLOWED[from] || []).includes(to)
}

/** Maakt een foutmelding kort en zonder interne details (max ~200 tekens). */
export function shortReason(err) {
  const msg = String(err?.reason || err?.message || err || 'Onbekende fout')
    .split('\n')[0]
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
  return msg.length > 200 ? msg.slice(0, 197) + '...' : msg
}

/** Fout met een reden die naar de server mag (Nederlands, kort). */
export class SendError extends Error {
  constructor(reason, { afterSend = false } = {}) {
    super(reason)
    this.reason = reason
    this.afterSend = afterSend
  }
}
