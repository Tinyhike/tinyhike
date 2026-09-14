import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api.js'

type Status = 'idle' | 'sending' | 'sent' | 'error'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    try {
      await api.post('/api/auth/magic', { email })
      setStatus('sent')
    } catch (err) {
      // Previously this promise rejected unhandled: a rate limit, a network drop or a
      // Resend failure all left the form sitting there as if nothing had happened.
      setStatus('error')
      setMessage(
        err instanceof ApiError && err.status === 429
          ? 'Trop de tentatives. Réessaie dans quelques minutes.'
          : err instanceof Error
            ? err.message
            : 'Envoi impossible.',
      )
    }
  }

  if (status === 'sent') {
    return (
      <div className="page">
        <h1>Regarde ta boîte mail</h1>
        <p className="sheet-text">
          Un lien de connexion a été envoyé à <strong>{email}</strong>. Il est valable 15 minutes.
        </p>
        <p className="state-detail" style={{ marginTop: 12 }}>
          Rien reçu ? Pense à vérifier les spams.
        </p>
        <Link to="/" className="btn" style={{ display: 'inline-block', textDecoration: 'none', color: '#fff' }}>
          Retour à la carte
        </Link>
      </div>
    )
  }

  return (
    <div className="page">
      <h1>Se connecter à TinyHike</h1>
      <p className="state-detail">Pas de mot de passe : on t’envoie un lien par e-mail.</p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="toi@exemple.com"
          autoComplete="email"
          required
          aria-label="Adresse e-mail"
          aria-invalid={status === 'error'}
          style={{ padding: 10, borderRadius: 8, border: '1px solid var(--border)', fontSize: 16 }}
        />

        {status === 'error' && (
          <p className="state state--error" role="alert">
            {message}
          </p>
        )}

        <button type="submit" className="btn" style={{ marginTop: 0 }} disabled={status === 'sending'}>
          {status === 'sending' ? 'Envoi…' : 'Recevoir le lien'}
        </button>
      </form>

      <p style={{ marginTop: 16 }}>
        <Link to="/">Retour à la carte</Link>
      </p>
    </div>
  )
}
