#!/usr/bin/env node
// Reply-sender: verstuurt goedgekeurde antwoorden uit de todo-app in Teams en Slack (web).
// Verstuurt PRECIES `draft`. Zie README.md.

import { chromium } from 'playwright'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import {
  DEFAULT_API_BASE,
  parseArgs,
  shouldProcess,
  validateReply,
  checkTargetUrl,
  teamsWebUrl,
  isLoginUrl,
  loginError,
  textToSteps,
  composerMatches,
  lastMessageMatches,
  statusPlan,
  shortReason,
  SendError,
} from './lib.mjs'

const API_BASE = (process.env.TODO_APP_API || DEFAULT_API_BASE).replace(/\/$/, '')
const PROFILE_DIR = process.env.REPLY_SENDER_PROFILE || path.join(os.homedir(), '.config', 'todo-app', 'reply-sender-profile')
const PAGE_TIMEOUT = 60_000 // Teams in een gast-tenant kan traag zijn (tenantwissel = herladen)
const IDLE_CLOSE_MS = 10 * 60_000 // browser dicht na 10 min zonder werk

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- Server ----------

function token() {
  const t = process.env.TODO_APP_TOKEN
  if (!t) {
    console.error('TODO_APP_TOKEN ontbreekt. Start via run.sh (leest ~/.zprofile) of zet de variabele.')
    process.exit(1)
  }
  return t
}

async function api(method, pathname, body) {
  let res
  try {
    res = await fetch(API_BASE + pathname, {
      method,
      headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e) {
    throw new Error(`Server niet bereikbaar (${shortReason(e)})`)
  }
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* geen JSON */
  }
  if (!res.ok) {
    const uitleg =
      res.status === 401 || res.status === 403
        ? 'token geweigerd'
        : res.status === 404
          ? 'endpoint bestaat (nog) niet'
          : data?.error?.message || data?.error || 'fout'
    throw new Error(`${method} ${pathname.split('?')[0]} gaf ${res.status} (${shortReason(uitleg)})`)
  }
  if (data == null) throw new Error(`${method} ${pathname.split('?')[0]} gaf geen JSON terug`)
  return data
}

async function fetchApproved() {
  // Komma bewust letterlijk, zoals in het contract.
  const data = await api('GET', '/replies?status=approved&channel=teams,slack')
  if (!Array.isArray(data.replies)) throw new Error('Antwoord van de server heeft geen lijst "replies"')
  return data.replies
}

async function setStatus(id, status, error) {
  const body = error ? { status, error } : { status }
  return api('POST', `/replies/${encodeURIComponent(id)}/result`, body)
}

/** Eindstatus doorgeven; een paar keer proberen, want dit mag niet zomaar verloren gaan. */
async function reportFinal(id, status, error) {
  for (let i = 1; i <= 3; i++) {
    try {
      await setStatus(id, status, error)
      return true
    } catch (e) {
      log(`  ! status ${status} doorgeven mislukt (poging ${i}/3): ${shortReason(e)}`)
      await sleep(3000 * i)
    }
  }
  log(`  ! reply ${id} blijft op 'sending' staan — Nino moet dit zelf oplossen`)
  return false
}

// ---------- Browser ----------

let context = null
let lastUsed = 0

async function openContext({ headful }) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true })
  const launch = (userAgent) =>
    chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome',
      headless: !headful,
      viewport: { width: 1400, height: 900 }, // breed genoeg: Teams verbergt anders de chatlijst
      locale: 'nl-NL',
      ...(userAgent ? { userAgent } : {}),
    })
  let ctx
  try {
    ctx = await launch()
  } catch (e) {
    if (/ProcessSingleton|already in use|SingletonLock/i.test(String(e))) {
      throw new Error('Het browserprofiel is al in gebruik (draait het script al, of staat --login nog open?)')
    }
    throw e
  }
  if (!headful) {
    // Teams weigert soms "HeadlessChrome". Dan opnieuw starten met een gewone browsernaam.
    const p = ctx.pages()[0] || (await ctx.newPage())
    const ua = await p.evaluate(() => navigator.userAgent)
    if (ua.includes('HeadlessChrome')) {
      await ctx.close()
      ctx = await launch(ua.replace('HeadlessChrome', 'Chrome'))
    }
  }
  return ctx
}

async function getContext(opts) {
  if (!context) {
    context = await openContext(opts)
    context.on('close', () => {
      context = null
    })
  }
  lastUsed = Date.now()
  return context
}

