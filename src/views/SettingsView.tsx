import { LogOut } from 'lucide-react'
import { signOut, useSession } from '../data/session'
import { setTheme, useTheme, type Theme } from '../lib/theme'
import { CalendarRules } from './settings/CalendarRules'
import { Connections } from './settings/Connections'
import { GoogleConnection } from './settings/GoogleConnection'
import { Notifications } from './settings/Notifications'

const THEMES: Array<[Theme, string]> = [
  ['system', 'Zoals je apparaat'],
  ['light', 'Licht'],
  ['dark', 'Donker'],
]

export function SettingsView() {
  const theme = useTheme()
  const session = useSession()

  return (
    <>
      <header className="view-header">
        <h1>Instellingen</h1>
      </header>

      <section className="settings__group" aria-labelledby="uiterlijk">
        <h2 id="uiterlijk">Uiterlijk</h2>
        <div className="seg" role="group" aria-label="Thema">
          {THEMES.map(([value, label]) => (
            <button key={value} className={theme === value ? 'is-on' : ''} onClick={() => setTheme(value)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <GoogleConnection />
      <CalendarRules />
      <Notifications />
      <Connections />

      {session.status === 'signedIn' && (
        <section className="settings__group" aria-labelledby="account">
          <h2 id="account">Account</h2>
          <p className="hint-text">Ingelogd als {session.user?.email ?? session.user?.name}</p>
          <button className="btn" onClick={() => void signOut()}>
            <LogOut size={15} /> Uitloggen
          </button>
        </section>
      )}
    </>
  )
}
