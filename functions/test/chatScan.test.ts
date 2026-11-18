import { describe, expect, it } from 'vitest'
import { findReplyCandidates, runChatScan, shortGist, spaceUrl } from '../src/chatScan'
import type { ChatMessage, ChatSpace } from '../src/googleApi'
import { UID } from './helpers'
import { ME, scanSetup } from './sources.helpers'

const ANNA = { name: 'users/2002', displayName: 'Anna', type: 'HUMAN' as const }
const MEU = { name: `users/${ME}`, displayName: 'Nino', type: 'HUMAN' as const }
const BOT = { name: 'users/9', displayName: 'Jira', type: 'BOT' as const }

let n = 0
const msg = (space: string, sender: ChatMessage['sender'], at: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  name: `${space}/messages/m${++n}`,
  sender,
  createTime: `2026-11-17T${at}:00Z`,
  text: 'hoi',
  thread: { name: `${space}/threads/t1` },
  ...over,
})
const mention = (user: { name?: string }) => [{ type: 'USER_MENTION', userMention: { user, type: 'MENTION' } }]

const dm: ChatSpace = { name: 'spaces/DM1', spaceType: 'DIRECT_MESSAGE' }
const room: ChatSpace = { name: 'spaces/ROOM1', spaceType: 'SPACE', displayName: 'Team Wehkamp', spaceThreadingState: 'THREADED_MESSAGES' }

describe('wie moet reageren (chat-selectie)', () => {
  it('DM: het laatste bericht is van de ander = reageren; van jou = klaar', () => {
    const open = findReplyCandidates([{ space: dm, messages: [msg('spaces/DM1', MEU, '09:00'), msg('spaces/DM1', ANNA, '10:00')] }], ME)
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ kind: 'dm', senderName: 'Anna' })
    const done = findReplyCandidates([{ space: dm, messages: [msg('spaces/DM1', ANNA, '09:00'), msg('spaces/DM1', MEU, '10:00')] }], ME)
    expect(done).toEqual([])
  })

  it('DM: berichten van bots en verwijderde berichten tellen niet', () => {
    const r = findReplyCandidates(
      [
        { space: dm, messages: [msg('spaces/DM1', ANNA, '09:00'), msg('spaces/DM1', ANNA, '10:00', { deleteTime: '2026-11-17T10:05:00Z' })] },
        { space: { name: 'spaces/B', spaceType: 'DIRECT_MESSAGE', singleUserBotDm: true }, messages: [msg('spaces/B', BOT, '09:00')] },
        { space: { name: 'spaces/B2', spaceType: 'DIRECT_MESSAGE' }, messages: [msg('spaces/B2', BOT, '09:00')] },
      ],
      ME,
    )
    // het verwijderde bericht valt weg, dus het bericht van 09:00 is het laatste en blijft open staan
    expect(r.map((c) => c.space.name)).toEqual(['spaces/DM1'])
  })

  it('vermelding zonder later antwoord van jou in dezelfde thread = reageren', () => {
    const m = msg('spaces/ROOM1', ANNA, '09:00', { annotations: mention(MEU), text: '@Nino kun je kijken?' })
    const r = findReplyCandidates([{ space: room, messages: [m] }], ME)
    expect(r).toHaveLength(1)
    expect(r[0].kind).toBe('mention')
  })

  it('een antwoord van jou in dezelfde thread haalt de vermelding weg; in een andere thread niet', () => {
    const m = msg('spaces/ROOM1', ANNA, '09:00', { annotations: mention(MEU) })
    const same = msg('spaces/ROOM1', MEU, '09:30')
    const other = msg('spaces/ROOM1', MEU, '09:30', { thread: { name: 'spaces/ROOM1/threads/t2' } })
    expect(findReplyCandidates([{ space: room, messages: [m, same] }], ME)).toEqual([])
    expect(findReplyCandidates([{ space: room, messages: [m, other] }], ME)).toHaveLength(1)
  })

  it('zonder threads telt elk later bericht van jou in de space', () => {
    const flat: ChatSpace = { ...room, spaceThreadingState: 'UNTHREADED_MESSAGES' }
    const m = msg('spaces/ROOM1', ANNA, '09:00', { annotations: mention(MEU), thread: { name: 'spaces/ROOM1/threads/a' } })
    const mine = msg('spaces/ROOM1', MEU, '09:30', { thread: { name: 'spaces/ROOM1/threads/b' } })
    expect(findReplyCandidates([{ space: flat, messages: [m, mine] }], ME)).toEqual([])
  })

  it('een vermelding van iemand anders, van jezelf, van een bot of @iedereen telt niet', () => {
    const msgs = [
      msg('spaces/ROOM1', ANNA, '09:00', { annotations: mention({ name: 'users/3003' }) }),
      msg('spaces/ROOM1', MEU, '09:10', { annotations: mention(MEU) }),
      msg('spaces/ROOM1', BOT, '09:20', { annotations: mention(MEU) }),
      msg('spaces/ROOM1', ANNA, '09:30', { annotations: mention({ name: 'users/all' }) }),
    ]
    expect(findReplyCandidates([{ space: room, messages: msgs }], ME)).toEqual([])
  })

  it('geeft één kandidaat per thread: de laatste vermelding', () => {
    const a = msg('spaces/ROOM1', ANNA, '09:00', { annotations: mention(MEU), text: 'eerste' })
    const b = msg('spaces/ROOM1', ANNA, '10:00', { annotations: mention(MEU), text: 'tweede' })
    const r = findReplyCandidates([{ space: room, messages: [a, b] }], ME)
    expect(r.map((c) => c.message.text)).toEqual(['tweede'])
  })
})