async function closeContext() {
  if (context) {
    const c = context
    context = null
    await c.close().catch(() => {})
  }
}

/** Wacht tot één van de locators zichtbaar is, of tot er een loginpagina verschijnt. */
async function waitForAny(page, locators, channel, timeout) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (isLoginUrl(page.url(), channel)) throw new SendError(loginError(channel))
    for (const loc of locators) {
      const first = loc.first()
      if (await first.isVisible().catch(() => false)) return first
    }
    await sleep(500)
  }
  return null
}

/** Typt de tekst: stukken via insertText (geen sneltoetsen/autocorrectie), nieuwe regel via Shift+Enter. */
async function typeDraft(page, box, draft) {
  await box.click()
  for (const step of textToSteps(draft)) {
    if (step.type === 'newline') await page.keyboard.press('Shift+Enter')
    else await page.keyboard.insertText(step.value)
  }
}

async function clearBox(page, box) {
  await box.click().catch(() => {})
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.press('Backspace')
}

/** Leest zichtbare tekst; plaatjes (emoji) worden hun alt-tekst. */
async function textWithAlt(locator) {
  return locator.evaluate((el) => {
    const clone = el.cloneNode(true)
    clone.querySelectorAll('img[alt]').forEach((img) => img.replaceWith(img.getAttribute('alt')))
    return clone.innerText ?? clone.textContent ?? ''
  })
}

// ---------- Teams ----------

const TEAMS_SEND_LABELS = /^(Send|Verzenden|Versturen)$/i
const TEAMS_START_POST = /^(Start a post|New post|Post in channel|Reply|Nieuw bericht|Een bericht starten|Bericht starten|Beantwoorden)$/i

function teamsComposers(page) {
  return [
    page.locator('[data-tid="ckeditor"][contenteditable="true"]'),
    page.locator('[contenteditable="true"][role="textbox"][aria-label*="message" i]'),
    page.locator('[contenteditable="true"][role="textbox"][aria-label*="bericht" i]'),
    page.locator('[contenteditable="true"][role="textbox"][aria-label*="reply" i]'),
    page.locator('[contenteditable="true"][role="textbox"][aria-label*="antwoord" i]'),
  ]
}

async function teamsLastOwnText(page) {
  // Chat: eigen berichten hebben de class fui-ChatMyMessage__body (zie teams-navigatie.md).
  const own = page.locator('.fui-ChatMyMessage__body')
  if ((await own.count()) > 0) return textWithAlt(own.last())
  // Kanaal/thread: geen aparte class voor eigen berichten; neem het laatste bericht.
  const any = page.locator('[data-tid="channel-pane-message"], [data-tid="chat-pane-message"], [data-tid="reply-message"]')
  if ((await any.count()) > 0) return textWithAlt(any.last())
  return null
}

async function sendTeams(page, reply, { dryRun }) {
  let box = await waitForAny(page, teamsComposers(page), 'teams', PAGE_TIMEOUT)
  if (!box) {
    // Kanaal: eerst "Start a post" / "Reply" openen.
    const btn = page.getByRole('button', { name: TEAMS_START_POST })
    if (await btn.last().isVisible().catch(() => false)) {
      await btn.last().click()
      box = await waitForAny(page, teamsComposers(page), 'teams', 10_000)
    }
  }
  if (!box) throw new SendError('Invoerveld niet gevonden in Teams')
  return typeVerifySend(page, box, reply, { dryRun, channel: 'teams' })
}

// ---------- Slack ----------

function slackComposers(page, isThread) {
  const input = '[data-qa="message_input"] [contenteditable="true"], [data-qa="message_input"][contenteditable="true"]'
  if (isThread) {
    // Het invoerveld in het threadpaneel rechts, niet dat van het kanaal.
    return [
      page.locator(`[data-qa="threads_flexpane"] :is(${input})`),
      page.locator(`[data-qa="secondary_view"] :is(${input})`),
      page.locator(`.p-flexpane :is(${input})`),
      page.locator(`[aria-label*="thread" i] :is(${input})`),
    ]
  }
  return [
    page.locator(`.p-workspace__primary_view :is(${input})`),
    page.locator(`[data-qa="message_pane"] ~ * :is(${input})`),
    page.locator(input),
  ]
}

