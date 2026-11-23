import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { MoreHorizontal, Search, Settings } from 'lucide-react'
import { useAppData } from '../data/store'
import { openSuggestions } from '../lib/selectors'
import { MOBILE_TABS, useNavOrder } from '../lib/navOrder'
import { openSearch } from '../ui/overlays'
import { VoiceButton } from '../voice/VoiceButton'
import { NAV_ITEMS } from './navItems'
import { waitingReplies } from '../data/replies'
import { Panel } from './Panel'

const tab = ({ isActive }: { isActive: boolean }) => `tab${isActive ? ' is-active' : ''}`

/** Onderbalk op de telefoon: de eerste vier menu-items uit jouw volgorde, de rest onder "Meer". */
export function MobileNav() {
  const data = useAppData()
  const suggestions = openSuggestions(data).length
  const replies = waitingReplies(data)
  const count = (id: string) => (id === 'voorstellen' ? suggestions : id === 'antwoorden' ? replies : 0)
  const order = useNavOrder()
  const [more, setMore] = useState(false)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const tabs = order.slice(0, MOBILE_TABS)
  const rest = order.slice(MOBILE_TABS)
  const restCount = rest.reduce((n, id) => n + count(id), 0)
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
              {count(id) > 0 && <span className="tab__badge">{count(id)}</span>}
            </NavLink>
          )
        })}
        <button className={`tab${more || inMore ? ' is-active' : ''}`} onClick={() => setMore(true)}>
          <MoreHorizontal size={22} />
          Meer
          {restCount > 0 && <span className="tab__badge">{restCount}</span>}
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
