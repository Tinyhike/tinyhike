import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api.js'
import { useI18n } from '../lib/i18n.js'
import { DEFAULT_LOCALE } from '../lib/locale.js'
import PlaceAmenities from './PlaceAmenities.js'
import type { PlaceTags } from '../lib/tags.js'

interface Translation {
  locale: string
  name: string
  description?: string | null
  tips?: string | null
}

// PlaceTags carries the 19 tri-state tag fields the API returns on the detail.
interface PlaceDetail extends PlaceTags {
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
  const { t, locale } = useI18n()
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
  const tr =
    data?.translations.find((x) => x.locale === locale) ??
    data?.translations.find((x) => x.locale === DEFAULT_LOCALE) ??
    data?.translations[0]

  const notFound = isError && error instanceof ApiError && error.status === 404

  return (
    <>
      <div className="sheet-scrim" onClick={close} aria-hidden="true" />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={tr?.name ?? t('sheet.loading')}>
        <div className="sheet-grip" aria-hidden="true" />
        <button ref={closeRef} className="sheet-close" onClick={close} aria-label={t('sheet.close')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="sheet-body">
          {isLoading && (
            <div className="skeleton-group" aria-busy="true" aria-label={t('sheet.loading')}>
              <div className="skeleton skeleton--title" />
              <div className="skeleton skeleton--line" />
              <div className="skeleton skeleton--line" />
              <div className="skeleton skeleton--line skeleton--short" />
            </div>
          )}

          {isError && (
            <div className="state state--error" role="alert">
              <p>{notFound ? t('sheet.notFound') : t('sheet.error')}</p>
              {!notFound && error instanceof Error && <p className="state-detail">{error.message}</p>}
              <button className="btn" onClick={close}>
                {t('sheet.backToMap')}
              </button>
            </div>
          )}

          {data && (
            <>
              <h1 className="sheet-title">{tr?.name ?? t('sheet.untitled')}</h1>
              {tr?.description && <p className="sheet-text">{tr.description}</p>}
              {tr?.tips && <p className="sheet-tip">{tr.tips}</p>}

              <PlaceAmenities placeId={data.id} place={data} />

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
