import { describe, expect, it } from 'vitest'
import type { Reply, ReplyMessage } from '../model/types'
import { addMine, buildReaction, canReact, enqueue, mergeMessages, normalizeReply, shownReactions, stepReaction } from './replies'

const msg = (over: Partial<ReplyMessage> = {}): ReplyMessage => ({ author: 'Mark', text: 'Staat ID66 al live?', at: '2026-11-23T09:01:00Z', ...over })
const card = (over: Partial<Reply> = {}): Reply => ({ ...normalizeReply('r1', { channel: 'gchat', target: { space: 'spaces/A' }, messages: [msg({ id: 'spaces/A/messages/m1' })] }), ...over })

describe('emoji op berichten', () => {
  it('Google Chat alleen met bericht-id; Teams/Slack met een gesprekslink; mail en Airtable nooit', () => {
    expect(canReact(card(), msg({ id: 'spaces/A/messages/m1' }))).toBe(true)
    expect(canReact(card(), msg())).toBe(false)
    expect(canReact({ channel: 'teams', target: { url: 'https://teams.microsoft.com/l/chat/x' } }, msg())).toBe(true)
    expect(canReact({ channel: 'slack', target: {} }, msg())).toBe(false)
    expect(canReact({ channel: 'mail', target: { threadId: 't' } }, msg({ id: 'x' }))).toBe(false)
  })

  it('jouw emoji erbij: telt op bij dezelfde van een ander, niet dubbel als hij al van jou is', () => {
    expect(addMine([{ emoji: '👍', count: 2 }], '👍')).toEqual([{ emoji: '👍', count: 3, mine: true }])
    expect(addMine([{ emoji: '👍', count: 3, mine: true }], '👍')).toEqual([{ emoji: '👍', count: 3, mine: true }])
    expect(addMine(undefined, '🎉')).toEqual([{ emoji: '🎉', count: 1, mine: true }])
  })

  it('toont een emoji die nog onderweg is en een mislukte, en na "gezet" alleen de echte', () => {
    const m = msg({ id: 'spaces/A/messages/m1', reactions: [{ emoji: '👀', count: 2 }] })
    const req = buildReaction(card(), m, '👀', 'q1', '2026-11-26T10:00:00Z')
    const r = card({ messages: [m], reactionQueue: [req] })
    expect(shownReactions(r, m)).toEqual([{ emoji: '👀', count: 3, mine: true, state: 'pending', error: null }])
    const failed = stepReaction(r, 'q1', 'failed', '2026-11-26T10:00:05Z', 'Geen toestemming')!
    expect(shownReactions(failed, m)[0]).toMatchObject({ state: 'failed', error: 'Geen toestemming' })
    const sent = stepReaction(r, 'q1', 'sent', '2026-11-26T10:00:05Z')!
    expect(sent.messages[0].reactions).toEqual([{ emoji: '👀', count: 3, mine: true }])
    expect(shownReactions(sent, sent.messages[0])).toEqual([{ emoji: '👀', count: 3, mine: true }])
  })

  it('vindt het bericht ook zonder id terug (Teams), op afzender, tijd en tekst', () => {
    const m = msg()
    const r = card({ channel: 'teams', target: { url: 'u' }, messages: [m, msg({ text: 'Ander bericht', at: '2026-11-23T09:05:00Z' })] })
    const req = buildReaction(r, m, '🙏', 'q1', '2026-11-26T10:00:00Z')
    expect(req.status).toBe('queued')
    const sent = stepReaction(stepReaction({ ...r, reactionQueue: [req] }, 'q1', 'sending', 'x')!, 'q1', 'sent', 'y')!
    expect(sent.messages.map((x) => x.reactions)).toEqual([[{ emoji: '🙏', count: 1, mine: true }], undefined])
  })

  it('een nieuwe ronde: houdt id, reacties en "van jou" vast als de ronde ze niet kent', () => {
    const old = [msg({ id: '1700.1', reactions: [{ emoji: '👍', count: 1, mine: true }] })]
    expect(mergeMessages(old, [msg()])).toEqual(old)
    expect(mergeMessages(old, [msg({ id: '1700.1', reactions: [{ emoji: '👍', count: 2 }] })])).toEqual([msg({ id: '1700.1', reactions: [{ emoji: '👍', count: 2, mine: true }] })])
    expect(mergeMessages(old, [msg({ id: '1700.1', reactions: [] })])[0].reactions).toEqual([])
  })

  it('wachtrij blijft beperkt en gooit eerst afgeronde weg', () => {
    let q = [buildReaction(card(), msg(), '👍', 'open', 't')]
    for (let i = 0; i < 40; i++) q = enqueue(q, { ...buildReaction(card(), msg(), '👍', `s${i}`, 't'), status: 'sent' })
    expect(q).toHaveLength(30)
    expect(q[0].id).toBe('open')
  })
})
