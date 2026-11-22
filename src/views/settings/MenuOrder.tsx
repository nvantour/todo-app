import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'
import { NAV_ITEMS } from '../../components/navItems'
import { MOBILE_TABS, NAV_IDS, moveBy, resetNavOrder, setNavOrder, useNavOrder } from '../../lib/navOrder'

/** Volgorde van het menu. Op de laptop kan het ook door te slepen in de zijbalk. */
export function MenuOrder() {
  const order = useNavOrder()
  const isDefault = order.every((id, i) => id === NAV_IDS[i])

  return (
    <section className="settings__group" aria-labelledby="menu">
      <h2 id="menu">Menu</h2>
      <p className="hint-text">
        Zet de onderdelen in je eigen volgorde. Op de laptop kan het ook door ze in de zijbalk te slepen. Op de telefoon staan de eerste {MOBILE_TABS} in de
        onderbalk, de rest onder Meer. Geldt per apparaat.
      </p>
      <ol className="menu-order">
        {order.map((id, i) => {
          const item = NAV_ITEMS[id]
          const Icon = item.icon
          return (
            <li key={id} className={i === MOBILE_TABS ? 'is-more-start' : undefined}>
              <Icon size={16} />
              <span>{item.label}</span>
              {i < MOBILE_TABS && <em>onderbalk</em>}
              <button className="icon-btn" aria-label={`${item.label} omhoog`} disabled={i === 0} onClick={() => setNavOrder(moveBy(order, id, -1))}>
                <ChevronUp size={16} />
              </button>
              <button className="icon-btn" aria-label={`${item.label} omlaag`} disabled={i === order.length - 1} onClick={() => setNavOrder(moveBy(order, id, 1))}>
                <ChevronDown size={16} />
              </button>
            </li>
          )
        })}
      </ol>
      {!isDefault && (
        <button className="btn" onClick={resetNavOrder}>
          <RotateCcw size={15} /> Standaardvolgorde
        </button>
      )}
    </section>
  )
}
