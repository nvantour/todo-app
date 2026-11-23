import { describe, expect, it } from 'vitest'
import { buildTodo } from '../data/logic'
import type { Todo } from '../model/types'
import { openMailTasks } from './mailTasks'

const todo = (over: Partial<Todo>): Todo => ({ ...buildTodo({ title: 't' }, 0), ...over })

describe('mail: welke mails nog een taak zijn', () => {
  it('herkent kaal thread-id, gmail:-id en een link naar de Mail-tab; afgevinkt telt niet', () => {
    const map = openMailTasks([
      todo({ title: 'A', source: { type: 'mail', externalId: '19a1b2c3d4e5f6a7' } }),
      todo({ title: 'B', source: { type: 'mail', externalId: 'gmail:19a1b2c3d4e5f6a8' } }),
      todo({ title: 'C', source: { type: 'mail', url: 'https://work-apps-48770.web.app/mail#mail-19a1b2c3d4e5f6a9' } }),
      todo({ title: 'D', done: true, source: { type: 'mail', externalId: '19a1b2c3d4e5f6b0' } }),
      todo({ title: 'E', source: { type: 'chat', externalId: '19a1b2c3d4e5f6b1' } }),
    ])
    expect([...map.entries()]).toEqual([['19a1b2c3d4e5f6a7', 'A'], ['19a1b2c3d4e5f6a8', 'B'], ['19a1b2c3d4e5f6a9', 'C']])
  })
})
