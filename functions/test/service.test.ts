import { describe, expect, it } from 'vitest'
import type { Todo } from '../../src/model/types'
import { buildBrief } from '../src/brief'
import { buildTodo, parseFilter } from '../src/service'
import { TODAY, UID, setup } from './helpers'

const mk = (over: Partial<Todo> & { id: string }): Todo => buildTodo({ title: over.id, ...over }, 1, over.id, '2026-11-01T00:00:00.000Z')

async function seed(todos: Todo[]) {
  const ctx = setup()
  for (const t of todos) await ctx.repo.saveTodo(UID, t)
  return ctx
}

describe('filters', () => {
  it('splitst now / later / overdue / upcoming / project', async () => {
    const { service } = await seed([
      mk({ id: 'a-nu', bucket: 'now' }),
      mk({ id: 'b-later', bucket: 'later' }),
      mk({ id: 'c-later-vandaag', bucket: 'later', due: TODAY }), // schuift vanzelf naar nu
      mk({ id: 'd-achterstallig', bucket: 'later', due: '2026-11-10' }),
      mk({ id: 'e-morgen', bucket: 'later', due: '2026-11-19' }),
      mk({ id: 'f-over-5', bucket: 'later', due: '2026-11-23', projectId: 'wehkamp' }),
      mk({ id: 'g-klaar', done: true }),
    ])
    const ids = async (f: string) => (await service.listTodos(UID, parseFilter(f))).map((t) => t.id)
    expect(await ids('now')).toEqual(expect.arrayContaining(['a-nu', 'c-later-vandaag', 'd-achterstallig']))
    expect(await ids('now')).not.toContain('b-later')
    expect(await ids('later')).toEqual(expect.arrayContaining(['b-later', 'e-morgen', 'f-over-5']))
    expect(await ids('overdue')).toEqual(['d-achterstallig'])
    expect(await ids('upcoming:1')).toEqual(['e-morgen'])
    expect(await ids('upcoming:7')).toEqual(['e-morgen', 'f-over-5'])
    expect(await ids('project:wehkamp')).toEqual(['f-over-5'])
    expect(await ids('project:none')).toContain('a-nu')
    expect(await ids('all')).not.toContain('g-klaar')
  })

  it('weigert een onbekend filter', () => {
    expect(() => parseFilter('onzin')).toThrow(/Onbekend filter/)
  })

  it('past een limiet toe', async () => {
    const { service } = await seed([mk({ id: 'a' }), mk({ id: 'b' }), mk({ id: 'c' })])
    expect(await service.listTodos(UID, { kind: 'all' }, 2)).toHaveLength(2)
  })
})

describe('brief', () => {
  it('geeft secties, datum en leesbare tekst', async () => {
    const { service, repo } = await seed([
      mk({ id: 'achter', due: '2026-11-16', title: 'Offerte', projectId: 'wehkamp' }),
      mk({ id: 'vandaag', due: TODAY, dueTime: '14:00', title: 'Bellen' }),
      mk({ id: 'morgen', due: '2026-11-19', title: 'Rapport' }),
      mk({ id: 'ver', due: '2026-12-24', bucket: 'later', title: 'Ver weg' }),
      mk({ id: 'zonder', title: 'Zonder datum' }),
    ])
    await service.suggest(UID, { title: 'Actiepunt', source: { type: 'meeting', label: 'Weekly', externalId: 'm1' } })
    const b = await buildBrief(service, UID)
    expect(b.date).toBe(TODAY)
    expect(b.dateLabel).toContain('18 november')
    expect(b.overdue.map((t) => t.id)).toEqual(['achter'])
    expect(b.today.map((t) => t.id)).toEqual(['vandaag'])
    expect(b.upcoming.map((t) => t.id)).toEqual(['morgen'])
    expect(b.now.map((t) => t.id)).toEqual(expect.arrayContaining(['achter', 'vandaag', 'zonder']))
    expect(b.suggestions).toHaveLength(1)
    expect(b.text).toContain('Achterstallig (1)')
    expect(b.text).toContain('Offerte (Wehkamp')
    expect(b.text).toContain('Voorstellen om te beoordelen (1)')
    expect(b.text).not.toContain('Ver weg')
    void repo
  })

  it('zegt dat er niets open is', async () => {
    const { service } = setup()
    expect((await buildBrief(service, UID)).text).toContain('Niets open')
  })
})

