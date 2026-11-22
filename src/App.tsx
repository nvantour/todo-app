import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { MobileNav } from './components/MobileNav'
import { TaskDetail } from './components/TaskDetail'
import { ClientManager } from './components/ClientManager'
import { SearchDialog } from './components/SearchDialog'
import { TodayView } from './views/TodayView'
import { MeetingsView } from './views/ComingSoonView'
import { MailView } from './views/MailView'
import { TasksView } from './views/TasksView'
import { ClientsView } from './views/ClientsView'
import { DiscussionsView } from './views/DiscussionsView'
import { SuggestionsView } from './views/SuggestionsView'
import { SettingsView } from './views/SettingsView'
import { QuickAddPage } from './views/QuickAddPage'
import { ConnectPage } from './views/ConnectPage'
import { LoginScreen } from './views/LoginScreen'
import { useConnection } from './data/connection'
import { openSearch, useOverlays } from './ui/overlays'

export function App() {
  const { status } = useConnection()

  if (status === 'loading') return <div className="splash" role="status">Even laden…</div>
  if (status === 'signedOut') return <LoginScreen />

  return (
    <Routes>
      {/* losstaand: geen zijbalk (Chrome-extensie en snelkoppelingen) */}
      <Route path="/quick-add" element={<QuickAddPage />} />
      {/* toestemming voor de Claude-app; de server stuurt hierheen vanuit /oauth/authorize */}
      <Route path="/koppelen" element={<ConnectPage />} />
      <Route element={<Shell />}>
        <Route path="/vandaag" element={<TodayView />} />
        <Route path="/taken" element={<TasksView />} />
        <Route path="/klanten" element={<ClientsView />} />
        <Route path="/bespreken" element={<DiscussionsView />} />
        <Route path="/meetings" element={<MeetingsView />} />
        <Route path="/mail" element={<MailView />} />
        <Route path="/voorstellen" element={<SuggestionsView />} />
        <Route path="/instellingen" element={<SettingsView />} />
        <Route path="*" element={<Navigate to="/vandaag" replace />} />
      </Route>
    </Routes>
  )
}

function Shell() {
  const navigate = useNavigate()
  // de mail gebruikt de volle breedte en hoogte, zonder de leeskolom
  const mail = useLocation().pathname.startsWith('/mail')
  const { clients } = useOverlays()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K opent zoeken, ook tijdens het typen
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openSearch()
        return
      }
      // Q springt naar de lege regel onder "Vandaag" bij Taken.
      // composedPath: in de mail (Shadow DOM) is e.target de host, niet het veld waarin je typt.
      const el = (e.composedPath()[0] ?? e.target) as HTMLElement
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
      if (e.key.toLowerCase() !== 'q' || typing || e.metaKey || e.ctrlKey || e.altKey || mail) return
      e.preventDefault()
      navigate('/taken')
      window.setTimeout(() => document.getElementById('add-now')?.focus(), 0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, mail])

  return (
    <div className={`shell${mail ? ' is-mail' : ''}`}>
      <Sidebar />
      <main className={`main${mail ? ' is-full' : ''}`}>
        {mail ? (
          <Outlet />
        ) : (
          <div className="content">
            <Outlet />
          </div>
        )}
      </main>
      <MobileNav />
      <TaskDetail />
      {clients && <ClientManager />}
      <SearchDialog />
    </div>
  )
}
