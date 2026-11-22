import type { ReactNode } from 'react'

interface Props {
  title: string
  intro: string
  children?: ReactNode
}

/** Tab die al in de navigatie staat, maar nog gebouwd wordt (werk-OS, fase 3 en 5). */
export function ComingSoonView({ title, intro, children }: Props) {
  return (
    <>
      <header className="view-header">
        <h1>{title}</h1>
        <p>{intro}</p>
      </header>
      <div className="empty">
        <strong>Komt eraan</strong>
        {children}
      </div>
    </>
  )
}

export function MeetingsView() {
  return (
    <ComingSoonView title="Meetings" intro="Per meeting: notulen, samenvatting, actiepunten en bespreekpunten.">
      Hier zie je straks per meeting wat al gedaan is en wat nog openstaat.
    </ComingSoonView>
  )
}
