import { NavLink } from 'react-router-dom'
import { LayoutGrid, ListChecks, Search, Settings, Sparkles } from 'lucide-react'
import { useAppData } from '../data/store'
import { openSuggestions } from '../lib/selectors'
import { openSearch } from '../ui/overlays'
import { VoiceButton } from '../voice/VoiceButton'

const tab = ({ isActive }: { isActive: boolean }) => `tab${isActive ? ' is-active' : ''}`

export function MobileNav() {
  const suggestions = openSuggestions(useAppData()).length

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
        <NavLink to="/voorstellen" className={tab}>
          <Sparkles size={22} />
          Voorstellen
          {suggestions > 0 && <span className="tab__badge">{suggestions}</span>}
        </NavLink>
        <button className="tab" onClick={openSearch}>
          <Search size={22} />
          Zoeken
        </button>
        <NavLink to="/instellingen" className={tab}>
          <Settings size={22} />
          Instellingen
        </NavLink>
      </nav>
    </>
  )
}
