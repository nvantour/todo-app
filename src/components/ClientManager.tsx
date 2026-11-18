import { useState } from 'react'
import { Archive, ArchiveRestore, Plus } from 'lucide-react'
import type { Project } from '../model/types'
import { store, useAppData } from '../data/store'
import { CLIENT_COLORS } from '../lib/colors'
import { closeClients } from '../ui/overlays'
import { Panel } from './Panel'

export function ClientManager() {
  const { projects } = useAppData()
  const active = projects.filter((p) => !p.archived)
  const archived = projects.filter((p) => p.archived)
  const [name, setName] = useState('')

  function add() {
    const n = name.trim()
    if (!n) return
    // eerste kleur die nog niet gebruikt wordt
    const color = CLIENT_COLORS.find((c) => !projects.some((p) => p.color.toLowerCase() === c.toLowerCase())) ?? CLIENT_COLORS[0]
    store.addProject({ name: n, color })
    setName('')
  }

  return (
    <Panel title="Klanten beheren" onClose={closeClients}>
      <form
        className="add-client"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Naam van nieuwe klant" aria-label="Naam van nieuwe klant" autoComplete="off" />
        <button className="btn is-primary" type="submit" disabled={!name.trim()}>
          <Plus size={15} /> Toevoegen
        </button>
      </form>

      {active.map((p) => (
        <ClientRow key={p.id} project={p} />
      ))}

      {archived.length > 0 && (
        <>
          <h3 className="panel__sub">Gearchiveerd</h3>
          <p className="hint-text">Taken van deze klanten blijven staan op het scherm Taken.</p>
          {archived.map((p) => (
            <div key={p.id} className="client-archived">
              <i style={{ background: p.color }} />
              {p.name}
              <button className="btn" onClick={() => store.updateProject(p.id, { archived: false })}>
                <ArchiveRestore size={15} /> Terugzetten
              </button>
            </div>
          ))}
        </>
      )}
    </Panel>
  )
}

function ClientRow({ project }: { project: Project }) {
  const [name, setName] = useState(project.name)
  const [keywords, setKeywords] = useState(project.keywords.join(', '))

  function saveKeywords() {
    const list = [...new Set(keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean))]
    setKeywords(list.join(', '))
    if (list.join() !== project.keywords.join()) store.updateProject(project.id, { keywords: list })
  }

  return (
    <section className="client-row">
      <div className="client-row__top">
        <i style={{ background: project.color }} />
        <input
          value={name}
          aria-label="Naam"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const n = name.trim()
            if (!n) setName(project.name)
            else if (n !== project.name) store.updateProject(project.id, { name: n })
          }}
        />
        <button className="icon-btn" aria-label={`Archiveren: ${project.name}`} title="Archiveren" onClick={() => store.updateProject(project.id, { archived: true })}>
          <Archive size={16} />
        </button>
      </div>
      <div className="swatches" role="group" aria-label="Kleur">
        {CLIENT_COLORS.map((c) => (
          <button
            key={c}
            className={c.toLowerCase() === project.color.toLowerCase() ? 'is-on' : ''}
            style={{ background: c }}
            aria-label={`Kleur ${c}`}
            onClick={() => store.updateProject(project.id, { color: c })}
          />
        ))}
      </div>
      <label className="field">
        <span>Trefwoorden (met komma's ertussen)</span>
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} onBlur={saveKeywords} placeholder="bv. rai, rai amsterdam" />
      </label>
    </section>
  )
}
