import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { LayoutGrid, ListChecks, MessagesSquare, MoreHorizontal, Search, Settings, Sparkles } from 'lucide-react'
import { useAppData } from '../data/store'
import { openSuggestions } from '../lib/selectors'
import { openSearch } from '../ui/overlays'
import { VoiceButton } from '../voice/VoiceButton'
import { Panel } from './Panel'

const tab = ({ isActive }: { isActive: boolean }) => `tab${isActive ? ' is-active' : ''}`

export function MobileNav() {
  const suggestions = openSuggestions(useAppData()).length
  const [more, setMore] = useState(false)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <>
      <VoiceButton variant="dock" />
      <nav className="tabbar">
        <NavLink to="/taken" className={tab}>
          <ListChecks size={22} />
          Taken
        </NavLink>
        <NavLink to="/klanten" className={tab}>
          <LayoutGrid size={22} />
          Per klant
        </NavLink>
        <NavLink to="/bespreken" className={tab}>
          <MessagesSquare size={22} />
          Bespreken
        </NavLink>
        <NavLink to="/voorstellen" className={tab}>
          <Sparkles size={22} />
          Voorstellen
          {suggestions > 0 && <span className="tab__badge">{suggestions}</span>}
        </NavLink>
        <button className={`tab${more || pathname.startsWith('/instellingen') ? ' is-active' : ''}`} onClick={() => setMore(true)}>
          <MoreHorizontal size={22} />
          Meer
        </button>
      </nav>

      {more && (
        <Panel title="Meer" onClose={() => setMore(false)}>
          <div className="more-list">
            <button
              onClick={() => {
                setMore(false)
                openSearch()
              }}
            >
              <Search size={18} />
              Zoeken
            </button>
            <button
              onClick={() => {
                setMore(false)
                navigate('/instellingen')
              }}
            >
              <Settings size={18} />
              Instellingen
            </button>
          </div>
        </Panel>
      )}
    </>
  )
}
