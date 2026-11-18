import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { useAppData } from '../data/store'
import { AddLine } from '../components/AddLine'
import { ChecklistItem } from '../components/ChecklistItem'
import { DoneList } from '../components/DoneList'
import { formatLongDate, todayISO } from '../lib/dates'
import { openSuggestions, todosInBucket } from '../lib/selectors'

export function TasksView() {
  const data = useAppData()
  const today = todayISO()
  const now = todosInBucket(data, 'now', today)
  const later = todosInBucket(data, 'later', today)
  const suggestions = openSuggestions(data)
  const project = (id: string | null) => data.projects.find((p) => p.id === id)

  return (
    <>
      <header className="view-header">
        <h1>Taken</h1>
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

      <section className="section">
        <h2 className="section__head">
          Om nu te doen <span>{now.length}</span>
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
