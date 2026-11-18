import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import './styles/tokens.css'
import './styles/app.css'
import { App } from './App'
import { applyTheme } from './lib/theme'

applyTheme()

// Alleen tijdens ontwikkeling: de opslag bereikbaar maken voor eenmalig overzetten en debuggen.
if (import.meta.env.DEV) import('./data/store').then((m) => Object.assign(window, { __todoStore: m.store }))

// De Chrome-extensie opent nog links als /#/quick-add?text=…; zet die om naar een gewoon pad.
if (location.hash.startsWith('#/')) {
  history.replaceState(null, '', import.meta.env.BASE_URL.replace(/\/$/, '') + location.hash.slice(1))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
