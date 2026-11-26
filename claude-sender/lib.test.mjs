import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pending, countAttempts, newFailures, failureText, MAX_ATTEMPTS } from './lib.mjs'

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
