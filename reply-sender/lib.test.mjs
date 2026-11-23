import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseArgs,
  shouldProcess,
  validateReply,
  checkTargetUrl,
  parseSlackUrl,
  teamsWebUrl,
  isLoginUrl,
  loginError,
  textToSteps,
  normalizeText,
  composerMatches,
  lastMessageMatches,
  statusPlan,
  canTransition,
  shortReason,
} from './lib.mjs'

const base = {
  id: 'r1',
  channel: 'teams',
  status: 'approved',
  draft: 'Hoi!',
  target: { url: 'https://teams.microsoft.com/l/chat/19:abc@thread.v2/conversations?tenantId=x' },
}

test('parseArgs: standaard en vlaggen', () => {
  assert.deepEqual(parseArgs([]), { login: false, dryRun: false, headful: false, once: false, intervalMs: 15000 })
  const o = parseArgs(['--dry-run', '--once', '--headful', '--interval=30'])
  assert.equal(o.dryRun, true)
  assert.equal(o.once, true)
  assert.equal(o.headful, true)
  assert.equal(o.intervalMs, 30000)
  assert.throws(() => parseArgs(['--dryrun']), /Onbekende vlag/)
  assert.throws(() => parseArgs(['--interval=2']), /minimaal 5/)
})

test('shouldProcess: alleen approved teams/slack, sending overslaan', () => {
  assert.equal(shouldProcess(base), true)
  assert.equal(shouldProcess({ ...base, channel: 'slack' }), true)
  assert.equal(shouldProcess({ ...base, status: 'sending' }), false)
  assert.equal(shouldProcess({ ...base, status: 'sent' }), false)
  assert.equal(shouldProcess({ ...base, channel: 'mail' }), false)
  assert.equal(shouldProcess({ ...base, id: undefined }), false)
  assert.equal(shouldProcess(base, new Set(['r1'])), false)
  assert.equal(shouldProcess(null), false)
})

test('validateReply: link en tekst verplicht', () => {
  assert.deepEqual(validateReply(base), { ok: true })
  assert.match(validateReply({ ...base, target: {} }).error, /target\.url ontbreekt/)
  assert.match(validateReply({ ...base, target: undefined }).error, /target\.url ontbreekt/)
  assert.match(validateReply({ ...base, draft: '   ' }).error, /Lege tekst/)
  assert.match(validateReply({ ...base, target: { url: 'https://evil.example.com/x' } }).error, /geen Teams-link/)
})

test('checkTargetUrl: teams en slack', () => {
  assert.equal(checkTargetUrl('https://teams.cloud.microsoft/l/chat/1', 'teams').ok, true)
  assert.equal(checkTargetUrl('http://teams.microsoft.com/l/chat/1', 'teams').ok, false)
  assert.equal(checkTargetUrl('geen url', 'teams').ok, false)
  assert.deepEqual(checkTargetUrl('https://app.slack.com/client/T1/C1', 'slack'), { ok: true, isThread: false })
  assert.deepEqual(checkTargetUrl('https://app.slack.com/client/T1/C1/thread/C1-1700000000.123456', 'slack'), {
    ok: true,
    isThread: true,
  })
  assert.equal(checkTargetUrl('https://slack.com/client/T1/C1', 'slack').ok, false)
  assert.equal(checkTargetUrl('https://app.slack.com/client/T1/C1', 'teams').ok, false)
})

test('teamsWebUrl: deeplink naar web-app, zonder launcher', () => {
  assert.equal(
    teamsWebUrl('https://teams.microsoft.com/l/chat/19:abc@thread.v2/conversations?tenantId=t1'),
    'https://teams.microsoft.com/_#/l/chat/19:abc@thread.v2/conversations?tenantId=t1',
  )
  assert.equal(
    teamsWebUrl('https://teams.cloud.microsoft/l/message/19:x@thread.tacv2/123?tenantId=t&groupId=g'),
    'https://teams.microsoft.com/_#/l/message/19:x@thread.tacv2/123?tenantId=t&groupId=g',
  )
  assert.equal(
    teamsWebUrl('https://teams.microsoft.com/dl/launcher/launcher.html?url=%2F_%23%2Fl%2Fchat%2F19%3Aabc&type=chat'),
    'https://teams.microsoft.com/_#/l/chat/19:abc',
  )
  // al een web-app-link of iets anders: ongemoeid
  assert.equal(teamsWebUrl('https://teams.cloud.microsoft/'), 'https://teams.cloud.microsoft/')
  assert.equal(teamsWebUrl('https://app.slack.com/client/T/C'), 'https://app.slack.com/client/T/C')
})

