import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pending, countAttempts, newFailures, failureText, luaString, clickNotificationLua, TARGETS, MAX_ATTEMPTS } from './lib.mjs'

const reply = { id: 'r1' }
const emoji = { replyId: 'r2', reaction: { id: 'q1' } }

test('wat klaarstaat, en wat al te vaak geprobeerd is', () => {
  const p = pending({ replies: [reply], reactions: [emoji] }, { 'emoji:r2/q1': MAX_ATTEMPTS })
  assert.deepEqual(p.keys, ['reply:r1', 'emoji:r2/q1'])
  assert.deepEqual(p.todo, ['reply:r1'])
  assert.deepEqual(p.givenUp, ['emoji:r2/q1'])
})

test('pogingen tellen alleen voor wat na de ronde nog klaarstaat', () => {
  assert.deepEqual(countAttempts(['reply:r1', 'emoji:r2/q1'], ['emoji:r2/q1'], {}), { 'emoji:r2/q1': 1 })
  assert.deepEqual(countAttempts(['emoji:r2/q1'], ['emoji:r2/q1'], { 'emoji:r2/q1': 1 }), { 'emoji:r2/q1': 2 })
  // nieuw onderdeel tijdens de ronde: telt nog niet
  assert.deepEqual(countAttempts(['reply:r1'], ['reply:r9'], {}), {})
})

test('melding één keer per mislukking, met een duidelijke tekst bij niet ingelogd', () => {
  const f = [{ key: 'a', channel: 'teams', what: 'Emoji 👍', label: 'CRO', error: 'Niet ingelogd op Teams in Chrome' }, { key: 'b', channel: 'slack', what: 'Antwoord', label: '#x', error: 'channel_not_found' }]
  assert.deepEqual(newFailures(f, ['a']).map((x) => x.key), ['b'])
  assert.match(failureText(f[0]).title, /Teams in Chrome: niet ingelogd/)
  assert.equal(failureText(f[1]).body, '#x: channel_not_found')
})

test('een klik op de melding gaat naar het juiste scherm', () => {
  const teams = failureText({ channel: 'teams', what: 'Emoji 👍', label: 'CRO', error: 'Niet ingelogd op Teams in Chrome' })
  assert.deepEqual(teams.target, TARGETS.teamsChrome)
  assert.equal(teams.target.app, 'com.google.Chrome')
  assert.deepEqual(failureText({ channel: 'slack', what: 'Antwoord', label: '#x', error: 'channel_not_found' }).target, TARGETS.antwoorden)
  assert.deepEqual(failureText({ channel: 'slack', what: 'Antwoord', label: '#x', error: 'Niet ingelogd op Slack' }).target, TARGETS.antwoorden)
})

test('tekst van een melding kan het Hammerspoon-commando niet breken', () => {
  assert.equal(luaString('a"]]\n'), '"\\097\\034\\093\\093\\010"')
  assert.equal(luaString('é'), '"\\195\\169"')
  const lua = clickNotificationLua('T', 'x") os.exit() --', { url: 'https://a.b/', app: 'c.d' })
  assert.match(lua, /^return klikMelding\("\\084", "[\\0-9]+", \{ url = "[\\0-9]+", app = "[\\0-9]+" \}\)$/)
})
