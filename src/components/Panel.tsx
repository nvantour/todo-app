import { useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
  /** Vaste onderkant (bv. verwijderen). */
  footer?: React.ReactNode
}

/** Zijpaneel op een laptop, sheet van onderen op een telefoon. Esc of buiten klikken sluit. */
export function Panel({ title, onClose, children, footer }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label={title}>
        <header className="panel__head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Sluiten" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="panel__body">{children}</div>
        {footer && <footer className="panel__foot">{footer}</footer>}
      </aside>
    </>
  )
}
