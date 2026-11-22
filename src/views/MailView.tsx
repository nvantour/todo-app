import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { store } from '../data/store'
import { buildDiscussionItem } from '../data/logic'
import { detectProject } from '../lib/detect'
import { getTheme, useTheme } from '../lib/theme'
import { mountMail, setMailTheme, type MailHooks } from '../mail/mailApp'

/**
 * De Mail-tab: de mailclient draait in een eigen afgeschermd vak (Shadow DOM) en praat met het
 * werk-OS via een paar haakjes: taak maken, punt op een bespreeklijst, naar Instellingen.
 */
export function MailView() {
  const hostRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const theme = useTheme()

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const hooks: MailHooks = {
      makeTask({ subject, from, threadId, url }) {
        const title = `Opvolgen: ${subject || '(geen onderwerp)'}`
        const { projects } = store.getSnapshot()
        store.addTodo({
          title,
          bucket: 'now',
          projectId: detectProject(`${subject} ${from}`, projects),
          source: { type: 'mail', label: from ? `${subject} · ${from}` : subject, url, externalId: threadId },
        })
        return title
      },
      groups: () =>
        [...store.getSnapshot().discussions].sort((a, b) => a.order - b.order).map((d) => ({ id: d.id, title: d.title })),
      addPoint(groupId, text) {
        const d = store.getSnapshot().discussions.find((x) => x.id === groupId)
        if (!d) return ''
        store.updateDiscussion(groupId, { items: [...d.items, buildDiscussionItem(text)] })
        return d.title
      },
      openSettings: () => navigate('/instellingen'),
    }
    return mountMail(el, hooks, getTheme())
  }, [navigate])

  useEffect(() => setMailTheme(theme), [theme])

  return <div ref={hostRef} className="mail-host" aria-label="Mail" />
}
