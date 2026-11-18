import { Settings2 } from 'lucide-react'
import { useAppData } from '../data/store'
import { AddLine } from '../components/AddLine'
import { ChecklistItem } from '../components/ChecklistItem'
import { todayISO } from '../lib/dates'
import { todosForProject } from '../lib/selectors'
import { openClients } from '../ui/overlays'

/** Raster van klant-blokken: per klant een eigen checklist, plus "Overig". */
export function ClientsView() {
  const data = useAppData()
  const today = todayISO()
  const blocks = [
    ...data.projects.filter((p) => !p.archived).map((p) => ({ id: p.id as string | null, name: p.name, color: p.color })),
    { id: null, name: 'Overig', color: 'var(--ink-3)' },
  ]

  return (
    <div className="wide">
      <header className="view-header has-action">
        <div>
          <h1>Per klant</h1>
          <p>Alle open taken, per klant bij elkaar</p>
        </div>
        <button className="btn" onClick={openClients}>
          <Settings2 size={15} /> Klanten beheren
        </button>
      </header>

      <div className="grid">
        {blocks.map((block) => {
          const todos = todosForProject(data, block.id, today)
          return (
            <section key={block.id ?? 'overig'} className="block">
              <h2 className="block__head">
                <i style={{ background: block.color }} />
                {block.name}
                <span>{todos.length || ''}</span>
              </h2>
              {todos.map((t) => (
                <ChecklistItem key={t.id} todo={t} hideProject markLater />
              ))}
              <AddLine defaults={{ projectId: block.id, bucket: 'now' }} />
            </section>
          )
        })}
      </div>
    </div>
  )
}
