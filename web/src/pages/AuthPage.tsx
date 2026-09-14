import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api.js'
import { useI18n } from '../lib/i18n.js'

type Status = 'idle' | 'sending' | 'sent' | 'error'

export default function AuthPage() {
  const { t } = useI18n()
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
          ? t('auth.tooMany')
          : err instanceof Error
            ? err.message
            : t('auth.failed'),
      )
    }
  }

  if (status === 'sent') {
    return (
      <div className="page">
        <h1>{t('auth.checkInbox')}</h1>
        <p className="sheet-text">
          {t('auth.sentTo')} <strong>{email}</strong>. {t('auth.validFor')}
        </p>
        <p className="state-detail">{t('auth.spam')}</p>
        <Link to="/" className="btn" style={{ display: 'inline-block', textDecoration: 'none', color: '#fff' }}>
          {t('auth.back')}
        </Link>
      </div>
    )
  }

  return (
    <div className="page">
      <h1>{t('auth.title')}</h1>
      <p className="state-detail">{t('auth.subtitle')}</p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
        <input
          className="field"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
          aria-label={t('auth.email')}
          aria-invalid={status === 'error'}
        />

        {status === 'error' && (
          <p className="state state--error" role="alert">
            {message}
          </p>
        )}

        <button type="submit" className="btn" style={{ marginTop: 0 }} disabled={status === 'sending'}>
          {status === 'sending' ? t('auth.sending') : t('auth.send')}
        </button>
      </form>

      <p style={{ marginTop: 18 }}>
        <Link to="/">{t('auth.back')}</Link>
      </p>
    </div>
  )
}
