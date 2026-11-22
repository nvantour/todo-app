import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { MoreHorizontal, Search, Settings } from 'lucide-react'
import { useAppData } from '../data/store'
import { openSuggestions } from '../lib/selectors'
import { MOBILE_TABS, useNavOrder } from '../lib/navOrder'
import { openSearch } from '../ui/overlays'
import { VoiceButton } from '../voice/VoiceButton'
import { NAV_ITEMS } from './navItems'
import { Panel } from './Panel'

const tab = ({ isActive }: { isActive: boolean }) => `tab${isActive ? ' is-active' : ''}`

/** Onderbalk op de telefoon: de eerste vier menu-items uit jouw volgorde, de rest onder "Meer". */
export function MobileNav() {
  const suggestions = openSuggestions(useAppData()).length
  const order = useNavOrder()
  const [more, setMore] = useState(false)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const tabs = order.slice(0, MOBILE_TABS)
  const rest = order.slice(MOBILE_TABS)
  const inMore = [...rest.map((id) => NAV_ITEMS[id].path), '/instellingen'].some((p) => pathname.startsWith(p))

  const go = (path: string) => {
    setMore(false)
    navigate(path)
  }

  return (
    <>
      <VoiceButton variant="dock" />
      <nav className="tabbar">
        {tabs.map((id) => {
          const item = NAV_ITEMS[id]
          const Icon = item.icon
          return (
            <NavLink key={id} to={item.path} className={tab}>
              <Icon size={22} />
              {item.short}
              {id === 'voorstellen' && suggestions > 0 && <span className="tab__badge">{suggestions}</span>}
            </NavLink>
          )
        })}
        <button className={`tab${more || inMore ? ' is-active' : ''}`} onClick={() => setMore(true)}>
          <MoreHorizontal size={22} />
          Meer
          {rest.includes('voorstellen') && suggestions > 0 && <span className="tab__badge">{suggestions}</span>}
        </button>
      </nav>

      {more && (
        <Panel title="Meer" onClose={() => setMore(false)}>
          <div className="more-list">
            {rest.map((id) => {
              const item = NAV_ITEMS[id]
              const Icon = item.icon
              return (
                <button key={id} onClick={() => go(item.path)}>
                  <Icon size={18} />
                  {item.label}
                </button>
              )
            })}
            <button
              onClick={() => {
                setMore(false)
                openSearch()
              }}
            >
              <Search size={18} />
              Zoeken
            </button>
            <button onClick={() => go('/instellingen')}>
              <Settings size={18} />
              Instellingen
            </button>
          </div>
        </Panel>
      )}
    </>
  )
}
