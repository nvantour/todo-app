import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { MobileNav } from './components/MobileNav'
import { TaskDetail } from './components/TaskDetail'
import { ClientManager } from './components/ClientManager'
import { SearchDialog } from './components/SearchDialog'
import { TasksView } from './views/TasksView'
import { ClientsView } from './views/ClientsView'
import { SuggestionsView } from './views/SuggestionsView'
import { SettingsView } from './views/SettingsView'
import { QuickAddPage } from './views/QuickAddPage'
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
      <Route element={<Shell />}>
        <Route path="/taken" element={<TasksView />} />
        <Route path="/klanten" element={<ClientsView />} />
        <Route path="/voorstellen" element={<SuggestionsView />} />
        <Route path="/instellingen" element={<SettingsView />} />
        <Route path="*" element={<Navigate to="/taken" replace />} />
      </Route>
    </Routes>
  )
}

function Shell() {
  const navigate = useNavigate()
  const { clients } = useOverlays()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K opent zoeken, ook tijdens het typen
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openSearch()
        return
      }
      // Q springt naar de lege regel onder "Om nu te doen"
      const el = e.target as HTMLElement
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
      if (e.key.toLowerCase() !== 'q' || typing || e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      navigate('/taken')
      window.setTimeout(() => document.getElementById('add-now')?.focus(), 0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <div className="content">
          <Outlet />
        </div>
      </main>
      <MobileNav />
      <TaskDetail />
      {clients && <ClientManager />}
      <SearchDialog />
    </div>
  )
}