describe('titel en link', () => {
  it('kort de kern af op een woord en haalt opmaak weg', () => {
    expect(shortGist('Hoi *Nino*, kun je\n  even naar de offerte kijken voor Wehkamp en daarna terugbellen alsjeblieft?', 40)).toBe('Hoi Nino, kun je even naar de offerte…')
    expect(shortGist('kort')).toBe('kort')
    expect(shortGist(undefined)).toBe('')
  })
  it('gebruikt de spaceUri als die er is, anders de bekende vorm', () => {
    expect(spaceUrl({ name: 'spaces/AAA', spaceUri: 'https://chat.google.com/room/AAA' })).toBe('https://chat.google.com/room/AAA')
    expect(spaceUrl({ name: 'spaces/AAA' })).toBe('https://mail.google.com/mail/u/0/#chat/space/AAA')
  })
})

describe('runChatScan', () => {
  const recent = '2026-11-18T08:00:00Z'
  function data() {
    return {
      spaces: [
        { ...dm, lastActiveTime: recent },
        { ...room, lastActiveTime: recent },
        { name: 'spaces/OLD', spaceType: 'SPACE' as const, lastActiveTime: '2026-10-01T00:00:00Z' },
      ],
      messages: {
        'spaces/DM1': [msg('spaces/DM1', { name: 'users/2002', type: 'HUMAN' }, '09:00', { text: 'Heb je de cijfers al, voor het overleg van morgen?' })],
        'spaces/ROOM1': [msg('spaces/ROOM1', ANNA, '09:00', { annotations: mention(MEU), text: '@Nino wat vind je van de test?' })],
      },
      members: { 'spaces/DM1': [{ name: 'users/2002', displayName: 'Anna de Vries', type: 'HUMAN' as const }] },
    }
  }

  it('maakt voorstellen met bron en zoekt ontbrekende namen op', async () => {
    const ctx = scanSetup(data())
    const r = await runChatScan({ repo: ctx.repo, service: ctx.service, google: ctx.google, ai: null }, UID)
    expect(r).toMatchObject({ found: 2, created: 2 })
    const sug = await ctx.repo.listSuggestions(UID)
    const dmS = sug.find((s) => s.source.label === 'Anna de Vries')!
    expect(dmS.title).toBe('Reageren op Anna de Vries: Heb je de cijfers al, voor het overleg van morgen?')
    expect(dmS.source).toMatchObject({ type: 'chat', url: 'https://mail.google.com/mail/u/0/#chat/space/DM1', externalId: expect.stringMatching(/^spaces\/DM1\/messages\//) })
    const roomS = sug.find((s) => s.source.label === 'Team Wehkamp')!
    expect(roomS.title).toMatch(/^Reageren op Anna: @Nino wat vind je/)
    expect(roomS.projectId).toBe('wehkamp') // klant uit de naam van de space
    expect(await ctx.repo.listTodos(UID)).toHaveLength(0)
  })

  it('ontdubbelt bij herhaald scannen en maakt geen tweede voorstel voor dezelfde DM', async () => {
    const d = data()
    const ctx = scanSetup(d)
    const deps = { repo: ctx.repo, service: ctx.service, google: ctx.google, ai: null }
    await runChatScan(deps, UID)
    expect((await runChatScan(deps, UID)).created).toBe(0)
    // Anna stuurt later nog een bericht in dezelfde DM: nog steeds één open voorstel
    d.messages['spaces/DM1'].push(msg('spaces/DM1', { name: 'users/2002', type: 'HUMAN' }, '11:00'))
    const r = await runChatScan(deps, UID)
    expect(r.created).toBe(0)
    expect((await ctx.repo.listSuggestions(UID)).filter((s) => s.source.externalId?.startsWith('spaces/DM1/'))).toHaveLength(1)
  })

  it('meldt een fout als geen enkele chat te lezen was', async () => {
    const ctx = scanSetup({ ...data(), failMessages: true })
    await expect(runChatScan({ repo: ctx.repo, service: ctx.service, google: ctx.google, ai: null, onError: () => undefined }, UID)).rejects.toMatchObject({ code: 'google_unavailable' })
    expect((await ctx.repo.getState(UID)).lastChatScan?.error).toBeTruthy()
  })

  it('weigert zonder chat-toestemming', async () => {
    const ctx = scanSetup({ ...data(), scopes: [] })
    await expect(runChatScan({ repo: ctx.repo, service: ctx.service, google: ctx.google, ai: null }, UID)).rejects.toMatchObject({ code: 'google_scope_missing' })
  })
})