async function slackLastOwnText(page, isThread) {
  const scope = isThread
    ? page.locator('[data-qa="threads_flexpane"], [data-qa="secondary_view"], .p-flexpane').first()
    : page.locator('.p-workspace__primary_view, [data-qa="message_pane"]').first()
  const msgs = scope.locator('[data-qa="message-text"]')
  if ((await msgs.count()) === 0) return null
  return textWithAlt(msgs.last())
}

async function sendSlack(page, reply, { dryRun }) {
  const isThread = checkTargetUrl(reply.target.url, 'slack').isThread
  // Slack toont soms "open in de app?"; in de browser blijven.
  const inBrowser = page.getByRole('link', { name: /(use Slack in your browser|Slack in je browser gebruiken)/i })
  const box = await waitForAny(page, [...slackComposers(page, isThread), inBrowser], 'slack', PAGE_TIMEOUT)
  let composer = box
  if (box && (await box.evaluate((el) => el.tagName === 'A').catch(() => false))) {
    await box.click()
    composer = await waitForAny(page, slackComposers(page, isThread), 'slack', PAGE_TIMEOUT)
  }
  if (!composer) throw new SendError(isThread ? 'Invoerveld van de Slack-thread niet gevonden' : 'Invoerveld niet gevonden in Slack')
  return typeVerifySend(page, composer, reply, { dryRun, channel: 'slack', isThread })
}

// ---------- Gemeenschappelijk: typen, controleren, versturen ----------

async function typeVerifySend(page, box, reply, { dryRun, channel, isThread }) {
  // Staat er al tekst (een oud concept)? Dan niet overschrijven of samenvoegen.
  const existing = (await textWithAlt(box)).trim()
  if (existing) throw new SendError('Invoerveld bevat al tekst (oud concept) — niet aangeraakt')

  await typeDraft(page, box, reply.draft)
  await sleep(300)
  const typed = await textWithAlt(box)
  if (!composerMatches(typed, reply.draft)) {
    await clearBox(page, box)
    throw new SendError('Getypte tekst klopt niet met het concept — niet verstuurd')
  }

  if (dryRun) {
    const regels = reply.draft.split('\n').length
    log(`  [dry-run] tekst staat goed in het invoerveld (${regels} regel(s), ${reply.draft.length} tekens); zou nu op Enter drukken`)
    await clearBox(page, box) // geen concept achterlaten in Teams/Slack
    return
  }

  // Versturen: Enter (standaard in Teams en Slack). Valt Enter niet als verzenden? Dan verzendknop.
  await page.keyboard.press('Enter')
  const emptied = await waitUntil(async () => (await textWithAlt(box).catch(() => '')).trim() === '', 8000)
  if (!emptied) {
    const sendBtn = page.getByRole('button', { name: TEAMS_SEND_LABELS })
    if (channel === 'teams' && (await sendBtn.first().isVisible().catch(() => false))) {
      await sendBtn.first().click()
    }
    const emptiedAfterClick = await waitUntil(async () => (await textWithAlt(box).catch(() => '')).trim() === '', 5000)
    if (!emptiedAfterClick) {
      // Niet verstuurd: tekst weghalen zodat er geen half concept blijft staan.
      await clearBox(page, box)
      throw new SendError('Versturen lukte niet (invoerveld bleef gevuld)')
    }
  }

  // Controle: staat het als laatste eigen bericht in het gesprek?
  const ok = await waitUntil(async () => {
    const last = channel === 'teams' ? await teamsLastOwnText(page) : await slackLastOwnText(page, isThread)
    return lastMessageMatches(last, reply.draft)
  }, 15_000)
  if (!ok) {
    throw new SendError('Mogelijk verstuurd, maar niet teruggevonden als laatste bericht — controleer het gesprek zelf', {
      afterSend: true,
    })
  }
}

async function waitUntil(fn, timeout) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true
    await sleep(500)
  }
  return false
}

// ---------- Eén reply afhandelen ----------

