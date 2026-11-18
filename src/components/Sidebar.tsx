import { NavLink } from 'react-router-dom'
import { LayoutGrid, ListChecks, MessagesSquare, Search, Settings, Sparkles } from 'lucide-react'
import { useAppData } from '../data/store'
import { useSession } from '../data/session'
import { openSearch } from '../ui/overlays'
import { VoiceButton } from '../voice/VoiceButton'
import { openSuggestions, openTodos } from '../lib/selectors'

const active = ({ isActive }: { isActive: boolean }) => `nav-item${isActive ? ' is-active' : ''}`
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function Sidebar() {
  const data = useAppData()
  const { user } = useSession()
  const suggestions = openSuggestions(data).length
  const name = user?.name?.split(' ')[0] ?? 'Nino'

  return (
    <aside className="sidebar">
      <div className="sidebar__account">
        <span className="avatar">{name.charAt(0).toUpperCase()}</span>
        {name}
      </div>

      <NavLink to="/taken" className={active}>
        <ListChecks size={18} />
        Taken
        <span className="nav-item__count">{openTodos(data).length || ''}</span>
      </NavLink>
      <NavLink to="/klanten" className={active}>
        <LayoutGrid size={18} />
        Per klant
      </NavLink>
      <NavLink to="/bespreken" className={active}>
        <MessagesSquare size={18} />
        Om te bespreken
      </NavLink>
      <NavLink to="/voorstellen" className={active}>
        <Sparkles size={18} />
        Voorstellen
        {suggestions > 0 && <span className="nav-item__count has-new">{suggestions}</span>}
      </NavLink>
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
