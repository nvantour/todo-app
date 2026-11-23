import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Source } from '../model/types'
import { isInternal, sourceHref } from '../lib/sources'

interface Props {
  source: Source
  className?: string
  title?: string
  children: ReactNode
}

/**
 * De bron van een taak als klikbare link. Binnen de app: in hetzelfde venster (de mail opent de thread);
 * naar buiten: in een nieuw tabblad. Zonder (af te leiden) link gewoon tekst. Een link krijgt de klasse `is-link`.
 */
export function SourceLink({ source, className, title, children }: Props) {
  const navigate = useNavigate()
  const url = sourceHref(source)
  if (!url) {
    return (
      <span className={className} title={title}>
        {children}
      </span>
    )
  }
  const internal = isInternal(url)
  return (
    <a
      className={className ? `${className} is-link` : undefined}
      title={title}
      href={url}
      target={internal ? undefined : '_blank'}
      rel={internal ? undefined : 'noreferrer'}
      onClick={(e) => {
        e.stopPropagation()
        if (!internal || e.metaKey || e.ctrlKey || e.shiftKey) return
        e.preventDefault()
        const u = new URL(url, window.location.origin)
        navigate(u.pathname + u.search + u.hash)
      }}
    >
      {children}
    </a>
  )
}
