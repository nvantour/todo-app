import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { useAppData } from '../data/store'
import { DaySections } from '../components/DaySections'
import { DoneList } from '../components/DoneList'
import { Board } from '../components/Board'
import { formatLongDate, todayISO } from '../lib/dates'
import { openSuggestions } from '../lib/selectors'

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
  const suggestions = openSuggestions(data)

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

      <DaySections groups={['today', 'week', 'later']} todayAddId="add-now" />

      <DoneList />
    </>
  )
}
