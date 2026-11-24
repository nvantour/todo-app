import { describe, expect, it } from 'vitest'
import type { Reply } from '../../src/model/types'
import type { GoogleService } from '../src/google'
import { UID, call, personalToken, setup } from './helpers'

const incoming = (over: Record<string, unknown> = {}) => ({
  channel: 'teams',
  externalId: 'teams:chat-1',
  title: 'CRO Wehkamp',
  who: 'Rick',
  target: { url: 'https://teams.microsoft.com/l/chat/1' },
  messages: [{ author: 'Rick', text: 'Wanneer kan het?', at: '2026-11-18T09:00:00Z' }],
  draft: 'Donderdag kan ik.',
  reason: 'Rick vraagt om een moment.',
  ...over,
})

async function withToken() {
  const ctx = setup()
  const token = await personalToken(ctx.repo)
  return { ...ctx, auth: { authorization: `Bearer ${token}` } }
}

describe('antwoorden: ophalen door Claude', () => {
  it('maakt kaarten aan als open, herkent de klant en voorkomt dubbele', async () => {
    const { deps, repo, auth } = await withToken()
    const first = await call(deps, 'POST', '/replies', { replies: [incoming()] }, auth)
    expect(first.body).toEqual({ created: 1, updated: 0, reopened: 0, skipped: 0 })
    const [r] = await repo.listReplies(UID)
    expect(r).toMatchObject({ status: 'open', projectId: 'wehkamp', draft: 'Donderdag kan ik.', draftEdited: false })
    const again = await call(deps, 'POST', '/replies', { replies: [incoming({ draft: 'Vrijdag kan ik.' })] }, auth)
    expect(again.body).toMatchObject({ updated: 1 })
    expect((await repo.listReplies(UID))[0].draft).toBe('Vrijdag kan ik.')
  })

  it('een ronde zonder concept (de scan) werkt de berichten bij en laat het voorstel van Claude staan', async () => {
    const { repo, service } = setup()
    await service.saveReplies(UID, [incoming() as never])
    const later = { author: 'Rick', text: 'Lukt het nog?', at: '2026-11-18T09:30:00Z' }
    const r = await service.saveReplies(UID, [incoming({ draft: '', messages: [...incoming().messages, later] }) as never])
    expect(r).toMatchObject({ updated: 1 })
    const [card] = await repo.listReplies(UID)
    expect(card.draft).toBe('Donderdag kan ik.')
    expect(card.messages).toHaveLength(2)
    // een nieuw gesprek zonder concept wordt gewoon een lege kaart
    await service.saveReplies(UID, [incoming({ externalId: 'teams:chat-2', draft: '' }) as never])
    expect((await repo.listReplies(UID)).find((x) => x.externalId === 'teams:chat-2')).toMatchObject({ status: 'open', draft: '' })
  })

  it('overschrijft een door Nino aangepast antwoord niet', async () => {
    const { deps, repo, auth } = await withToken()
    await call(deps, 'POST', '/replies', { replies: [incoming()] }, auth)
    const [r] = await repo.listReplies(UID)
    await repo.saveReply(UID, { ...r, draft: 'Mijn eigen tekst', draftEdited: true })
    await call(deps, 'POST', '/replies', { replies: [incoming({ draft: 'Nieuw voorstel' })] }, auth)
    expect((await repo.listReplies(UID))[0].draft).toBe('Mijn eigen tekst')
  })

  it('een goedgekeurd antwoord blijft onaangeroerd; verstuurd gaat alleen open bij een nieuw bericht', async () => {
    const { deps, repo, auth } = await withToken()
    await call(deps, 'POST', '/replies', { replies: [incoming()] }, auth)
    const [r] = await repo.listReplies(UID)
    await repo.saveReply(UID, { ...r, status: 'approved' })
    expect((await call(deps, 'POST', '/replies', { replies: [incoming({ draft: 'x' })] }, auth)).body).toMatchObject({ skipped: 1 })
    await repo.saveReply(UID, { ...r, status: 'sent', sentAt: '2026-11-18T09:30:00Z' })
    expect((await call(deps, 'POST', '/replies', { replies: [incoming()] }, auth)).body).toMatchObject({ skipped: 1 })
    const fresh = incoming({ messages: [{ author: 'Rick', text: 'En vrijdag?', at: '2026-11-18T10:00:00Z' }], draft: 'Vrijdag ook.' })
    expect((await call(deps, 'POST', '/replies', { replies: [fresh] }, auth)).body).toMatchObject({ reopened: 1 })
    expect((await repo.listReplies(UID))[0]).toMatchObject({ status: 'open', draft: 'Vrijdag ook.' })
  })

  it('genegeerd na een eerdere verzending: een bericht van vóór het negeren heropent niet', async () => {
    const { deps, repo, auth } = await withToken()
    await call(deps, 'POST', '/replies', { replies: [incoming()] }, auth)
    const [r] = await repo.listReplies(UID)
    const answer = incoming({ messages: [{ author: 'Rick', text: 'En vrijdag?', at: '2026-11-18T10:00:00Z' }] })
    await repo.saveReply(UID, { ...r, status: 'dismissed', sentAt: '2026-11-18T09:30:00Z', updatedAt: '2026-11-18T11:00:00Z' })
    expect((await call(deps, 'POST', '/replies', { replies: [answer] }, auth)).body).toMatchObject({ skipped: 1 })
    const later = incoming({ messages: [{ author: 'Rick', text: 'Nog een vraag', at: '2026-11-18T12:00:00Z' }] })
    expect((await call(deps, 'POST', '/replies', { replies: [later] }, auth)).body).toMatchObject({ reopened: 1 })
  })

  it('kan nooit zelf op goedgekeurd zetten: status in de invoer wordt genegeerd', async () => {
    const { deps, repo, auth } = await withToken()
    await call(deps, 'POST', '/replies', { replies: [incoming({ status: 'approved' })] }, auth)
    expect((await repo.listReplies(UID))[0].status).toBe('open')
  })
})

