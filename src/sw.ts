/// <reference lib="webworker" />
// De ene service worker van de app: offline gebruiken (voorgebouwde bestanden) én meldingen tonen.
// Gebouwd door vite-plugin-pwa (strategie injectManifest); zie vite.config.ts.
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { initializeApp } from 'firebase/app'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Alleen echte pagina's van de app terugvallen op index.html. Adressen die door de server beantwoord
// worden (de terugkeer van Google, de toestemmingspagina van Claude) moeten naar het netwerk.
// /__/ is van Firebase zelf (inloggen): onderscheppen laat de login eindeloos laden.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/__\//, /^\/api\//, /^\/mcp/, /^\/oauth\//, /^\/\.well-known\//] }))

// --- meldingen ---

const env = import.meta.env
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY as string,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: env.VITE_FIREBASE_APP_ID as string,
})

// De server stuurt alleen "data": titel, tekst, pad en tag. Wij tonen de melding zelf, zodat hij overal gelijk is.
onBackgroundMessage(getMessaging(app), (payload) => {
  const d = payload.data ?? {}
  void self.registration.showNotification(d.title || 'Work-OS', { body: d.body, tag: d.tag, data: { url: d.url || '/taken' } })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data as { url?: string } | null)?.url ?? '/taken', self.registration.scope).href
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const mine = open.find((c) => new URL(c.url).origin === new URL(target).origin)
      if (mine) {
        await mine.focus()
        if ('navigate' in mine) await (mine as WindowClient).navigate(target).catch(() => undefined)
      } else {
        await self.clients.openWindow(target)
      }
    })(),
  )
})