describe('afvinken', () => {
  it('vinkt een gewone taak af en is idempotent', async () => {
    const { service } = await seed([mk({ id: 't' })])
    const r = await service.completeTodo(UID, 't')
    expect(r.todo.done).toBe(true)
    expect(r.todo.completedAt).not.toBeNull()
    expect((await service.completeTodo(UID, 't')).alreadyDone).toBe(true)
  })

  it('schuift een terugkerende taak door naar de volgende datum (na vandaag)', async () => {
    const { service } = await seed([
      mk({ id: 'wekelijks', due: '2026-11-04', recurrence: { freq: 'week', interval: 1, weekdays: [3] }, subtasks: [{ id: 's', title: 's', done: true }] }),
    ])
    const r = await service.completeTodo(UID, 'wekelijks')
    expect(r.recurred).toBe(true)
    expect(r.todo.done).toBe(false)
    expect(r.todo.due).toBe('2026-11-25') // eerstvolgende woensdag na vandaag (18 nov)
    expect(r.todo.subtasks[0].done).toBe(false)
  })

  it('zonder datum telt een herhaling vanaf vandaag', async () => {
    const { service } = await seed([mk({ id: 'dag', recurrence: { freq: 'day', interval: 1 } })])
    expect((await service.completeTodo(UID, 'dag')).todo.due).toBe('2026-11-19')
  })

  it('PATCH met done:true gedraagt zich als afvinken, done:false zet terug', async () => {
    const { service } = await seed([mk({ id: 'x', done: true, completedAt: '2026-11-01T00:00:00.000Z' })])
    const back = await service.updateTodo(UID, 'x', { done: false })
    expect(back.done).toBe(false)
    expect(back.completedAt).toBeNull()
    const again = await service.updateTodo(UID, 'x', { done: true, title: 'Nieuw' })
    expect(again.done).toBe(true)
    expect(again.title).toBe('Nieuw')
  })

  it('geeft een nette fout bij een onbekende taak', async () => {
    const { service } = setup()
    await expect(service.completeTodo(UID, 'bestaat-niet')).rejects.toThrow(/bestaat niet/)
  })
})

describe('klant herkennen', () => {
  it('herkent de klant uit titel, bronlabel en e-maildomein', async () => {
    const { service } = setup()
    expect((await service.addTodo(UID, { title: 'Deck voor Wehkamp' })).projectId).toBe('wehkamp')
    expect((await service.addTodo(UID, { title: 'Antwoorden', source: { type: 'mail', label: 'Re: vraag van jan@keesing.com' } })).projectId).toBe('keesing')
    expect((await service.addTodo(UID, { title: 'Iets', source: { type: 'mail', label: 'mail van piet@wehkamp.nl' } })).projectId).toBe('wehkamp')
    expect((await service.addTodo(UID, { title: 'Iets zonder klant' })).projectId).toBeNull()
    // gearchiveerde klanten tellen niet mee
    expect((await service.addTodo(UID, { title: 'oudklant bellen' })).projectId).toBeNull()
  })
})

describe('voorstellen ontdubbelen', () => {
  const src = { type: 'meeting' as const, label: 'Weekly', externalId: 'm-1' }

  it('maakt één voorstel per bronitem', async () => {
    const { service } = setup()
    const first = await service.suggest(UID, { title: 'A', source: src })
    const second = await service.suggest(UID, { title: 'A anders verwoord', source: src })
    expect(first.created).toBe(true)
    expect(second).toMatchObject({ created: false, duplicateOf: 'suggestion' })
    expect(await service.repo.listSuggestions(UID)).toHaveLength(1)
  })

  it('geldt ook voor afgewezen en geaccepteerde voorstellen', async () => {
    const { service, repo } = setup()
    const { suggestion } = await service.suggest(UID, { title: 'A', source: src })
    await repo.saveSuggestion(UID, { ...suggestion!, status: 'dismissed' })
    expect((await service.suggest(UID, { title: 'A', source: src })).created).toBe(false)
    await repo.saveSuggestion(UID, { ...suggestion!, status: 'accepted' })
    expect((await service.suggest(UID, { title: 'A', source: src })).created).toBe(false)
  })

  it('geldt ook tegen bestaande taken', async () => {
    const { service } = setup()
    await service.addTodo(UID, { title: 'Al een taak', source: { type: 'mail', externalId: 'thread-9' } })
    const r = await service.suggest(UID, { title: 'Zelfde mail', source: { type: 'mail', externalId: 'thread-9' } })
    expect(r).toMatchObject({ created: false, duplicateOf: 'todo' })
  })

  it('houdt type en id uit elkaar', async () => {
    const { service } = setup()
    await service.suggest(UID, { title: 'A', source: { type: 'mail', externalId: '1' } })
    expect((await service.suggest(UID, { title: 'B', source: { type: 'chat', externalId: '1' } })).created).toBe(true)
  })

  it('zonder externalId ontdubbelt niets', async () => {
    const { service } = setup()
    await service.suggest(UID, { title: 'A', source: { type: 'claude' } })
    expect((await service.suggest(UID, { title: 'A', source: { type: 'claude' } })).created).toBe(true)
  })
})
