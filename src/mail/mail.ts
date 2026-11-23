// Eén ingang voor de mail in het werk-OS: alleen Gmail, één account (de Google-koppeling van de app).

import * as gapi from './gmail/api'

export { LoginNeeded } from './errors'
export type { GmailDraft, Vacation, Label, ListQuery, Message, Outgoing, OutgoingFile, Rule, Thread, ThreadSummary } from './gmail/api'
export {
  MAX_SEND_BYTES, listThreads, getThread, markRead, listLabels, createLabel, setInInbox, setLabel, inInbox, setSaved, getAttachment,
  markUnread, setTrash, setSpam, listRules, createRule, deleteRule, getVacation, setVacation, getSignature, send, deleteDraft,
  createDraft, updateDraft, labelCounts,
} from './gmail/api'

/** Gmail-lijstgegevens van dit account vergeten (bijv. na ontkoppelen). */
export const forget = (email: string) => gapi.forget(email)
