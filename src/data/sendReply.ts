import type { Reply } from '../model/types'
import { store } from './store'
import { apiCall, hasServer } from './server'
import { nowISO } from './logic'

/**
 * Het vinkje op een kaart. Nino keurt de tekst goed; daarna:
 * - mail: de app verstuurt zelf via Gmail, als antwoord in de thread (en haalt hem uit Nieuw, zoals in Mail);
 * - Google Chat: de server verstuurt met de Google-koppeling;
 * - Airtable: de server plaatst een reactie op het record (als antwoord op de reactie waar je op reageert);
 * - Teams en Slack: status "approved"; het verzendscript op de Mac mini verstuurt precies deze tekst.
 * Claude verstuurt nooit zelf: alleen deze klik zet iets in gang.
 */
export async function approveReply(reply: Reply, draft: string): Promise<void> {
  const text = draft.trim()
  if (!text) throw new Error('Het antwoord is leeg.')
  const stamp = nowISO()
  const edited = reply.draftEdited || text !== reply.draft.trim()

  if (reply.channel === 'teams' || reply.channel === 'slack') {
    store.updateReply(reply.id, { draft: text, draftEdited: edited, status: 'approved', approvedAt: stamp, error: null })
    return
  }

  // Testmodus zonder server: doen alsof, zodat de kaart te testen is.
  if (!hasServer()) {
    store.updateReply(reply.id, { draft: text, draftEdited: edited, status: 'sent', approvedAt: stamp, sentAt: stamp, error: null })
    return
  }

  store.updateReply(reply.id, { draft: text, draftEdited: edited, status: 'sending', approvedAt: stamp, error: null })
  try {
    if (reply.channel === 'mail') await sendMail(reply, text)
    else await apiCall(`/replies/${encodeURIComponent(reply.id)}/send`, { method: 'POST', body: JSON.stringify({ text }) })
    store.updateReply(reply.id, { status: 'sent', sentAt: nowISO(), error: null })
  } catch (e) {
    store.updateReply(reply.id, { status: 'failed', error: e instanceof Error ? e.message : 'Versturen mislukt.' })
  }
}

async function sendMail(reply: Reply, text: string) {
  const threadId = reply.target.threadId
  if (!threadId) throw new Error('Onbekend welke mail-thread dit is.')
  // De mailcode pas laden als hij nodig is (hij is groot).
  const [{ checkAccess }, mail, { draftFor, outgoing }] = await Promise.all([import('../mail/gmail/auth'), import('../mail/mail'), import('../mail/compose')])
  const access = await checkAccess()
  if (!access.ok) throw new Error('Mail is niet gekoppeld. Koppel Google opnieuw in Instellingen.')
  const email = access.email
  const [thread, sig] = await Promise.all([mail.getThread(email, threadId), mail.getSignature(email).catch(() => ({ html: '', text: '' }))])
  const draft = draftFor(thread, 'reply', email, text)
  await mail.send(email, outgoing(draft, thread, sig))
  await mail.setInInbox(email, thread.id, false).catch(() => undefined)
}

/** Negeren: kaart weg. Komt er later een nieuw bericht in dit gesprek, dan zet een nieuwe ronde hem terug. */
export const dismissReply = (reply: Reply) => store.updateReply(reply.id, { status: 'dismissed' })

/** Mislukt of per ongeluk goedgekeurd: terug naar open, zodat Nino opnieuw kan kiezen. */
export const reopenReply = (reply: Reply) => store.updateReply(reply.id, { status: 'open', error: null, approvedAt: null })
