import { useSyncExternalStore } from 'react'
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth'

// Inloggen en de ingelogde gebruiker. Zonder VITE_FIREBASE_*-variabelen is er geen
// inlog: de app draait dan op de lokale opslag met voorbeelddata.

const env = import.meta.env

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
}

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId)

export function getFirebaseApp(): FirebaseApp {
  if (!firebaseConfigured) throw new Error('Firebase is niet ingesteld (VITE_FIREBASE_* ontbreekt)')
  return getApps().length ? getApp() : initializeApp(firebaseConfig)
}

export interface SessionUser {
  uid: string
  email: string | null
  name: string | null
}

export interface Session {
  /** local = geen Firebase-config, geen inlog. */
  status: 'local' | 'loading' | 'signedOut' | 'signedIn'
  user: SessionUser | null
  /** Laatste inlogfout in gewone taal. */
  error: string | null
}

const toUser = (u: User): SessionUser => ({ uid: u.uid, email: u.email, name: u.displayName })

let session: Session = { status: firebaseConfigured ? 'loading' : 'local', user: null, error: null }
const listeners = new Set<() => void>()
let auth: Auth | null = null

function setSession(next: Partial<Session>) {
  session = { ...session, ...next }
  listeners.forEach((l) => l())
}

export function getSession(): Session {
  return session
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSession(): Session {
  return useSyncExternalStore(subscribeSession, getSession)
}

function getAuthInstance(): Auth {
  auth ??= getAuth(getFirebaseApp())
  return auth
}

if (firebaseConfigured) {
  const a = getAuthInstance()
  onAuthStateChanged(a, (u) => setSession(u ? { status: 'signedIn', user: toUser(u), error: null } : { status: 'signedOut', user: null }))
  // Na een redirect-login (iOS-app op beginscherm) komt het resultaat of een fout hier binnen.
  getRedirectResult(a).catch((e: unknown) => setSession({ error: loginErrorText(e) }))
  // Vangnet: blijft de inlogcontrole hangen (bv. een afgebroken inlogpoging die nooit afrondt),
  // toon dan na een paar seconden het inlogscherm in plaats van eindeloos "Even laden…".
  window.setTimeout(() => {
    if (session.status !== 'loading') return
    try {
      for (const key of Object.keys(sessionStorage)) if (key.startsWith('firebase:pendingRedirect')) sessionStorage.removeItem(key)
    } catch {
      /* opslag niet beschikbaar */
    }
    setSession({ status: 'signedOut', user: null, error: 'Het laden duurde te lang. Log opnieuw in.' })
  }, 8000)
}

function loginErrorText(e: unknown): string {
  const code = (e as { code?: string })?.code ?? ''
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return ''
  if (code === 'auth/network-request-failed') return 'Geen verbinding. Probeer het opnieuw als je online bent.'
  if (code === 'auth/unauthorized-domain') return 'Dit adres is nog niet toegestaan voor inloggen.'
  return 'Inloggen is niet gelukt. Probeer het nog eens.'
}

/** Een app op het beginscherm van een iPhone kan geen popup openen; daar gaat inloggen via een redirect. */
function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export async function signInWithGoogle(): Promise<void> {
  const a = getAuthInstance()
  const provider = new GoogleAuthProvider()
  setSession({ error: null })
  try {
    if (isStandalone()) return await signInWithRedirect(a, provider)
    await signInWithPopup(a, provider)
  } catch (e) {
    const code = (e as { code?: string })?.code ?? ''
    // popup geblokkeerd of niet mogelijk in deze browser: val terug op redirect
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      try {
        return await signInWithRedirect(a, provider)
      } catch (e2) {
        setSession({ error: loginErrorText(e2) })
        return
      }
    }
    setSession({ error: loginErrorText(e) })
  }
}

export async function signOut(): Promise<void> {
  if (firebaseConfigured) await firebaseSignOut(getAuthInstance())
}

// ---- Voor andere onderdelen (bv. spraak) ----

/** Token voor aanroepen naar de eigen serverfuncties; null als niemand is ingelogd. */
export async function getIdToken(): Promise<string | null> {
  if (!firebaseConfigured) return null
  const a = getAuthInstance()
  await a.authStateReady()
  return a.currentUser ? a.currentUser.getIdToken() : null
}

export function currentUser(): SessionUser | null {
  if (!firebaseConfigured) return null
  const u = auth?.currentUser
  return u ? toUser(u) : null
}
