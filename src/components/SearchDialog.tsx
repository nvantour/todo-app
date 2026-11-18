import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useAppData } from '../data/store'
import { searchTodos } from '../lib/selectors'
import { formatDue } from '../lib/dates'
import { flashTodo } from '../ui/jump'
import { closeSearch, useOverlays } from '../ui/overlays'

export function SearchDialog() {
  const { search } = useOverlays()
  return search ? <Dialog /> : null
}

function Dialog() {
  const data = useAppData()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const results = searchTodos(data, query).slice(0, 8)
  const selected = Math.min(index, Math.max(0, results.length - 1))

  function go(id: string) {
    closeSearch()
    navigate('/taken')
    flashTodo(id)
  }

  return (
    <>
      <div className="scrim is-dim" onClick={closeSearch} />
      <div className="search" role="dialog" aria-label="Zoeken">
        <div className="search__input">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            placeholder="Zoek in je open taken"
            aria-label="Zoeken"
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeSearch()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex(Math.min(selected + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex(Math.max(selected - 1, 0))
              } else if (e.key === 'Enter' && results[selected]) go(results[selected].id)
            }}
          />
        </div>
        <ul className="search__results">
          {results.map((t, i) => {
            const project = data.projects.find((p) => p.id === t.projectId)
            return (
              <li key={t.id}>
                <button className={i === selected ? 'is-on' : ''} onMouseEnter={() => setIndex(i)} onClick={() => go(t.id)}>
                  <span className="search__title">{t.title}</span>
                  {project && (
                    <span className="tag" style={{ '--c': project.color } as React.CSSProperties}>
                      <i />
                      {project.name}
                    </span>
                  )}
                  {t.due && <span className="tag is-plain">{formatDue(t.due)}</span>}
                </button>
              </li>
            )
          })}
          {query.trim() && results.length === 0 && <li className="search__empty">Niets gevonden</li>}
          {!query.trim() && <li className="search__empty">Typ een woord uit de taak, de notitie of de klantnaam</li>}
        </ul>
      </div>
    </>
  )
}
