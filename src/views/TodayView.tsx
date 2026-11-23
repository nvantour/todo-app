import { Link } from 'react-router-dom'
import { MessagesSquare, Sparkles } from 'lucide-react'
import { useAppData } from '../data/store'
import { useSession } from '../data/session'
import { DaySections } from '../components/DaySections'
import { formatLongDate, todayISO } from '../lib/dates'
import { discussionsWithOpenItems, openSuggestions } from '../lib/selectors'

function greeting(hour: number): string {
  if (hour < 12) return 'Goedemorgen'
  if (hour < 18) return 'Goedemiddag'
  return 'Goedenavond'
}

/** Startscherm van het werk-OS: wat er nu speelt, op één plek. */
export function TodayView() {
  const data = useAppData()
  const { user } = useSession()
  const today = todayISO()
  const name = user?.name?.split(' ')[0] ?? 'Nino'
  const suggestions = openSuggestions(data)
  const discussions = discussionsWithOpenItems(data)

  return (
    <>
      <header className="view-header">
        <h1>
          {greeting(new Date().getHours())}, {name}
        </h1>
        <p>{formatLongDate(today)}</p>
      </header>

      {suggestions.length > 0 && (
        <Link to="/voorstellen" className="suggest-banner">
          <Sparkles size={16} />
          <strong>{suggestions.length === 1 ? '1 voorstel' : `${suggestions.length} voorstellen`}</strong>
          <span>{suggestions[0].title}</span>
          <em>Bekijk</em>
        </Link>
      )}

      <DaySections groups={['today', 'week']} />

      {discussions.length > 0 && (
        <section className="section">
          <h2 className="section__head">
            Om te bespreken <span>{discussions.reduce((n, d) => n + d.open, 0)}</span>
          </h2>
          <ul className="today-list">
            {discussions.map(({ discussion, open }) => (
              <li key={discussion.id}>
                <Link to="/bespreken">
                  <MessagesSquare size={16} />
                  <span>{discussion.title}</span>
                  <em>{open === 1 ? '1 punt' : `${open} punten`}</em>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
