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
    expect(names).toEqual(['add_todo', 'complete_todo', 'get_brief', 'list_projects', 'list_todos', 'schedule_todo', 'suggest_todo', 'update_todo'])
  })

  it('geeft in de beschrijvingen de afspraak add_todo / suggest_todo mee', async () => {
    const { client } = await connect()
    const tools = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t.description ?? '']))
    expect(tools.add_todo).toMatch(/literally asks/i)
    expect(tools.suggest_todo).toMatch(/found yourself/i)
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
