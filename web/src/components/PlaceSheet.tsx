import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api.js'
import { getLocale, DEFAULT_LOCALE } from '../lib/locale.js'

interface Translation {
  locale: string
  name: string
  description?: string | null
  tips?: string | null
}

interface PlaceDetail {
  id: string
  translations: Translation[]
  photos: Array<{ r2Url: string }>
}

/**
 * Place detail, rendered as a sheet over the still-mounted map (it's a child route
 * of "/"). Keeping the map alive matters twice over: closing the sheet restores the
 * exact view the user had, and we skip a full Mapbox re-init on every open.
 */
export default function PlaceSheet() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const locale = getLocale()
  const closeRef = useRef<HTMLButtonElement>(null)

  const { data, isLoading, isError, error } = useQuery<PlaceDetail>({
    queryKey: ['place', id, locale],
    queryFn: () => api.get(`/api/places/${id}?locale=${locale}`),
    enabled: Boolean(id),
  })

  const close = () => navigate('/')

  // Escape closes the sheet, and focus lands on the close button when it opens —
  // otherwise focus stays on the map canvas and keyboard users are stranded.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('/')
    }
    window.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])

  // The API returns every locale; pick the visitor's, then the launch-city default,
  // then whatever exists — a place with no translation at all should still show.
  const t =
    data?.translations.find((x) => x.locale === locale) ??
    data?.translations.find((x) => x.locale === DEFAULT_LOCALE) ??
    data?.translations[0]

  const notFound = isError && error instanceof ApiError && error.status === 404

  return (
    <>
      <div className="sheet-scrim" onClick={close} aria-hidden="true" />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={t?.name ?? 'Détail du lieu'}>
        <div className="sheet-grip" aria-hidden="true" />
        <button ref={closeRef} className="sheet-close" onClick={close} aria-label="Fermer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="sheet-body">
          {isLoading && (
            <div className="skeleton-group" aria-busy="true" aria-label="Chargement du lieu">
              <div className="skeleton skeleton--title" />
              <div className="skeleton skeleton--line" />
              <div className="skeleton skeleton--line" />
              <div className="skeleton skeleton--line skeleton--short" />
            </div>
          )}

          {isError && (
            <div className="state state--error" role="alert">
              <p>{notFound ? 'Ce lieu n’existe pas ou n’est plus publié.' : 'Impossible de charger ce lieu.'}</p>
              {!notFound && error instanceof Error && <p className="state-detail">{error.message}</p>}
              <button className="btn" onClick={close}>
                Retour à la carte
              </button>
            </div>
          )}

          {data && (
            <>
              <h1 className="sheet-title">{t?.name ?? 'Lieu sans nom'}</h1>
              {t?.description && <p className="sheet-text">{t.description}</p>}
              {t?.tips && <p className="sheet-tip">{t.tips}</p>}

              {data.photos.length > 0 && (
                <div className="photo-grid">
                  {data.photos.map((ph) => (
                    <img key={ph.r2Url} src={ph.r2Url} alt="" loading="lazy" />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  )
}
