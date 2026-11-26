import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { createMcpServer } from '../src/mcp'
import { UID, setup } from './helpers'

async function connect() {
  const ctx = setup()
  const server = createMcpServer(ctx.service, UID)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1' })
  await Promise.all([server.connect(a), client.connect(b)])
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
    return { ...r, json: () => JSON.parse(r.content[0].text) }
  }
  return { ...ctx, client, call }
}

describe('MCP-tools', () => {
  it('biedt precies de afgesproken tools aan', async () => {
    const { client } = await connect()
    const names = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual(['add_todo', 'complete_todo', 'get_brief', 'list_projects', 'list_reaction_queue', 'list_replies', 'list_todos', 'report_reaction_result', 'save_reply_drafts', 'schedule_todo', 'suggest_todo', 'update_todo'])
  })

  it('geeft in de beschrijvingen de afspraak add_todo / suggest_todo mee', async () => {
    const { client } = await connect()
    const tools = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t.description ?? '']))
    expect(tools.add_todo).toMatch(/literally asks/i)
    expect(tools.suggest_todo).toMatch(/found yourself/i)
    // voorstellen zijn taken; een bericht dat alleen een antwoord vraagt hoort op Antwoorden
    expect(tools.suggest_todo).toMatch(/save_reply_drafts/)
  })

  it('list_replies laat zien welke kaart nog geen concept heeft; met details erbij kan Claude er een schrijven', async () => {
    const { call, service, repo } = await connect()
    // zo zet de scan een kaart klaar: zonder concept
    await service.saveReplies(UID, [
      { channel: 'gchat', externalId: 'spaces/DM1', title: 'DM Anna', who: 'Anna', target: { space: 'spaces/DM1' }, messages: [{ author: 'Anna', text: 'Heb je de cijfers?', at: '2026-11-18T09:00:00.000Z' }], draft: '', reason: 'Anna wacht op je.' },
    ])
    const plain = (await call('list_replies', { status: ['open'] })).json()
    expect(plain.replies[0]).toMatchObject({ externalId: 'spaces/DM1', hasDraft: false })
    expect(plain.replies[0].messages).toBeUndefined()
    const full = (await call('list_replies', { status: ['open'], details: true })).json()
    expect(full.replies[0]).toMatchObject({ hasDraft: false, target: { space: 'spaces/DM1' }, reason: 'Anna wacht op je.', messages: [{ author: 'Anna', text: 'Heb je de cijfers?' }] })
    // Claude schrijft het concept op dezelfde kaart
    const saved = (await call('save_reply_drafts', { replies: [{ channel: 'gchat', externalId: 'spaces/DM1', title: 'DM Anna', who: 'Anna', target: { space: 'spaces/DM1' }, messages: full.replies[0].messages, draft: 'Ja, ik stuur ze zo.' }] })).json()
    expect(saved).toMatchObject({ created: 0, updated: 1 })
    expect(await repo.listReplies(UID)).toHaveLength(1)
    expect((await call('list_replies', {})).json().replies[0].hasDraft).toBe(true)
  })

  it('emoji-wachtrij: Claude ziet alleen wat Nino aanklikte en meldt het resultaat', async () => {
    const { call, service, repo } = await connect()
    await service.saveReplies(UID, [
      { channel: 'slack', externalId: 'slack:C1:1700.1', title: '#od_wrg_wow', who: 'Lisa', target: { url: 'https://app.slack.com/client/T1/C1', channel: 'C1' }, messages: [{ author: 'Lisa', text: 'Verlengen?', at: '2026-11-18T09:00:00.000Z', id: '1700.1' }], draft: 'Ja.' },
    ])
    const [card] = await repo.listReplies(UID)
    expect((await call('list_reaction_queue')).json()).toEqual({ count: 0, reactions: [] })
    const q = { id: 'q1', emoji: '👍', messageId: '1700.1', messageText: 'Verlengen?', messageAuthor: 'Lisa', messageAt: '2026-11-18T09:00:00.000Z', status: 'queued' as const, error: null, createdAt: '2026-11-18T10:00:00Z', doneAt: null }
    await repo.saveReply(UID, { ...card, reactionQueue: [q] })
    const list = (await call('list_reaction_queue')).json()
    expect(list.reactions).toMatchObject([{ replyId: card.id, channel: 'slack', target: { channel: 'C1' }, reaction: { id: 'q1', emoji: '👍', messageId: '1700.1' } }])
    // eerst 'sent' mag niet
    expect((await call('report_reaction_result', { replyId: card.id, reactionId: 'q1', status: 'sent' })).isError).toBe(true)
    await call('report_reaction_result', { replyId: card.id, reactionId: 'q1', status: 'sending' })
    await call('report_reaction_result', { replyId: card.id, reactionId: 'q1', status: 'sent' })
    const after = (await repo.getReply(UID, card.id))!
    expect(after.reactionQueue![0].status).toBe('sent')
    expect(after.messages[0].reactions).toEqual([{ emoji: '👍', count: 1, mine: true }])
    expect((await call('list_reaction_queue')).json().count).toBe(0)
  })

  it('voegt toe, lijst, wijzigt en vinkt af', async () => {
    const { call, repo } = await connect()
    const added = (await call('add_todo', { title: 'Deck voor Wehkamp', due: '2026-11-19' })).json()
    expect(added.added.project).toBe('Wehkamp')
    const id = added.added.id
    expect((await repo.getTodo(UID, id))!.source.type).toBe('claude')

    const list = (await call('list_todos', { filter: 'upcoming:3' })).json()
    expect(list.count).toBe(1)

    const upd = (await call('update_todo', { id, due: null })).json()
    expect(upd.updated.due).toBeNull()
    const done = (await call('complete_todo', { id })).json()
    expect(done.todo.done).toBe(true)
  })

  it('suggest_todo ontdubbelt', async () => {
    const { call } = await connect()
    const args = { title: 'Offerte sturen', reason: 'Genoemd in de meeting', sourceType: 'meeting', sourceLabel: 'Weekly', sourceExternalId: 'm1' }
    expect((await call('suggest_todo', args)).json().created).toBe(true)
    expect((await call('suggest_todo', args)).json()).toMatchObject({ created: false, duplicateOf: 'suggestion' })
  })

  it('meldt fouten als toolfout in plaats van te crashen', async () => {
    const { call } = await connect()
    const r = await call('complete_todo', { id: 'bestaat-niet' })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/Mislukt/)
    const f = await call('list_todos', { filter: 'onzin' })
    expect(f.isError).toBe(true)
  })

  it('get_brief geeft eerst leesbare tekst en dan JSON', async () => {
    const { call } = await connect()
    await call('add_todo', { title: 'Bellen', due: '2026-11-18' })
    const r = await call('get_brief')
    expect(r.content[0].text).toContain('18 november')
    expect(r.content[0].text).toContain('Vandaag (1)')
    expect(JSON.parse(r.content[1].text).date).toBe('2026-11-18')
  })
})
