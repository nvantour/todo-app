// Gegevens voor mail op een kaart van de tab Antwoorden: de thread vers uit Gmail, de afbeeldingen
// die in de mail zelf zitten, en de handtekening. Lukt het ophalen niet (testmodus, mail niet gekoppeld,
// geen verbinding), dan geeft dit niets terug en toont de kaart de opgeslagen tekst van de scan.
import { useEffect, useState } from 'react'
import { hasServer } from '../../data/server'
import type { Message, Thread } from '../../mail/mail'

type Mail = typeof import('../../mail/mail')

export interface MailSession {
  email: string
  mail: Mail
}

export interface Signature {
  html: string
  text: string
}

let sessionP: Promise<MailSession | null> | null = null

/** Is de mail gekoppeld? De mailcode wordt pas hier geladen (hij is groot). */
function mailSession(): Promise<MailSession | null> {
  sessionP ??= (async (): Promise<MailSession | null> => {
    if (!hasServer()) return null
    const [{ checkAccess }, mail] = await Promise.all([import('../../mail/gmail/auth'), import('../../mail/mail')])
    const access = await checkAccess()
    return access.ok ? { email: access.email, mail } : null
  })()
    .catch(() => null)
    .then((s) => {
      if (!s) sessionP = null // later opnieuw proberen, bijvoorbeeld na inloggen
      return s
    })
  return sessionP
}

let signatureP: Promise<Signature | null> | null = null

function loadSignature(): Promise<Signature | null> {
  signatureP ??= (async (): Promise<Signature | null> => {
    const s = await mailSession()
    return s ? await s.mail.getSignature(s.email) : null
  })()
    .catch(() => null)
    .then((sig) => {
      if (!sig) signatureP = null
      return sig
    })
  return signatureP
}

/** De handtekening uit Gmail. null = nog onbekend (of de mail is niet gekoppeld); lege html = er is er geen ingesteld. */
export function useSignature(enabled: boolean): Signature | null {
  const [sig, setSig] = useState<Signature | null>(null)
  useEffect(() => {
    if (!enabled) return
    let on = true
    void loadSignature().then((s) => {
      if (on) setSig(s)
    })
    return () => {
      on = false
    }
  }, [enabled])
  return sig
}

export interface LiveThread extends MailSession {
  thread: Thread
}

/** De mail-thread zelf, vers uit Gmail. `stamp` verandert als de kaart is bijgewerkt: dan halen we hem opnieuw op. */
export function useMailThread(threadId: string | undefined, stamp: string): LiveThread | null {
  const [live, setLive] = useState<LiveThread | null>(null)
  useEffect(() => {
    if (!threadId) return
    let on = true
    void (async () => {
      const s = await mailSession()
      if (!s) return
      try {
        const thread = await s.mail.getThread(s.email, threadId)
        if (on) setLive({ ...s, thread })
      } catch {
        // de opgeslagen tekst van de scan blijft staan
      }
    })()
    return () => {
      on = false
    }
  }, [threadId, stamp])
  return live
}

/** Afbeeldingen die in de mail zelf zitten (cid:) ophalen als data-URL. */
export async function loadInline(s: MailSession, m: Message): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  await Promise.all(
    (m.inline ?? []).map(async (p) => {
      try {
        let b64 = p.data?.replace(/-/g, '+').replace(/_/g, '/') ?? ''
        if (!b64 && p.id) {
          const bytes = await s.mail.getAttachment(s.email, m.id, p.id)
          let bin = ''
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          b64 = btoa(bin)
        }
        if (b64) map[p.cid] = `data:${p.mime};base64,${b64}`
      } catch {
        // deze afbeelding niet; de rest wel
      }
    }),
  )
  return map
}

const safeDecode = (v: string) => {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

/** cid:-verwijzingen vervangen door de opgehaalde afbeeldingen. */
export const withInline = (html: string, map: Record<string, string> | null) =>
  map ? html.replace(/cid:([^"'\s)>]+)/gi, (all, c: string) => map[c] ?? map[safeDecode(c)] ?? all) : html
