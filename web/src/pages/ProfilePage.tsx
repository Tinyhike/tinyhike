import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useI18n } from '../lib/i18n.js'
import { LOCALES, LOCALE_LABELS } from '../lib/locale.js'

interface Me {
  id: string
  email: string
  handle: string | null
  role: string
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useI18n()

  const { data, isLoading } = useQuery<Me>({
    queryKey: ['me'],
    // A 401 here just means "signed out" — retrying it three times only delays the
    // sign-in prompt.
    retry: false,
    queryFn: () => api.get('/api/auth/me'),
  })

  async function signOut() {
    await api.post('/api/auth/logout', {})
    // Drop every cached response: some of it is scoped to the user we just left.
    queryClient.clear()
    navigate('/')
  }

  return (
    <div className="page">
      <h1>{t('profile.title')}</h1>

      {isLoading && (
        <div className="skeleton-group">
          <div className="skeleton skeleton--line skeleton--short" />
        </div>
      )}

      {!isLoading && !data && (
        <>
          <p className="state-detail">{t('profile.signedOut')}</p>
          <Link to="/auth" className="btn" style={{ display: 'inline-block', textDecoration: 'none', color: '#fff' }}>
            {t('profile.signIn')}
          </Link>
        </>
      )}

      {data && (
        <>
          <p>{data.email}</p>
          {data.handle && <p className="state-detail">@{data.handle}</p>}
          <p className="state-detail">{data.role}</p>
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
