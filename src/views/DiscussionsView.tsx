import { useState } from 'react'
import { ListPlus, Plus, Trash2 } from 'lucide-react'
import type { Discussion, DiscussionItem } from '../model/types'
import { store, useAppData } from '../data/store'
import { buildDiscussionItem, isHeading, openItemCount, splitLines, toggleDiscussionItem, visibleItems } from '../data/logic'
import { detectProject } from '../lib/detect'

// Alles wat je opslaat gaat via de verse stand uit de store, zodat twee snelle wijzigingen elkaar niet overschrijven.
function changeItems(discussionId: string, fn: (items: DiscussionItem[]) => DiscussionItem[]) {
  const d = store.getSnapshot().discussions.find((x) => x.id === discussionId)
  if (d) store.updateDiscussion(discussionId, { items: fn(d.items) })
}

/** Raster van groepen met punten die je met het team of een klant wilt bespreken. */
export function DiscussionsView() {
  const data = useAppData()
  const [name, setName] = useState('')
  const groups = [...data.discussions].sort((a, b) => a.order - b.order)

  function addGroup() {
    if (!name.trim()) return
    store.addDiscussion(name)
    setName('')
  }

  return (
    <div className="wide">
      <header className="view-header">
        <h1>Om te bespreken</h1>
        <p>Punten voor het team of een klant, per groep bij elkaar</p>
      </header>

      <form
        className="new-group"
        onSubmit={(e) => {
          e.preventDefault()
          addGroup()
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nieuwe groep, bv. een klant of een naam" aria-label="Nieuwe groep" enterKeyHint="done" autoComplete="off" />
        <button type="submit" className="btn" disabled={!name.trim()}>
          <Plus size={15} /> Nieuwe groep
        </button>
      </form>

      {groups.length === 0 && (
        <div className="empty">
          <strong>Nog niets om te bespreken</strong>
          Maak een groep aan, bijvoorbeeld een klant of een collega.
        </div>
      )}

      <div className="grid">
        {groups.map((g) => (
          <GroupBlock key={g.id} group={g} />
        ))}
      </div>
    </div>
  )
}

function GroupBlock({ group }: { group: Discussion }) {
  const { projects } = useAppData()
  const [text, setText] = useState('')
  const project = projects.find((p) => p.id === group.projectId)
  const items = visibleItems(group)

  function saveTitle(el: HTMLElement) {
    const title = (el.textContent ?? '').replace(/:+\s*$/, '').trim()
    if (!title) {
      el.textContent = group.title // een groep zonder naam kan niet
      return
    }
    if (title !== group.title) store.updateDiscussion(group.id, { title, projectId: detectProject(title, projects) })
  }

  function remove() {
    const open = items.length
    if (open > 0 && !window.confirm(`“${group.title}” verwijderen? Er staan nog ${open} ${open === 1 ? 'regel' : 'regels'} in.`)) return
    store.deleteDiscussion(group.id)
  }

  function addLines(raw: string) {
    const lines = splitLines(raw)
    if (lines.length) changeItems(group.id, (list) => [...list, ...lines.map(buildDiscussionItem)])
    return lines.length > 0
  }

  return (
    <section className="block talk" aria-label={group.title}>
      <div className="block__head">
        <i style={{ background: project?.color ?? 'var(--ink-3)' }} />
        <div
          className="talk__title"
          role="textbox"
          aria-label="Naam van de groep"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={(e) => saveTitle(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              e.currentTarget.textContent = group.title
              e.currentTarget.blur()
            }
          }}
        >
          {group.title}
        </div>
        <span>{openItemCount(group) || ''}</span>
        <button className="item__move talk__remove" aria-label={`Groep verwijderen: ${group.title}`} title="Groep verwijderen" onClick={remove}>
          <Trash2 size={14} />
        </button>
      </div>

      {items.map((item) => (
        <TalkItem key={item.id} group={group} item={item} />
      ))}

      <form
        className="item is-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (addLines(text)) setText('')
        }}
      >
        <span className="check is-ghost is-small">
          <Plus size={11} strokeWidth={2.5} />
        </span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => addLines(text) && setText('')}
          onPaste={(e) => {
            // meerdere regels plakken = meerdere punten
            const pasted = e.clipboardData.getData('text')
            if (!/\r?\n/.test(pasted.trim())) return
            e.preventDefault()
            addLines(pasted)
          }}
          placeholder="Nieuw punt"
          aria-label={`Nieuw punt voor ${group.title}`}
          enterKeyHint="done"
          autoComplete="off"
        />
      </form>
    </section>
  )
}

function TalkItem({ group, item }: { group: Discussion; item: DiscussionItem }) {
  const [completing, setCompleting] = useState(false)
  const heading = isHeading(item.text)

  function finish(after?: () => void) {
    if (completing) return
    setCompleting(true)
    window.setTimeout(() => {
      after?.()
      changeItems(group.id, (list) => toggleDiscussionItem(list, item.id))
      setCompleting(false)
    }, 380)
  }

  // Tekst bewerk je zoals in Notes: klik erin en typ. Leeg maken = weg.
  function save(el: HTMLElement) {
    const text = (el.textContent ?? '').trim()
    if (!text) changeItems(group.id, (list) => list.filter((i) => i.id !== item.id))
    else if (text !== item.text) changeItems(group.id, (list) => list.map((i) => (i.id === item.id ? { ...i, text } : i)))
  }

  return (
    <div className={`item${completing ? ' is-completing' : ''}${heading ? ' is-heading' : ''}`}>
      {!heading && (
        <button className={`check is-small${completing ? ' is-done' : ''}`} aria-label={`Besproken: ${item.text}`} onClick={() => finish()}>
          <span className="check__dot" />
        </button>
      )}
      <div className="item__body">
        <span
          className="item__title"
          role="textbox"
          aria-label={heading ? 'Tussenkopje' : 'Punt'}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={(e) => save(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              e.currentTarget.textContent = item.text
              e.currentTarget.blur()
            }
          }}
        >
          {item.text}
        </span>
      </div>
      {!heading && (
        <div className="item__side">
          <button
            className="item__move"
            aria-label={`Maak taak: ${item.text}`}
            title="Maak taak"
            onClick={() => finish(() => store.addTodo({ title: item.text, projectId: group.projectId }))}
          >
            <ListPlus size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