describe('antwoorden: verzendscript', () => {
  async function approved() {
    const ctx = await withToken()
    await call(ctx.deps, 'POST', '/replies', { replies: [incoming(), incoming({ channel: 'slack', externalId: 's1', target: { url: 'https://app.slack.com/client/T/C' } })] }, ctx.auth)
    const list = await ctx.repo.listReplies(UID)
    await ctx.repo.saveReply(UID, { ...list[0], status: 'approved', approvedAt: '2026-11-18T09:40:00Z' })
    return { ...ctx, reply: list[0] as Reply }
  }

  it('haalt alleen goedgekeurde Teams/Slack-antwoorden op', async () => {
    const { deps, auth, reply } = await approved()
    const res = await call(deps, 'GET', '/replies', undefined, auth, { status: 'approved', channel: 'teams,slack' })
    expect((res.body as { replies: Reply[] }).replies.map((r) => r.id)).toEqual([reply.id])
  })

  it('volgt de stappen goedgekeurd → bezig → verstuurd; andere stappen worden geweigerd', async () => {
    const { deps, auth, reply, repo } = await approved()
    const path = `/replies/${reply.id}/result`
    expect((await call(deps, 'POST', path, { status: 'sent' }, auth)).status).toBe(409)
    expect((await call(deps, 'POST', path, { status: 'sending' }, auth)).status).toBe(200)
    expect((await call(deps, 'POST', path, { status: 'sending' }, auth)).status).toBe(409)
    expect((await call(deps, 'POST', path, { status: 'sent' }, auth)).status).toBe(200)
    expect((await repo.getReply(UID, reply.id))!).toMatchObject({ status: 'sent', error: null })
    expect((await repo.getReply(UID, reply.id))!.sentAt).toBeTruthy()
  })

  it('mislukt met reden', async () => {
    const { deps, auth, reply, repo } = await approved()
    await call(deps, 'POST', `/replies/${reply.id}/result`, { status: 'failed', error: 'Niet ingelogd bij Teams' }, auth)
    expect((await repo.getReply(UID, reply.id))!).toMatchObject({ status: 'failed', error: 'Niet ingelogd bij Teams' })
  })

  it('een open antwoord kan het script niet versturen', async () => {
    const { deps, auth, repo } = await approved()
    const open = (await repo.listReplies(UID)).find((r) => r.status === 'open')!
    expect((await call(deps, 'POST', `/replies/${open.id}/result`, { status: 'sending' }, auth)).status).toBe(409)
  })
})

