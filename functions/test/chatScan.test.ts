import { describe, expect, it } from 'vitest'
import { findReplyCandidates, spaceUrl } from '../src/chatScan'
import { runReplyScan } from '../src/replyScan'
import type { ChatMessage, ChatSpace } from '../src/googleApi'
import { UID } from './helpers'
import { CHAT_ONLY, ME, scanSetup } from './sources.helpers'

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

describe('link naar het gesprek', () => {
  it('gebruikt de spaceUri als die er is, anders de bekende vorm', () => {
    expect(spaceUrl({ name: 'spaces/AAA', spaceUri: 'https://chat.google.com/room/AAA' })).toBe('https://chat.google.com/room/AAA')
    expect(spaceUrl({ name: 'spaces/AAA' })).toBe('https://mail.google.com/mail/u/0/#chat/space/AAA')
  })
})

describe('antwoorden-scan: Google Chat', () => {
  const recent = '2026-11-18T08:00:00Z'
  const ANNA_DM = { name: 'users/2002', type: 'HUMAN' as const }
  function data() {
    return {
      spaces: [
        { ...dm, lastActiveTime: recent },
        { ...room, lastActiveTime: recent },
        { name: 'spaces/OLD', spaceType: 'SPACE' as const, lastActiveTime: '2026-10-01T00:00:00Z' },
      ],
      messages: {
        'spaces/DM1': [msg('spaces/DM1', ANNA_DM, '09:00', { text: 'Heb je de cijfers al, voor het overleg van morgen?' })],
        'spaces/ROOM1': [msg('spaces/ROOM1', ANNA, '09:00', { annotations: mention(MEU), text: '@Nino wat vind je van de test?' })],
      } as Record<string, ChatMessage[]>,
      members: { 'spaces/DM1': [{ name: 'users/2002', displayName: 'Anna de Vries', type: 'HUMAN' as const }] },
    }
  }
  const depsOf = (ctx: ReturnType<typeof scanSetup>) => ({ repo: ctx.repo, service: ctx.service, google: ctx.google, ai: null, onError: () => undefined })
  const dmCards = async (ctx: ReturnType<typeof scanSetup>) => (await ctx.repo.listReplies(UID)).filter((r) => r.target.space === 'spaces/DM1')

  it('zet kaarten op Antwoorden (zonder concept) en maakt geen voorstellen of taken', async () => {
    const ctx = scanSetup(data())
    const r = await runReplyScan(depsOf(ctx), UID)
    expect(r).toMatchObject({ found: 2, created: 2, closed: 0, channels: { gchat: 2, mail: 0 } })
    const replies = await ctx.repo.listReplies(UID)
    const dmCard = replies.find((x) => x.externalId === 'spaces/DM1')!
    expect(dmCard).toMatchObject({
      channel: 'gchat',
      status: 'open',
      draft: '',
      title: 'DM Anna de Vries', // naam opgezocht in de ledenlijst
      who: 'Anna de Vries',
      url: 'https://mail.google.com/mail/u/0/#chat/space/DM1',
      target: { space: 'spaces/DM1' },
    })
    expect(dmCard.messages).toEqual([{ author: 'Anna de Vries', text: 'Heb je de cijfers al, voor het overleg van morgen?', at: '2026-11-17T09:00:00.000Z' }])
    const roomCard = replies.find((x) => x.externalId === 'spaces/ROOM1/threads/t1')!
    expect(roomCard).toMatchObject({ title: 'Team Wehkamp', who: 'Anna', projectId: 'wehkamp', target: { space: 'spaces/ROOM1', thread: 'spaces/ROOM1/threads/t1' } })
    expect(await ctx.repo.listSuggestions(UID)).toHaveLength(0)
    expect(await ctx.repo.listTodos(UID)).toHaveLength(0)
  })

  it('herhaald scannen maakt geen tweede kaart; een nieuw bericht in dezelfde DM werkt de kaart bij', async () => {
    const d = data()
    const ctx = scanSetup(d)
    await runReplyScan(depsOf(ctx), UID)
    expect((await runReplyScan(depsOf(ctx), UID)).created).toBe(0)
    d.messages['spaces/DM1'].push(msg('spaces/DM1', ANNA_DM, '11:00', { text: 'En de planning?' }))
    expect((await runReplyScan(depsOf(ctx), UID)).created).toBe(0)
    const cards = await dmCards(ctx)
    expect(cards).toHaveLength(1)
    expect(cards[0].messages.map((m) => m.text)).toEqual(['Heb je de cijfers al, voor het overleg van morgen?', 'En de planning?'])
  })

  it('sluit aan op een kaart van Claude: naam, verzendadres, concept en uitleg blijven staan', async () => {
    const ctx = scanSetup(data())
    await ctx.service.saveReplies(UID, [
      {
        channel: 'gchat',
        externalId: 'spaces/DM1/messages/abc',
        title: 'DM Anna',
        who: 'Anna de Vries',
        target: { space: 'spaces/DM1', thread: 'spaces/DM1/threads/t1' },
        messages: [{ author: 'Anna de Vries', text: 'Heb je de cijfers al?', at: '2026-11-17T09:00:00.000Z' }],
        draft: 'Ja, ik stuur ze vanmiddag.',
        reason: 'Anna vraagt om de cijfers.',
      },
    ])
    const r = await runReplyScan(depsOf(ctx), UID)
    expect(r).toMatchObject({ found: 2, created: 1 }) // alleen de vermelding in de space is nieuw
    const cards = await dmCards(ctx)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      externalId: 'spaces/DM1/messages/abc',
      title: 'DM Anna',
      draft: 'Ja, ik stuur ze vanmiddag.',
      reason: 'Anna vraagt om de cijfers.',
      target: { space: 'spaces/DM1', thread: 'spaces/DM1/threads/t1' },
    })
  })

  it('haalt een kaart weg zodra jij in het gesprek hebt gereageerd, en zet hem terug bij een nieuw bericht', async () => {
    const d = data()
    const ctx = scanSetup(d)
    await runReplyScan(depsOf(ctx), UID)
    d.messages['spaces/DM1'].push(msg('spaces/DM1', MEU, '11:00', { text: 'Ja, komt eraan' }))
    expect(await runReplyScan(depsOf(ctx), UID)).toMatchObject({ found: 1, closed: 1 })
    expect((await dmCards(ctx))[0].status).toBe('dismissed')
    // de vermelding in de space is niet beantwoord en blijft dus open
    expect((await ctx.repo.listReplies(UID)).find((x) => x.target.space === 'spaces/ROOM1')?.status).toBe('open')

    d.messages['spaces/DM1'].push(msg('spaces/DM1', ANNA_DM, '12:00', { text: 'Top, en de planning?', createTime: '2026-11-18T10:30:00Z' }))
    expect(await runReplyScan(depsOf(ctx), UID)).toMatchObject({ created: 1 })
    const [card] = await dmCards(ctx)
    expect(card).toMatchObject({ status: 'open', draft: '' })
    expect(card.messages.at(-1)?.text).toBe('Top, en de planning?')
  })

  it('laat een kaart staan waarvan jij het antwoord zelf hebt aangepast', async () => {
    const d = data()
    const ctx = scanSetup(d)
    await runReplyScan(depsOf(ctx), UID)
    const [card] = await dmCards(ctx)
    await ctx.repo.saveReply(UID, { ...card, draft: 'Mijn eigen tekst', draftEdited: true })
    d.messages['spaces/DM1'].push(msg('spaces/DM1', MEU, '11:00'))
    expect((await runReplyScan(depsOf(ctx), UID)).closed).toBe(0)
    expect((await dmCards(ctx))[0]).toMatchObject({ status: 'open', draft: 'Mijn eigen tekst' })
  })

  it('ruimt de oude "Reageren op"-voorstellen van de chatscan op; voorstellen van Claude blijven', async () => {
    const ctx = scanSetup(data())
    await ctx.service.suggest(UID, { title: 'Reageren op Anna: hoi', reason: 'x', bucket: 'now', source: { type: 'chat', label: 'Anna', externalId: 'spaces/DM1/messages/m1' } })
    await ctx.service.suggest(UID, { title: 'Document van Sacha lezen', reason: 'x', bucket: 'now', source: { type: 'chat', label: 'Teams', externalId: 'teams:1' } })
    await runReplyScan(depsOf(ctx), UID)
    const sug = await ctx.repo.listSuggestions(UID)
    expect(sug.find((s) => s.title.startsWith('Reageren op'))?.status).toBe('dismissed')
    expect(sug.find((s) => s.title.startsWith('Document'))?.status).toBe('open')
  })

  it('meldt een fout als er niets te lezen was', async () => {
    const ctx = scanSetup({ ...data(), failMessages: true, scopes: CHAT_ONLY })
    await expect(runReplyScan(depsOf(ctx), UID)).rejects.toMatchObject({ code: 'google_unavailable' })
    expect((await ctx.repo.getState(UID)).lastChatScan?.error).toBeTruthy()
  })

  it('gaat door met mail als de chat niet te lezen is, en meldt dat', async () => {
    const ctx = scanSetup({ ...data(), failMessages: true })
    const r = await runReplyScan(depsOf(ctx), UID)
    expect(r.warning).toMatch(/Google Chat/)
    expect((await ctx.repo.getState(UID)).lastChatScan?.error).toMatch(/Google Chat/)
  })

  it('weigert zonder toestemming voor chat en mail', async () => {
    const ctx = scanSetup({ ...data(), scopes: [] })
    await expect(runReplyScan(depsOf(ctx), UID)).rejects.toMatchObject({ code: 'google_scope_missing' })
  })
})
