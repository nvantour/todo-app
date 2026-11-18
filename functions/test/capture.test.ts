import { describe, expect, it } from 'vitest'
import { normalize, fallbackCapture, runCapture, type AiCapture } from '../src/capture'
import { TODAY, UID, call, projects, setup } from './helpers'

const ctx = { text: '', projects, today: TODAY }

describe('capture zonder AI (vaste parser)', () => {
  it('splitst op regels en leest datum, klant en herhaling', () => {
    const items = fallbackCapture({ ...ctx, text: 'wehkamp deck morgen\nuren schrijven vrijdag\n\nelke week keesing rapport' })
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ projectId: 'wehkamp', due: '2026-11-19', bucket: 'now' })
    expect(items[1].due).toBe('2026-11-20')
    expect(items[2]).toMatchObject({ projectId: 'keesing' })
    expect(items[2].recurrence?.freq).toBe('week')
  })

  it('gebruikt het bronlabel om de klant te herkennen', () => {
    const [item] = fallbackCapture({ ...ctx, text: 'terugbellen', sourceLabel: 'Mail van piet@wehkamp.nl' })
    expect(item.projectId).toBe('wehkamp')
  })

  it('geeft niets terug bij alleen witruimte of opsommingstekens', () => {
    expect(fallbackCapture({ ...ctx, text: '  \n \n' })).toEqual([])
  })
})

describe('runCapture', () => {
  const aiOk: AiCapture = async () => [{ title: 'Deck maken', due: '2026-11-19', dueTime: null, recurrence: null, projectId: 'wehkamp', bucket: 'now' }]

  it('gebruikt de AI als die antwoordt', async () => {
    const r = await runCapture({ ...ctx, text: 'x' }, aiOk)
    expect(r.engine).toBe('ai')
    expect(r.items[0].title).toBe('Deck maken')
  })
  it('valt terug bij een fout en meldt die', async () => {
    const errors: unknown[] = []
    const r = await runCapture({ ...ctx, text: 'wehkamp bellen morgen' }, async () => { throw new Error('stuk') }, (e) => errors.push(e))
    expect(r.engine).toBe('fallback')
    expect(r.items[0].due).toBe('2026-11-19')
    expect(errors).toHaveLength(1)
  })
  it('valt terug zonder sleutel (ai = null)', async () => {
    expect((await runCapture({ ...ctx, text: 'iets doen' }, null)).engine).toBe('fallback')
  })
})

describe('normalize (veiligheidsnet voor AI-uitvoer)', () => {
  it('maakt ongeldige waarden null en laat lege titels weg', () => {
    const items = normalize(
      [
        { title: '  ', due: null, dueTime: null, recurrence: null, projectId: null, bucket: 'now' },
        { title: 'Taak', due: '2026-02-31', dueTime: '25:99', recurrence: { freq: 'week', interval: 0, weekdays: [9] }, projectId: 'bestaat-niet', bucket: 'later' },
      ],
      ctx,
    )
    expect(items).toEqual([{ title: 'Taak', due: null, dueTime: null, recurrence: null, projectId: null, bucket: 'later' }])
  })
  it('geeft de trefwoorden voorrang op de keuze van de AI', () => {
    const [i] = normalize([{ title: 'Keesing offerte', due: null, dueTime: null, recurrence: null, projectId: 'wehkamp', bucket: 'now' }], ctx)
    expect(i.projectId).toBe('keesing')
  })
  it('accepteert een klant-id van de AI als er geen trefwoord matcht', () => {
    const [i] = normalize([{ title: 'Offerte', due: null, dueTime: null, recurrence: null, projectId: 'wehkamp', bucket: 'now' }], ctx)
    expect(i.projectId).toBe('wehkamp')
  })
})

describe('POST /capture', () => {
  it('slaat taken op met de bron uit het verzoek', async () => {
    const { deps, repo } = setup()
    const r = await call(deps, 'POST', '/api/capture', { text: 'wehkamp deck morgen\nuren schrijven', source: { type: 'api', label: 'Siri' } })
    expect(r.status).toBe(201)
    const body = r.body as { engine: string; todos: { id: string; source: { label: string }; projectId: string | null }[] }
    expect(body.engine).toBe('fallback')
    expect(body.todos).toHaveLength(2)
    expect(body.todos[0].source.label).toBe('Siri')
    expect(await repo.listTodos(UID)).toHaveLength(2)
  })

  it('dryRun geeft alleen het resultaat en slaat niets op', async () => {
    const { deps, repo } = setup({ ai: async () => [{ title: 'Bel Piet', due: '2026-11-19', dueTime: '09:00', recurrence: null, projectId: 'keesing', bucket: 'now' }] })
    const r = await call(deps, 'POST', '/capture', { text: 'bel piet morgen om negen uur van keesing', dryRun: true })
    expect(r.status).toBe(200)
    const body = r.body as { dryRun: boolean; engine: string; todos: { projectName: string; dueTime: string }[] }
    expect(body).toMatchObject({ dryRun: true, engine: 'ai' })
    expect(body.todos[0]).toMatchObject({ projectName: 'Keesing', dueTime: '09:00' })
    expect(await repo.listTodos(UID)).toHaveLength(0)
  })

  it('weigert lege tekst', async () => {
    const { deps } = setup()
    expect((await call(deps, 'POST', '/capture', { text: '   ' })).status).toBe(400)
  })
})
