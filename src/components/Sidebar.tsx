import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Search, Settings } from 'lucide-react'
import { useAppData } from '../data/store'
import { useSession } from '../data/session'
import { openSearch } from '../ui/overlays'
import { VoiceButton } from '../voice/VoiceButton'
import { openSuggestions, openTodos } from '../lib/selectors'
import { moveTo, setNavOrder, useNavOrder, type NavId } from '../lib/navOrder'
import { NAV_ITEMS } from './navItems'
import { waitingReplies } from '../data/replies'

const active = ({ isActive }: { isActive: boolean }) => `nav-item${isActive ? ' is-active' : ''}`
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function Sidebar() {
  const data = useAppData()
  const { user } = useSession()
  const order = useNavOrder()
  const [dragging, setDragging] = useState<NavId | null>(null)
  const [over, setOver] = useState<NavId | null>(null)
  const suggestions = openSuggestions(data).length
  const todos = openTodos(data).length
  const replies = waitingReplies(data)
  const name = user?.name?.split(' ')[0] ?? 'Nino'

  function badge(id: NavId) {
    if (id === 'taken') return <span className="nav-item__count">{todos || ''}</span>
    if (id === 'voorstellen' && suggestions > 0) return <span className="nav-item__count has-new">{suggestions}</span>
    if (id === 'antwoorden' && replies > 0) return <span className="nav-item__count has-new">{replies}</span>
    return null
  }

  function endDrag() {
    setDragging(null)
    setOver(null)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__account">
        <span className="avatar">{name.charAt(0).toUpperCase()}</span>
        {name}
      </div>

      {order.map((id) => {
        const item = NAV_ITEMS[id]
        const Icon = item.icon
        return (
          <NavLink
            key={id}
            to={item.path}
            className={(s) => `${active(s)}${dragging === id ? ' is-dragging' : ''}${over === id && dragging !== id ? ' is-drop-target' : ''}`}
            draggable
            title="Sleep om de volgorde te veranderen"
            onDragStart={(e) => {
              setDragging(id)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', id)
            }}
            onDragOver={(e) => {
              if (!dragging) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (over !== id) setOver(id)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragging) setNavOrder(moveTo(order, dragging, id))
              endDrag()
            }}
            onDragEnd={endDrag}
          >
            <Icon size={18} />
            {item.label}
            {badge(id)}
          </NavLink>
        )
      })}
      <button className="nav-item" onClick={openSearch}>
        <Search size={18} />
        Zoeken
        <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>

      <span className="spacer" />
      <NavLink to="/instellingen" className={active}>
        <Settings size={18} />
        Instellingen
      </NavLink>
      <VoiceButton variant="sidebar" />
    </aside>
  )
}
