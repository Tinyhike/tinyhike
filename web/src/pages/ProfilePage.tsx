import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api.js'
import { errorKey, type ErrorKey } from '../lib/errors.js'
import { useI18n } from '../lib/i18n.js'
import { LOCALES, LOCALE_LABELS } from '../lib/locale.js'
import { signInPath } from '../lib/next-path.js'
import { clearAllDrafts } from '../lib/review-draft.js'
import { markSignedOut, useMe } from '../lib/session.js'
import SessionRetry from '../components/SessionRetry.js'

export default function ProfilePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const { me, status, checking, refetch } = useMe()
  const [signOutError, setSignOutError] = useState<ErrorKey | null>(null)

  async function signOut() {
    setSignOutError(null)
    try {
      await api.post('/api/auth/logout', {})
    } catch (err) {
      // A 401 means the session was already gone: that is the outcome we wanted.
      if (!(err instanceof ApiError && err.status === 401)) {
        setSignOutError(errorKey(err))
        return
      }
    }
    // Drop every cached response: some of it is scoped to the user we just left.
    queryClient.clear()
    // Unsent reviews are stored on the device: on a shared phone, the next parent
    // to sign in must not find them in the form.
    clearAllDrafts()
    // clear() alone would leave ['me'] to be refetched; record the answer we know.
    markSignedOut(queryClient)
    navigate('/')
  }

  return (
    <div className="page">
      <h1>{t('profile.title')}</h1>

      {status === 'pending' && (
        <div className="skeleton-group">
          <div className="skeleton skeleton--line skeleton--short" />
        </div>
      )}

      {status === 'unknown' && <SessionRetry onRetry={refetch} busy={checking} />}

      {status === 'signedOut' && (
        <>
          <p className="state-detail">{t('profile.signedOut')}</p>
          <Link to={signInPath('/profile')} className="btn">
            {t('profile.signIn')}
          </Link>
        </>
      )}

      {me && (
        <>
          <p>{me.email}</p>
          {me.handle && <p className="state-detail">@{me.handle}</p>}
          <p className="state-detail">{me.role}</p>
          {signOutError && (
            <p className="state state--error" role="alert">
              {t(signOutError)}
            </p>
          )}
          <button onClick={signOut} className="btn">
            {t('profile.signOut')}
          </button>
        </>
      )}

      <LanguagePicker />
    </div>
  )
}

/**
 * The locale is detected from the browser, but a Rotterdam parent whose phone is in
 * English may well prefer Dutch content. The choice persists in localStorage and
 * drives both the interface and the place descriptions we request from the API.
 */
function LanguagePicker() {
  const { locale, setLocale, t } = useI18n()

  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700 }}>{t('profile.language')}</h2>
      <div className="lang-row">
        {LOCALES.map((code) => (
          <button
            key={code}
            className="lang-btn"
            aria-pressed={code === locale}
            onClick={() => setLocale(code)}
          >
            {LOCALE_LABELS[code]}
          </button>
        ))}
      </div>
    </section>
  )
}
