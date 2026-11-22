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

export const MAIL_CLIENT_URL = 'https://email-client-nino.web.app'

export function MailView() {
  return (
    <ComingSoonView title="Mail" intro="Je mail, naast je taken en bespreekpunten.">
      Tot die tijd werkt de losse mailclient gewoon.
      <p>
        <a className="btn" href={MAIL_CLIENT_URL} target="_blank" rel="noreferrer">
          Open de mailclient
        </a>
      </p>
    </ComingSoonView>
  )
}
