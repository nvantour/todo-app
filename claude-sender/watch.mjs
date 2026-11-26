#!/usr/bin/env node
// Wachter op de laptop: kijkt elke 15 s of Nino in het werk-OS een Teams/Slack-emoji aanklikte of een
// Teams/Slack-antwoord goedkeurde. Zo ja, dan start hij `claude -p` met opdracht.md: Claude zet de emoji
// of verstuurt het antwoord (Slack via de Slack-koppeling, Teams in Nino's eigen Chrome). Zie README.md.

import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pending, countAttempts, newFailures, failureText, replyKey, reactionKey } from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const API = (process.env.TODO_APP_API || 'https://work-apps-48770.web.app/api').replace(/\/$/, '')
const STATE = path.join(os.homedir(), '.config', 'todo-app', 'claude-sender-state.json')
const NOTIFY = path.resolve(HERE, '../../../Operationeel/Automatiseringen/notificatie.py')
const INTERVAL = Number(process.env.CLAUDE_SENDER_INTERVAL || 15) * 1000
const RUN_TIMEOUT = 10 * 60_000
const MODEL = process.env.CLAUDE_SENDER_MODEL || 'sonnet'
const ONCE = process.argv.includes('--once')

const ALLOWED = [
  'ToolSearch',
  'mcp__todo__list_send_queue',
  'mcp__todo__report_reply_result',
  'mcp__todo__list_reaction_queue',
  'mcp__todo__report_reaction_result',
  'mcp__claude_ai_Slack__slack_add_reaction',
  'mcp__claude_ai_Slack__slack_send_message',
  'mcp__claude_ai_Slack__slack_read_thread',
  'mcp__claude_ai_Slack__slack_read_channel',
  'mcp__claude-in-chrome',
]

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function token() {
  const t = process.env.TODO_APP_TOKEN
  if (!t) {
    console.error('TODO_APP_TOKEN ontbreekt. Start via run.sh (leest ~/.zprofile).')
    process.exit(1)
  }
  return t
}

async function api(pathname) {
  const res = await fetch(API + pathname, { headers: { Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`GET ${pathname.split('?')[0]} gaf ${res.status}`)
  return res.json()
}

async function queue(status) {
  const [r, e] = await Promise.all([
    api(`/replies?status=${status === 'todo' ? 'approved' : 'failed'}&channel=teams,slack`),
    api(`/reactions?status=${status === 'todo' ? 'queued' : 'failed'}&channel=teams,slack`),
  ])
  return { replies: r.replies ?? [], reactions: e.reactions ?? [] }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'))
  } catch {
    return { attempts: {}, notified: [], warnedGivenUp: [] }
  }
}
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true })
  s.notified = s.notified.slice(-300)
  s.warnedGivenUp = s.warnedGivenUp.slice(-300)
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2))
}

function notify(title, body) {
  execFile('python3', [NOTIFY, title, body], (err) => err && log(`! melding mislukt: ${err.message}`))
}

/** MCP-config voor de todo-koppeling, met het pad naar de sleutel-helper buiten de repo. */
function mcpConfig() {
  const file = path.join(os.tmpdir(), 'claude-sender-mcp.json')
  const helper = path.join(os.homedir(), '.config', 'todo-app', 'mcp-headers.sh')
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { todo: { type: 'http', url: API.replace(/\/api$/, '/mcp'), headersHelper: helper } } }))
  return file
}

function runClaude() {
  const prompt = fs.readFileSync(path.join(HERE, 'opdracht.md'), 'utf8')
  const args = ['-p', prompt, '--chrome', '--model', MODEL, '--permission-mode', 'dontAsk', '--mcp-config', mcpConfig(), '--allowedTools', ...ALLOWED]
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: HERE, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    const timer = setTimeout(() => {
      log('! Claude duurde langer dan 10 minuten, gestopt')
      child.kill('SIGTERM')
    }, RUN_TIMEOUT)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out: out.trim() })
    })
  })
}

const labelOf = (x) => (x.reaction ? `${x.title} (${x.reaction.emoji})` : x.title)

async function round(state) {
  const q = await queue('todo')
  const { keys, todo, givenUp } = pending(q, state.attempts)
  for (const k of givenUp.filter((k) => !state.warnedGivenUp.includes(k))) {
    state.warnedGivenUp.push(k)
    notify('Werk-OS: blijft hangen', 'Claude kreeg een emoji of antwoord na twee pogingen niet weg. Kijk op de tab Antwoorden.')
    log(`! opgegeven na ${2} pogingen: ${k}`)
  }
  if (todo.length) {
    log(`${todo.length} onderdeel/onderdelen klaar: ${todo.join(', ')} → claude -p`)
    const { code, out } = await runClaude()
    log(`claude klaar (code ${code}):\n${out.split('\n').map((l) => '  | ' + l).join('\n')}`)
    const after = await queue('todo')
    state.attempts = countAttempts(todo, [...after.replies.map(replyKey), ...after.reactions.map(reactionKey)], state.attempts)
  } else if (!keys.length) state.attempts = {}

  // Meldingen voor wat mislukt is (één keer per onderdeel).
  const failed = await queue('failed')
  const items = [
    ...failed.replies.map((r) => ({ key: `${replyKey(r)}@${r.updatedAt}`, channel: r.channel, what: 'Antwoord', label: labelOf(r), error: r.error })),
    ...failed.reactions.map((x) => ({ key: `${reactionKey(x)}@${x.reaction.doneAt}`, channel: x.channel, what: `Emoji ${x.reaction.emoji}`, label: labelOf(x), error: x.reaction.error })),
  ]
  if (!state.notified.length && items.length) {
    // Eerste start: oude mislukkingen niet allemaal melden.
    state.notified.push(...items.map((i) => i.key))
  } else {
    for (const f of newFailures(items, state.notified)) {
      const { title, body } = failureText(f)
      notify(title, body)
      state.notified.push(f.key)
    }
  }
  saveState(state)
}

let stopping = false
process.on('SIGINT', () => (stopping = true))
process.on('SIGTERM', () => (stopping = true))

async function main() {
  token()
  log(`Wachter gestart: elke ${INTERVAL / 1000} s, model ${MODEL}${ONCE ? ', één ronde' : ''}`)
  const state = loadState()
  while (!stopping) {
    try {
      await round(state)
    } catch (e) {
      log(`! ronde mislukt: ${e.message}`)
    }
    if (ONCE) break
    for (let w = 0; w < INTERVAL && !stopping; w += 500) await sleep(500)
  }
  log('Gestopt.')
}

main()
