import { useState } from 'react'
import { ListChecks } from 'lucide-react'
import { signInWithGoogle, useSession } from '../data/session'

export function LoginScreen() {
  const { error } = useSession()
  const [busy, setBusy] = useState(false)

  async function login() {
    setBusy(true)
    await signInWithGoogle()
    setBusy(false)
  }

  return (
    <div className="login">
      <div className="login__card">
        <span className="login__logo">
          <ListChecks size={26} />
        </span>
        <h1>Work-OS</h1>
        <p>Log in om je taken te zien. Ze staan veilig online en je ziet ze op elk apparaat.</p>
        <button className="btn is-primary is-big" onClick={() => void login()} disabled={busy}>
          {busy ? 'Even geduld…' : 'Inloggen met Google'}
        </button>
        {error && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
