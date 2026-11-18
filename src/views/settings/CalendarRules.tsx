import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { CalendarRule } from '../../model/types'
import { store, useAppData } from '../../data/store'

function RuleRow({ rule }: { rule: CalendarRule }) {
  // typen is lokaal; opslaan bij het verlaten van een veld (niet per toetsslag)
  const [match, setMatch] = useState(rule.match)
  const [template, setTemplate] = useState(rule.titleTemplate)
  const [days, setDays] = useState(String(rule.workdaysBefore))

  const saveMatch = () => match.trim() !== rule.match && store.updateRule(rule.id, { match: match.trim() })
  const saveTemplate = () => {
    const t = template.trim() || '{titel} voorbereiden'
    setTemplate(t)
    if (t !== rule.titleTemplate) store.updateRule(rule.id, { titleTemplate: t })
  }
  const saveDays = () => {
    const n = Math.min(30, Math.max(0, Math.round(Number(days) || 0)))
    setDays(String(n))
    if (n !== rule.workdaysBefore) store.updateRule(rule.id, { workdaysBefore: n })
  }

  return (
    <div className={`rule${rule.enabled ? '' : ' is-off'}`}>
      <label className="field">
        <span>Als de afspraak dit woord bevat</span>
        <input value={match} onChange={(e) => setMatch(e.target.value)} onBlur={saveMatch} placeholder="bv. QBR" />
      </label>
      <label className="field">
        <span>Maak deze taak ({'{titel}'} = naam van de afspraak)</span>
        <input value={template} onChange={(e) => setTemplate(e.target.value)} onBlur={saveTemplate} />
      </label>
      <label className="field rule__days">
        <span>Werkdagen ervoor</span>
        <input type="number" min={0} max={30} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} onBlur={saveDays} />
      </label>
      <div className="rule__actions">
        <label className="rule__toggle">
          <input type="checkbox" checked={rule.enabled} onChange={(e) => store.updateRule(rule.id, { enabled: e.target.checked })} />
          Aan
        </label>
        <button className="btn is-quiet-danger" onClick={() => store.deleteRule(rule.id)} aria-label={`Regel “${rule.match || 'zonder woord'}” verwijderen`}>
          <Trash2 size={15} /> Verwijderen
        </button>
      </div>
    </div>
  )
}

/** Regels voor de agenda-scan: een woord in de titel van een afspraak levert een voorstel op. */
export function CalendarRules() {
  const { calendarRules } = useAppData()

  return (
    <section className="settings__group" aria-labelledby="regels">
      <h2 id="regels">Agenda-regels</h2>
      <p className="hint-text">
        Staat het woord in de titel van een afspraak, dan komt er een voorstel voor een voorbereidingstaak, een aantal werkdagen voor de afspraak
        (weekenden tellen niet mee).
      </p>
      {calendarRules.length === 0 && <div className="settings__empty">Nog geen regels. Na het koppelen van Google staat hier de standaardregel “QBR”.</div>}
      {calendarRules.map((r) => (
        <RuleRow key={r.id} rule={r} />
      ))}
      <button className="btn" onClick={() => store.addRule()}>
        <Plus size={15} /> Regel toevoegen
      </button>
    </section>
  )
}
