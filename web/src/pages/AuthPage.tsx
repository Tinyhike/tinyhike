import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api.js'
import { errorKey } from '../lib/errors.js'
import { useI18n, type MessageKey } from '../lib/i18n.js'
import { safeNext } from '../lib/next-path.js'
import { useMe } from '../lib/session.js'

type Status = 'idle' | 'sending' | 'sent' | 'error'

export default function AuthPage() {
  const { t } = useI18n()
  const [params] = useSearchParams()
  const { status: session } = useMe()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<MessageKey | null>(null)

  // Where the user came from (a place sheet, the profile…). It rides along with the
  // magic link so the link lands back there, and the Back links use it too. The
  // server re-checks it against the same allowlist.
  const next = safeNext(params.get('next'))
  const backTo = next ?? '/'
  const backLabel = next && next !== '/' ? t('auth.backPrev') : t('auth.back')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    try {
      await api.post('/api/auth/magic', next ? { email, next } : { email })
      setStatus('sent')
    } catch (err) {
      setStatus('error')
      setMessage(authErrorKey(err))
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
        <Link to={backTo} className="btn">
          {backLabel}
        </Link>
      </div>
    )
  }

  // A stray tap on a sign-in link shouldn't send a signed-in parent a new magic link.
  if (session === 'signedIn') {
    return (
      <div className="page">
        <h1>{t('auth.title')}</h1>
        <p className="sheet-text">{t('auth.already')}</p>
        <Link to={backTo} className="btn">
          {t('auth.continue')}
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

        {status === 'error' && message && (
          <p className="state state--error" role="alert">
            {t(message)}
          </p>
        )}

        <button type="submit" className="btn" style={{ marginTop: 0 }} disabled={status === 'sending'}>
          {status === 'sending' ? t('auth.sending') : t('auth.send')}
        </button>
      </form>

      <p style={{ marginTop: 18 }}>
        <Link to={backTo}>{backLabel}</Link>
      </p>
    </div>
  )
}

/** The magic-link endpoint's failures, in the user's language. */
function authErrorKey(err: unknown): MessageKey {
  if (err instanceof ApiError && err.status === 400) return 'auth.badEmail'
  const key = errorKey(err)
  if (key === 'err.tooMany') return 'auth.tooMany'
  if (key === 'err.network') return key
  // 502 is the mail provider refusing the send; nothing the user can fix but retry.
  return 'auth.failed'
}