test('parseSlackUrl', () => {
  assert.deepEqual(parseSlackUrl('https://app.slack.com/client/T1/C2'), { team: 'T1', channel: 'C2', thread: null })
  assert.deepEqual(parseSlackUrl('https://app.slack.com/client/T1/C2/thread/C2-1700000000.123456'), {
    team: 'T1',
    channel: 'C2',
    thread: 'C2-1700000000.123456',
  })
  assert.equal(parseSlackUrl('https://app.slack.com/foo'), null)
})

test('isLoginUrl', () => {
  assert.equal(isLoginUrl('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x', 'teams'), true)
  assert.equal(isLoginUrl('https://teams.cloud.microsoft/', 'teams'), false)
  assert.equal(isLoginUrl('https://app.slack.com/client/T1/C1', 'slack'), false)
  assert.equal(isLoginUrl('https://slack.com/signin', 'slack'), true)
  assert.equal(isLoginUrl('https://onlinedialogue.slack.com/signin', 'slack'), true)
  assert.equal(isLoginUrl('https://slack.com/workspace-signin?redir=%2Fclient', 'slack'), true)
  assert.match(loginError('teams'), /Niet ingelogd bij Teams — draai het script met --login/)
  assert.match(loginError('slack'), /Niet ingelogd bij Slack/)
})

test('textToSteps: regels met Shift+Enter, tekst onveranderd', () => {
  assert.deepEqual(textToSteps('Hoi'), [{ type: 'text', value: 'Hoi' }])
  assert.deepEqual(textToSteps('a\nb'), [
    { type: 'text', value: 'a' },
    { type: 'newline' },
    { type: 'text', value: 'b' },
  ])
  // lege regel blijft een lege regel
  assert.deepEqual(textToSteps('a\n\nb'), [
    { type: 'text', value: 'a' },
    { type: 'newline' },
    { type: 'newline' },
    { type: 'text', value: 'b' },
  ])
  assert.deepEqual(textToSteps('a\r\nb'), textToSteps('a\nb'))
  // spaties, emoji en tekens blijven exact staan
  assert.deepEqual(textToSteps('  :) @Jan *vet* 👍 '), [{ type: 'text', value: '  :) @Jan *vet* 👍 ' }])
})

test('normalizeText en vergelijken', () => {
  assert.equal(normalizeText('a  b\n\nc '), 'a b c')
  assert.equal(composerMatches('Hoi\nJan', 'Hoi Jan'), true)
  assert.equal(composerMatches('Hoi Jan!', 'Hoi Jan'), false)
  assert.equal(lastMessageMatches('Nino van Tour 10:02 Hoi\nJan Bewerkt', 'Hoi\nJan'), true)
  assert.equal(lastMessageMatches('Iets anders', 'Hoi Jan'), false)
  assert.equal(lastMessageMatches(null, 'Hoi'), false)
  assert.equal(lastMessageMatches('Hoi', ''), false)
})

test('statusPlan: dry-run stuurt geen statussen', () => {
  assert.deepEqual(statusPlan({ dryRun: false }), { before: 'sending', success: 'sent', failure: 'failed' })
  assert.deepEqual(statusPlan({ dryRun: true }), { before: null, success: null, failure: null })
})

test('canTransition', () => {
  assert.equal(canTransition('approved', 'sending'), true)
  assert.equal(canTransition('sending', 'sent'), true)
  assert.equal(canTransition('sending', 'failed'), true)
  assert.equal(canTransition('approved', 'sent'), false)
  assert.equal(canTransition('sending', 'approved'), false)
  assert.equal(canTransition('sent', 'sending'), false)
})

test('shortReason: kort en zonder token', () => {
  assert.equal(shortReason(new Error('regel 1\nregel 2')), 'regel 1')
  assert.equal(shortReason('Authorization: Bearer abc.def'), 'Authorization: Bearer ***')
  assert.equal(shortReason('x'.repeat(300)).length, 200)
  assert.equal(shortReason({ reason: 'Invoerveld niet gevonden' }), 'Invoerveld niet gevonden')
})
