import { getMessaging } from 'firebase-admin/messaging'
import { deadTokens, type PushSender } from './push'

/**
 * Verstuurt via Firebase Cloud Messaging. Het is een "data"-bericht: de service worker van de app
 * toont zelf de melding (zie src/sw.ts), zodat tik, titel en opmaak overal gelijk zijn.
 * Registratietokens zijn in de nieuwste firebase-admin als "verouderd" gemarkeerd ten gunste van FID's,
 * maar werken nog en passen bij de web-SDK van de app (firebase 12).
 */
export const fcmSender: PushSender = async (tokens, p) => {
  if (!tokens.length) return { invalid: [], sent: 0 }
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    data: { title: p.title, body: p.body, url: p.url, tag: p.tag },
    webpush: { headers: { Urgency: 'high', TTL: '3600' } },
  })
  const results = res.responses.map((r) => ({ success: r.success, code: r.error?.code }))
  return { invalid: deadTokens(tokens, results), sent: res.successCount }
}
