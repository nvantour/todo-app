import { useState } from 'react'
import type { NewTodo, Project } from '../model/types'
import { store, useAppData } from '../data/store'
import { todayISO, weekStart } from '../lib/dates'
import { moveToGroup, todosInGroup, type DayGroup } from '../lib/selectors'
import { AddLine } from './AddLine'
import { ChecklistItem } from './ChecklistItem'
import { TODO_DRAG_TYPE } from './dragTodo'

interface GroupDef {
  group: DayGroup
  title: string
  placeholder: string
  empty: string
}

const GROUPS: Record<DayGroup, GroupDef> = {
  today: { group: 'today', title: 'Vandaag', placeholder: 'Iets voor vandaag', empty: 'Sleep hier een taak heen voor vandaag' },
  week: { group: 'week', title: 'Deze week', placeholder: 'Iets voor deze week', empty: 'Sleep hier een taak heen voor later deze week' },
  later: { group: 'later', title: 'Om niet te vergeten', placeholder: 'Iets om niet te vergeten', empty: 'Sleep hier een taak heen om niet te vergeten' },
}

const addDefaults = (group: DayGroup, today: string): Partial<NewTodo> =>
  group === 'later' ? { bucket: 'later' } : group === 'week' ? { bucket: 'now', weekOf: weekStart(today) } : { bucket: 'now' }

/**
 * Vandaag, Deze week en (op Taken) Om niet te vergeten onder elkaar.
 * Sleep een taak aan het greepje naar een andere groep; op de telefoon kan het via het detail ("Wanneer").
 * `todayAddId` geeft de lege regel onder "Vandaag" een id (Taken gebruikt dat voor de sneltoets Q).
 */
export function DaySections({ groups, todayAddId }: { groups: DayGroup[]; todayAddId?: string }) {
  const data = useAppData()
  const today = todayISO()
  const [over, setOver] = useState<DayGroup | null>(null)
  const [dragging, setDragging] = useState(false)
  const project = (id: string | null): Project | undefined => data.projects.find((p) => p.id === id)

  function drop(group: DayGroup, id: string) {
    const todo = data.todos.find((t) => t.id === id)
    const patch = todo && moveToGroup(todo, group, today)
    if (todo && patch) store.updateTodo(todo.id, patch)
  }

  return (
    <div
      className={dragging ? 'day-sections is-dragging' : 'day-sections'}
      onDragStart={(e) => {
        if (e.dataTransfer.types.includes(TODO_DRAG_TYPE)) setDragging(true)
      }}
      onDragEnd={() => {
        setDragging(false)
        setOver(null)
      }}
    >
      {groups.map((g) => {
        const def = GROUPS[g]
        const todos = todosInGroup(data, g, today)
        return (
          <section
            key={g}
            className={`section drop-zone${over === g ? ' is-over' : ''}`}
            aria-label={def.title}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(TODO_DRAG_TYPE)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (over !== g) setOver(g)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === g ? null : o))
            }}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData(TODO_DRAG_TYPE)
              setOver(null)
              setDragging(false)
              if (id) drop(g, id)
            }}
          >
            <h2 className="section__head">
              {def.title} <span>{todos.length}</span>
            </h2>
            {todos.map((t) => (
              <ChecklistItem key={t.id} todo={t} project={project(t.projectId)} draggable />
            ))}
            {dragging && <div className="drop-zone__hint">{def.empty}</div>}
            <AddLine id={g === 'today' ? todayAddId : undefined} defaults={addDefaults(g, today)} placeholder={def.placeholder} />
          </section>
        )
      })}
    </div>
  )
}