async function handleReply(reply, opts) {
  const plan = statusPlan(opts)
  const label = `${reply.id} [${reply.channel}] "${String(reply.title || '').slice(0, 60)}"`
  log(`> ${label}`)

  const valid = validateReply(reply)
  if (!valid.ok) {
    log(`  x ${valid.error}`)
    if (plan.failure) {
      // Eerst sending, dan failed: zo blijft de statusvolgorde van de server kloppen.
      try {
        await setStatus(reply.id, plan.before)
      } catch (e) {
        log(`  ! kon status niet zetten: ${shortReason(e)}`)
        return
      }
      await reportFinal(reply.id, plan.failure, valid.error)
    }
    return
  }

  // Vóór het typen op 'sending' zetten. Lukt dat niet: NIET versturen.
  if (plan.before) {
    try {
      await setStatus(reply.id, plan.before)
    } catch (e) {
      log(`  ! status 'sending' zetten mislukt, sla over: ${shortReason(e)}`)
      return
    }
  }

  let page
  try {
    const ctx = await getContext(opts)
    page = await ctx.newPage()
    const url = reply.channel === 'teams' ? teamsWebUrl(reply.target.url) : reply.target.url
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT })
    if (isLoginUrl(page.url(), reply.channel)) throw new SendError(loginError(reply.channel))
    if (reply.channel === 'teams') await sendTeams(page, reply, opts)
    else await sendSlack(page, reply, opts)

    if (plan.success) {
      await reportFinal(reply.id, plan.success)
      log(`  ✓ verstuurd`)
    } else {
      log(`  ✓ [dry-run] klaar, status blijft 'approved'`)
    }
  } catch (e) {
    const reason = e instanceof SendError ? e.reason : `Onverwachte fout: ${shortReason(e)}`
    log(`  x ${reason}`)
    if (plan.failure) await reportFinal(reply.id, plan.failure, reason)
  } finally {
    if (page) await page.close().catch(() => {})
    lastUsed = Date.now()
  }
}

// ---------- Modi ----------

async function loginMode() {
  log(`Inlogmodus. Profiel: ${PROFILE_DIR}`)
  log('Log in bij Teams en Slack in het venster dat opent. Sluit daarna het venster.')
  const ctx = await openContext({ headful: true })
  const p1 = ctx.pages()[0] || (await ctx.newPage())
  await p1.goto('https://teams.microsoft.com/').catch(() => {})
  const p2 = await ctx.newPage()
  await p2.goto('https://app.slack.com/client').catch(() => {})
  await new Promise((resolve) => {
    ctx.on('close', resolve)
    const check = () => {
      if (ctx.pages().length === 0) ctx.close().catch(() => {})
    }
    ctx.on('page', (p) => p.on('close', check))
    for (const p of ctx.pages()) p.on('close', check)
  })
  log('Venster dicht. Login is bewaard in het profiel.')
}

let stopping = false

async function loop(opts) {
  const seen = new Set() // alleen in dry-run: niet steeds dezelfde reply opnieuw proberen
  log(`Reply-sender gestart${opts.dryRun ? ' (DRY-RUN: er wordt niets verstuurd)' : ''}. Elke ${opts.intervalMs / 1000} s ophalen.`)
  while (!stopping) {
    try {
      const replies = await fetchApproved()
      const todo = replies.filter((r) => shouldProcess(r, seen))
      if (todo.length) log(`${todo.length} goedgekeurd antwoord(en) gevonden`)
      for (const r of todo) {
        if (stopping) break
        await handleReply(r, opts) // één tegelijk
        if (opts.dryRun) seen.add(r.id)
      }
    } catch (e) {
      log(`! ophalen mislukt: ${shortReason(e)} — probeer het straks opnieuw`)
    }
    if (context && Date.now() - lastUsed > IDLE_CLOSE_MS) await closeContext()
    if (opts.once) break
    for (let waited = 0; waited < opts.intervalMs && !stopping; waited += 500) await sleep(500)
  }
  await closeContext()
  log('Gestopt.')
}

const HELP = `Gebruik: node sender.mjs [opties]
  --login      Browser openen om eenmalig in te loggen bij Teams en Slack
  --dry-run    Alles behalve versturen; status blijft 'approved'
  --once       Eén ronde en dan stoppen
  --headful    Browser zichtbaar (meekijken)
  --interval=N Elke N seconden ophalen (standaard 15)`

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(e.message + '\n\n' + HELP)
    process.exit(2)
  }
  if (opts.help) return console.log(HELP)
  if (opts.login) return loginMode()

  token() // meteen stoppen als het token ontbreekt
  let presses = 0
  const onSignal = () => {
    presses++
    if (presses > 1) {
      log('Direct stoppen.')
      process.exit(130)
    }
    stopping = true
    log('Stoppen na de huidige stap... (nog eens Ctrl+C = direct)')
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  await loop(opts)
}

main().catch(async (e) => {
  console.error('Fout:', shortReason(e))
  await closeContext()
  process.exit(1)
})
