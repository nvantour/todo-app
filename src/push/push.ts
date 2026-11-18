import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging'
import { apiCall, hasServer } from '../data/server'
import { firebaseConfigured, getFirebaseApp } from '../data/session'

// Meldingen op dit apparaat: toestemming vragen, een registratietoken bij Firebase ophalen
// en dat aan de server geven. De server stuurt daarna de meldingen (zie functions/src/push.ts).
// De service worker die ze toont staat in src/sw.ts (één service worker voor offline en meldingen).

const KEY = 'todo-app:push-device'
const VAPID = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined)?.trim() ?? ''

export type PushState =
  | { kind: 'unavailable'; reason: 'no-server' | 'no-key' | 'unsupported' | 'ios-install' }
  | { kind: 'blocked' } // de gebruiker heeft meldingen geweigerd in de browser
  | { kind: 'off' }
  | { kind: 'on'; id: string }

interface Saved {
  id: string
  token: string
}

function saved(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Saved) : null
  } catch {
    return null
  }
}
function remember(v: Saved | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v))
    else localStorage.removeItem(KEY)
  } catch {
    /* alleen voor deze sessie */
  }
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as { standalone?: boolean }).standalone === true

/** Weet dit apparaat meldingen te ontvangen, en staan ze aan? */
export async function pushState(): Promise<PushState> {
  if (!firebaseConfigured || !hasServer()) return { kind: 'unavailable', reason: 'no-server' }
  if (!VAPID) return { kind: 'unavailable', reason: 'no-key' }
  // iPhone en iPad: alleen een app op het beginscherm krijgt meldingen (iOS 16.4 of nieuwer)
  if (isIOS() && !isStandalone()) return { kind: 'unavailable', reason: 'ios-install' }
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !(await isSupported().catch(() => false))) return { kind: 'unavailable', reason: 'unsupported' }
  if (Notification.permission === 'denied') return { kind: 'blocked' }
  const s = saved()
  return Notification.permission === 'granted' && s ? { kind: 'on', id: s.id } : { kind: 'off' }
}

function deviceLabel(): string {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : 'Safari'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return `Android (${browser})`
  if (/Mac/.test(ua)) return `${browser} op Mac`
  if (/Windows/.test(ua)) return `${browser} op Windows`
  return browser
}

/** Een service worker kan ontbreken (ontwikkelversie); wacht daarom niet eindeloos. */
async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => window.setTimeout(() => r(null), 5000))])
  if (!reg) throw new Error('De app is nog niet klaar voor meldingen. Open de geïnstalleerde versie van de app en probeer het opnieuw.')
  return reg
}

/** Zet meldingen aan. Moet rechtstreeks uit een tik of klik komen (iOS eist dat). */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Meldingen zijn niet toegestaan. Zet ze aan in de instellingen van je browser of telefoon.')
  const token = await getToken(getMessaging(getFirebaseApp()), { vapidKey: VAPID, serviceWorkerRegistration: await registration() })
  if (!token) throw new Error('Er kwam geen melding-sleutel terug. Probeer het later opnieuw.')
  const { id } = await apiCall<{ id: string }>('/push/devices', { method: 'POST', body: JSON.stringify({ token, label: deviceLabel() }) })
  remember({ id, token })
}

export async function disablePush(): Promise<void> {
  const s = saved()
  if (s) await apiCall(`/push/devices/${encodeURIComponent(s.id)}`, { method: 'DELETE' }).catch(() => undefined)
  try {
    await deleteToken(getMessaging(getFirebaseApp()))
  } catch {
    /* het token was al weg */
  }
  remember(null)
}

export async function sendTestPush(): Promise<number> {
  return (await apiCall<{ sent: number }>('/push/test', { method: 'POST' })).sent
}
