import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { Mic } from 'lucide-react'
import { VoiceSheet } from './VoiceSheet'
import { claimHost, closeVoice, openVoice, releaseHost, useVoiceUi } from './voiceUi'
import './voice.css'

/**
 * De microfoonknop. Komt op twee plekken (zijbalk en dock); de eerste die
 * gemonteerd is, toont de sheet en luistert naar de sneltoets M.
 */
export function VoiceButton({ variant }: { variant: 'sidebar' | 'dock' }) {
  const id = useId()
  const ui = useVoiceUi()
  const isHost = ui.hostId === id

  useEffect(() => {
    if (ui.hostId === null) claimHost(id)
  }, [ui.hostId, id])
  useEffect(() => () => releaseHost(id), [id])

  useEffect(() => {
    if (!isHost) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (e.key.toLowerCase() !== 'm' || typing || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      e.preventDefault()
      openVoice()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isHost])

  const sheet = isHost && ui.open ? createPortal(<VoiceSheet onClose={closeVoice} />, document.body) : null

  if (variant === 'dock') {
    return (
      <>
        <button type="button" className="dock" aria-label="Taak inspreken" onClick={openVoice}>
          <Mic size={24} />
        </button>
        {sheet}
      </>
    )
  }
  return (
    <>
      <button type="button" className="nav-item" onClick={openVoice}>
        <Mic size={18} />
        Inspreken
      </button>
      {sheet}
    </>
  )
}
