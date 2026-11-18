import { Check, X } from 'lucide-react'
import { store, useAppData } from '../data/store'
import { formatDue } from '../lib/dates'
import { openSuggestions } from '../lib/selectors'

/** Wat AI en koppelingen hebben gevonden; pas een taak na jouw akkoord. */
export function SuggestionsView() {
  const data = useAppData()
  const suggestions = openSuggestions(data)

  return (
    <>
      <header className="view-header">
        <h1>Voorstellen</h1>
        <p>Gevonden in je agenda, mail, meetings en chats. Jij beslist wat een taak wordt.</p>
      </header>

      {suggestions.length === 0 && (
        <div className="empty">
          <strong>Geen voorstellen</strong>
          Zodra er iets gevonden wordt, staat het hier.
        </div>
      )}

      {suggestions.map((s) => {
        const project = data.projects.find((p) => p.id === s.projectId)
        return (
          <div key={s.id} className="suggestion">
            <div>
              <div className="suggestion__title">{s.title}</div>
              <div className="suggestion__reason">{s.reason}</div>
              <div className="item__tags">
                {project && (
                  <span className="tag" style={{ '--c': project.color } as React.CSSProperties}>
                    <i />
                    {project.name}
                  </span>
                )}
                {s.source.label && <span className="tag is-source">{s.source.label}</span>}
                {s.due && <span className="tag is-plain">{formatDue(s.due)}</span>}
              </div>
            </div>
            <button className="round is-yes" aria-label={`Toevoegen: ${s.title}`} onClick={() => store.acceptSuggestion(s.id)}>
              <Check size={18} strokeWidth={2.5} />
            </button>
            <button className="round" aria-label={`Negeren: ${s.title}`} onClick={() => store.dismissSuggestion(s.id)}>
              <X size={18} />
            </button>
          </div>
        )
      })}
    </>
  )
}