describe('antwoorden: Google Chat versturen', () => {
  async function gchat() {
    const ctx = await withToken()
    const sent: unknown[] = []
    ctx.deps.google = { sendChat: async (...args: unknown[]) => void sent.push(args) } as unknown as GoogleService
    await call(ctx.deps, 'POST', '/replies', { replies: [incoming({ channel: 'gchat', externalId: 'spaces/A/threads/B', target: { space: 'spaces/A', thread: 'spaces/A/threads/B' } })] }, ctx.auth)
    const [reply] = await ctx.repo.listReplies(UID)
    return { ...ctx, reply, sent }
  }

  it('alleen vanuit de app (ID-token), nooit met het token van Claude', async () => {
    const { deps, auth, reply, sent } = await gchat()
    const res = await call(deps, 'POST', `/replies/${reply.id}/send`, { text: 'Hoi' }, auth)
    expect(res.status).toBe(403)
    expect(sent).toEqual([])
  })

  it('verstuurt in de juiste thread met de tekst uit de app', async () => {
    const { deps, reply, sent } = await gchat()
    const res = await call(deps, 'POST', `/replies/${reply.id}/send`, { text: 'Donderdag 10:00' })
    expect(res.status).toBe(200)
    expect(sent).toEqual([[UID, 'spaces/A', 'Donderdag 10:00', 'spaces/A/threads/B']])
  })
})

describe('antwoorden: Airtable-reactie versturen', () => {
  it('plaatst een antwoord in de draad, alleen vanuit de app', async () => {
    const ctx = await withToken()
    const calls: { url: string; body: unknown }[] = []
    ctx.deps.airtableToken = () => 'pat-test'
    ctx.deps.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    const target = { baseId: 'appAAAAAAAAAAAAAA', tableId: 'tblBBBBBBBBBBBBBB', recordId: 'recCCCCCCCCCCCCCC', parentCommentId: 'comDDDDDDDDDDDDDD' }
    await call(ctx.deps, 'POST', '/replies', { replies: [incoming({ channel: 'airtable', externalId: 'airtable:comDDDDDDDDDDDDDD', target })] }, ctx.auth)
    const [reply] = await ctx.repo.listReplies(UID)
    expect((await call(ctx.deps, 'POST', `/replies/${reply.id}/send`, { text: 'Klopt' }, ctx.auth)).status).toBe(403)
    expect((await call(ctx.deps, 'POST', `/replies/${reply.id}/send`, { text: 'Klopt' })).status).toBe(200)
    expect(calls).toEqual([{ url: 'https://api.airtable.com/v0/appAAAAAAAAAAAAAA/tblBBBBBBBBBBBBBB/recCCCCCCCCCCCCCC/comments', body: { text: 'Klopt', parentCommentId: 'comDDDDDDDDDDDDDD' } }])
  })

  it('geeft een duidelijke melding als het token geen reacties mag plaatsen', async () => {
    const ctx = await withToken()
    ctx.deps.airtableToken = () => 'pat-test'
    ctx.deps.fetch = (async () => new Response(JSON.stringify({ error: { type: 'INVALID_PERMISSIONS' } }), { status: 403 })) as unknown as typeof fetch
    await call(ctx.deps, 'POST', '/replies', { replies: [incoming({ channel: 'airtable', externalId: 'a2', target: { baseId: 'appAAAAAAAAAAAAAA', tableId: 'tblBBBBBBBBBBBBBB', recordId: 'recCCCCCCCCCCCCCC' } })] }, ctx.auth)
    const [reply] = await ctx.repo.listReplies(UID)
    const res = await call(ctx.deps, 'POST', `/replies/${reply.id}/send`, { text: 'x' })
    expect(res.status).toBe(502)
    expect(JSON.stringify(res.body)).toContain('data.recordComments:write')
  })
})
