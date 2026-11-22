import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { useAppData } from '../data/store'
import { AddLine } from '../components/AddLine'
import { ChecklistItem } from '../components/ChecklistItem'
import { DoneList } from '../components/DoneList'
import { Board } from '../components/Board'
import { formatLongDate, todayISO } from '../lib/dates'
import { openSuggestions, todosInBucket } from '../lib/selectors'

type Mode = 'lijst' | 'bord'
const MODE_KEY = 'todo-app:tasks-view'

function savedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'bord' ? 'bord' : 'lijst'
  } catch {
    return 'lijst'
  }
}

export function TasksView() {
  const data = useAppData()
  const [mode, setModeState] = useState<Mode>(savedMode)
  const setMode = (m: Mode) => {
    setModeState(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* alleen voor nu */
    }
  }
  const today = todayISO()
  const now = todosInBucket(data, 'now', today)
  const later = todosInBucket(data, 'later', today)
  const suggestions = openSuggestions(data)
  const project = (id: string | null) => data.projects.find((p) => p.id === id)

  const switcher = (
    <div className="seg view-switch" role="group" aria-label="Weergave">
      <button className={mode === 'lijst' ? 'is-on' : ''} aria-pressed={mode === 'lijst'} onClick={() => setMode('lijst')}>
        Lijst
      </button>
      <button className={mode === 'bord' ? 'is-on' : ''} aria-pressed={mode === 'bord'} onClick={() => setMode('bord')}>
        Bord
      </button>
    </div>
  )

  if (mode === 'bord') {
    return (
      <div className="wide">
        <header className="view-header has-action">
          <div>
            <h1>Taken</h1>
            <p>Sleep een kaart naar een andere kolom, of kies de status op de kaart. Klik op een kolomnaam om hem te hernoemen.</p>
          </div>
          {switcher}
        </header>
        <Board />
      </div>
    )
  }

  return (
    <>
      <header className="view-header has-action">
        <div>
          <h1>Taken</h1>
          <p>{formatLongDate(today)}</p>
        </div>
        {switcher}
      </header>

      {suggestions.length > 0 && (
        <Link to="/voorstellen" className="suggest-banner">
          <Sparkles size={16} />
          <strong>{suggestions.length === 1 ? '1 voorstel' : `${suggestions.length} voorstellen`}</strong>
          <span>{suggestions[0].title}</span>
          <em>Bekijk</em>
        </Link>
      )}

      <section className="section">
        <h2 className="section__head">
          Vandaag <span>{now.length}</span>
        </h2>
        {now.map((t) => (
          <ChecklistItem key={t.id} todo={t} project={project(t.projectId)} />
        ))}
        <AddLine id="add-now" defaults={{ bucket: 'now' }} />
      </section>

      <section className="section">
        <h2 className="section__head">
          Om niet te vergeten <span>{later.length}</span>
        </h2>
        {later.map((t) => (
          <ChecklistItem key={t.id} todo={t} project={project(t.projectId)} />
        ))}
        <AddLine defaults={{ bucket: 'later' }} placeholder="Iets om niet te vergeten" />
      </section>

      <DoneList />
    </>
  )
}
