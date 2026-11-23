import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

const CHECK_EVERY = 30 * 60 * 1000

/**
 * Meldt dat er een nieuwe versie klaarstaat. De service worker neemt een nieuwe versie direct over,
 * maar een geopende app draait de oude code tot je herlaadt. Herladen gebeurt pas na een klik,
 * zodat je niets kwijtraakt waar je mee bezig bent.
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null
    if (!sw) return
    // Bij de allereerste installatie is er nog geen oude versie: dan niets melden.
    const hadController = !!sw.controller
    const onChange = () => {
      if (hadController) setReady(true)
    }
    sw.addEventListener('controllerchange', onChange)

    // Een app die lang openstaat kijkt zelf af en toe of er iets nieuws is.
    const check = () => {
      void sw.getRegistration().then((r) => r?.update()).catch(() => undefined)
    }
    const onVisible = () => {
      if (!document.hidden) check()
    }
    const timer = window.setInterval(check, CHECK_EVERY)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    return () => {
      sw.removeEventListener('controllerchange', onChange)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
      clearInterval(timer)
    }
  }, [])

  if (!ready) return null
  return (
    <div className="update-banner" role="status">
      <RefreshCw size={15} />
      <span>Er is een nieuwe versie van de app.</span>
      <button className="update-banner__go" onClick={() => window.location.reload()}>
        Herladen
      </button>
      <button className="update-banner__later" onClick={() => setReady(false)}>
        Later
      </button>
    </div>
  )
}
