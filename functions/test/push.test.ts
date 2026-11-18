import { describe, expect, it } from 'vitest'
import type { Todo } from '../../src/model/types'
import { PushService, deadTokens, type PushPayload, type PushSender } from '../src/push'
import { buildTodo } from '../src/service'
import { TODAY, UID, setup } from './helpers'

const TOKEN_A = 'a'.repeat(40)
const TOKEN_B = 'b'.repeat(40)
const mk = (over: Partial<Todo> & { id: string }): Todo => buildTodo({ title: over.id, ...over }, 1, over.id, '2026-11-01T00:00:00.000Z')

function pushSetup(now?: Date, sender?: PushSender) {
  const sent: { tokens: string[]; payload: PushPayload }[] = []
  const send: PushSender = sender ?? (async (tokens, payload) => {
    sent.push({ tokens, payload })
    return { invalid: [], sent: tokens.length }
  })
  const ctx = setup({ now })
  const push = new PushService(ctx.repo, ctx.service, send)
  return { ...ctx, push, sent }
}

describe('apparaten', () => {
  it('registreert een apparaat één keer per token en kan het weer weghalen', async () => {
    const { push, repo } = pushSetup()
    const d = await push.register(UID, TOKEN_A, 'iPhone')
    await push.register(UID, TOKEN_A, 'iPhone')
    expect(await repo.listDevices(UID)).toHaveLength(1)
    expect(await push.unregister('ander', d.id)).toBe(false)
    expect(await push.unregister(UID, d.id)).toBe(true)
    expect(await repo.listDevices(UID)).toHaveLength(0)
  })

  it('ruimt ongeldige tokens op na het versturen', async () => {
    const { push, repo } = pushSetup(undefined, async (tokens) => ({ invalid: [TOKEN_B], sent: tokens.length - 1 }))
    await push.register(UID, TOKEN_A, 'Mac')
    await push.register(UID, TOKEN_B, 'Oude telefoon')
    expect(await push.sendToUser(UID, { title: 't', body: 'b', url: '/', tag: 'x' })).toBe(1)
    expect((await repo.listDevices(UID)).map((d) => d.token)).toEqual([TOKEN_A])
  })
})

describe('deadTokens', () => {
  const tokens = ['a', 'b', 'c']
  it('ruimt niet-geregistreerde tokens op', () => {
    expect(deadTokens(tokens, [{ success: true }, { success: false, code: 'messaging/registration-token-not-registered' }, { success: false, code: 'messaging/internal-error' }])).toEqual(['b'])
  })
  it('telt een ongeldig argument alleen als de rest van de groep wel slaagde', () => {
    expect(deadTokens(['a', 'b'], [{ success: false, code: 'messaging/invalid-argument' }, { success: true }])).toEqual(['a'])
    expect(deadTokens(['a', 'b'], [{ success: false, code: 'messaging/invalid-argument' }, { success: false, code: 'messaging/invalid-argument' }])).toEqual([])
  })
})

describe('ochtendmelding', () => {
  it('stuurt één melding met de taken van vandaag en niet twee keer op dezelfde dag', async () => {
    const { push, repo, sent } = pushSetup()
    await push.register(UID, TOKEN_A, 'iPhone')
    for (const t of [mk({ id: 'Offerte', due: '2026-11-16' }), mk({ id: 'Bellen', due: TODAY }), mk({ id: 'Rapport', due: TODAY }), mk({ id: 'Morgen', due: '2026-11-19' }), mk({ id: 'Deck', due: TODAY }), mk({ id: 'Mail', due: TODAY })]) await repo.saveTodo(UID, t)
    expect(await push.morning(UID)).toBe(true)
    expect(await push.morning(UID)).toBe(false)
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.title).toBe('Vandaag: 5 taken')
    expect(sent[0].payload.body).toContain('Offerte')
    expect(sent[0].payload.body).toContain('en 2 meer')
    expect(sent[0].payload.body).toContain('1 achterstallig')
  })

  it('stuurt niets als er niets is, of als er geen apparaat is', async () => {
    const a = pushSetup()
    await a.push.register(UID, TOKEN_A, 'iPhone')
    expect(await a.push.morning(UID)).toBe(false)
    const b = pushSetup()
    await b.repo.saveTodo(UID, mk({ id: 'x', due: TODAY }))
    expect(await b.push.morning(UID)).toBe(false)
    expect(a.sent).toHaveLength(0)
    expect(b.sent).toHaveLength(0)
  })
})

describe('melding op taaktijd (niet dubbel)', () => {
  // 11:00 in Nederland
  it('meldt een taak zodra de tijd er is, één keer, ook bij herhaalde rondes', async () => {
    const { push, repo, sent } = pushSetup()
    await push.register(UID, TOKEN_A, 'iPhone')
    await repo.saveTodo(UID, mk({ id: 'Nu', due: TODAY, dueTime: '10:58' }))
    await repo.saveTodo(UID, mk({ id: 'Later', due: TODAY, dueTime: '14:00' }))
    await repo.saveTodo(UID, mk({ id: 'Te-laat', due: TODAY, dueTime: '09:00' })) // meer dan 30 minuten geleden
    await repo.saveTodo(UID, mk({ id: 'Zonder-tijd', due: TODAY }))
    await repo.saveTodo(UID, mk({ id: 'Klaar', due: TODAY, dueTime: '10:55', done: true }))
    expect(await push.dueNow(UID)).toBe(1)
    expect(await push.dueNow(UID)).toBe(0)
    expect(await push.dueNow(UID)).toBe(0)
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.title).toBe('10:58 · Nu')
  })

  it('meldt opnieuw als de tijd van de taak wijzigt', async () => {
    const { push, repo, sent } = pushSetup()
    await push.register(UID, TOKEN_A, 'iPhone')
    await repo.saveTodo(UID, mk({ id: 'T', due: TODAY, dueTime: '10:50' }))
    await push.dueNow(UID)
    await repo.saveTodo(UID, mk({ id: 'T', due: TODAY, dueTime: '10:55' }))
    await push.dueNow(UID)
    expect(sent).toHaveLength(2)
  })

  it('heeft geen apparaat nodig om te weten dat er niets te doen is', async () => {
    const { push, repo, sent } = pushSetup()
    await repo.saveTodo(UID, mk({ id: 'T', due: TODAY, dueTime: '10:50' }))
    expect(await push.dueNow(UID)).toBe(0)
    expect(sent).toHaveLength(0)
  })
})
