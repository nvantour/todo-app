import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useAppData } from '../data/store'
import { addFromText } from '../data/addFromText'
import { Recognized } from '../components/AddLine'

/**
 * Losstaande pagina voor de Chrome-extensie en snelkoppelingen (geen zijbalk).
 * Elke regel is een taak. Met autosave=true wordt de tekst uit de link meteen toegevoegd.
 */
export function QuickAddPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { projects } = useAppData()
  const initial = params.get('text') ?? ''
  const [text, setText] = useState(initial)
  const [added, setAdded] = useState<string[]>([])
  const autosaved = useRef(false)
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  function save(source: string) {
    const titles: string[] = []
    for (const line of source.split(/\r?\n/)) {
      const id = addFromText(line, projects)
      if (id) titles.push(line.trim())
    }
    if (!titles.length) return
    setAdded(titles)
    setText('')
    // de link niet bewaren, anders voegt een herlaadslag de taak nog eens toe
    navigate('/quick-add', { replace: true })
    // in het popup-venster van de extensie sluiten we vanzelf
    window.setTimeout(() => window.close(), 1400)
  }

  useEffect(() => {
    if (params.get('autosave') !== 'true' || !initial.trim() || autosaved.current) return
    autosaved.current = true
    save(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bewust één keer bij openen
  }, [])

  return (
    <div className="quick">
      <div className="quick__card">
        <h1>Nieuwe taak</h1>
        {added.length > 0 ? (
          <div className="quick__done" role="status">
            <Check size={18} strokeWidth={2.5} />
            {added.length === 1 ? 'Toegevoegd' : `${added.length} taken toegevoegd`}
            <ul>
              {added.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            <button className="btn" onClick={() => setAdded([])}>
              Nog een taak
            </button>
          </div>
        ) : (
          <>
            <textarea
              autoFocus
              rows={4}
              value={text}
              placeholder={'Bv. Wehkamp deck morgen\nElke vrijdag uren schrijven'}
              aria-label="Taken, één per regel"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(text)
              }}
            />
            <div className="quick__hints">
              {lines.map((line, i) => (
                <Recognized key={i} text={line} projects={projects} />
              ))}
            </div>
            <p className="hint-text">Elke regel wordt een eigen taak.</p>
            <button className="btn is-primary is-big" disabled={!lines.length} onClick={() => save(text)}>
              {lines.length > 1 ? `${lines.length} taken toevoegen` : 'Toevoegen'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
