import { useState } from 'react'
import { CalendarDays, Database, Plus, Repeat } from 'lucide-react'
import { useAppData } from '../data/store'
import { addFromText } from '../data/addFromText'
import { describeRecurrence, formatDue } from '../lib/dates'
import { findAirtableUrl } from '../lib/airtable'
import { parseQuickAdd } from '../lib/parse'
import type { NewTodo, Project } from '../model/types'

interface Props {
  /** Waar de nieuwe taak terechtkomt (nu / niet vergeten, of een klant). */
  defaults: Partial<NewTodo>
  placeholder?: string
  id?: string
}

/** Toont subtiel wat er in de zin is herkend. */
export function Recognized({ text, projects }: { text: string; projects: Project[] }) {
  if (!text.trim()) return null
  const airtable = findAirtableUrl(text)
  const p = parseQuickAdd(airtable ? airtable.rest : text, projects)
  const project = projects.find((x) => x.id === p.projectId)
  if (!airtable && !project && !p.due && !p.dueTime && !p.recurrence) return null
  return (
    <div className="recognized" aria-live="polite">
      {airtable && (
        <span className="tag is-plain">
          <Database size={12} />
          Airtable-link
        </span>
      )}
      {project && (
        <span className="tag" style={{ '--c': project.color } as React.CSSProperties}>
          <i />
          {project.name}
        </span>
      )}
      {(p.due || p.dueTime) && (
        <span className="tag is-plain">
          <CalendarDays size={12} />
          {[p.due && formatDue(p.due), p.dueTime].filter(Boolean).join(' ')}
        </span>
      )}
      {p.recurrence && (
        <span className="tag is-plain">
          <Repeat size={12} />
          {describeRecurrence(p.recurrence)}
        </span>
      )}
    </div>
  )
}

/** Een lege regel onderaan de lijst: typen, Enter, en je kunt meteen de volgende typen. */
export function AddLine({ defaults, placeholder = 'Nieuwe taak', id }: Props) {
  const [text, setText] = useState('')
  const { projects } = useAppData()

  function submit() {
    if (addFromText(text, projects, defaults)) setText('')
  }

  return (
    <div className="addline">
      <form
        className="item is-add"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <span className="check is-ghost">
          <Plus size={13} strokeWidth={2.5} />
        </span>
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={submit}
          onPaste={(e) => {
            // meerdere regels plakken = meerdere taken
            const pasted = e.clipboardData.getData('text')
            if (!/\r?\n/.test(pasted.trim())) return
            e.preventDefault()
            pasted.split(/\r?\n/).forEach((line) => addFromText(line, projects, defaults))
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          enterKeyHint="done"
          autoComplete="off"
        />
      </form>
      <Recognized text={text} projects={projects} />
    </div>
  )
}
