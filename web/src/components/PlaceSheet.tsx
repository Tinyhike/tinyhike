import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api.js'
import { errorKey } from '../lib/errors.js'
import { useI18n } from '../lib/i18n.js'
import { DEFAULT_LOCALE } from '../lib/locale.js'
import { useMe } from '../lib/session.js'
import PhotoUpload from './PhotoUpload.js'
import PlaceAmenities from './PlaceAmenities.js'
import PlaceReviews, { type ReviewItem } from './PlaceReviews.js'
import SessionRetry from './SessionRetry.js'
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
  /** Approved photos only; r2Url is the public, re-encoded copy. */
  photos: Array<{ id: string; r2Url: string | null; createdAt: string }>
  /** First page of written reviews; see PlaceReviews for the rest of the shape. */
  reviews: ReviewItem[]
  reviewCount: number
  voteCount: number
  scoreAvg: number | null
  scoreCount: number
  nextCursor: string | null
}

// What Tab can land on. Elements with tabindex="-1" (focus targets for
// announcements, the hidden file input) are filtered out below.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]'

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
  const sheetRef = useRef<HTMLElement>(null)
  // The photo upload and the review form both gate on the session; when /me keeps
  // failing they render nothing, and the sheet shows the one retry line for both.
  const { status: session, checking, refetch: recheckSession } = useMe()

  // A 404 here (a deep link to a pending or rejected place) is not retried: the
  // QueryClient's default policy in main.tsx only retries transient failures.
  const { data, isLoading, isError, error } = useQuery<PlaceDetail>({
    queryKey: ['place', id, locale],
    queryFn: () => api.get(`/api/places/${id}?locale=${locale}`),
    enabled: Boolean(id),
  })

  const close = () => navigate('/')

  // Escape closes the sheet, and focus lands on the close button when it opens —
  // otherwise focus stays on the map canvas and keyboard users are stranded.
  // Tab and Shift+Tab wrap inside the sheet: it is aria-modal, so the map and the
  // tab bar behind the scrim must not be reachable while it is open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !escapeBelongsToField(e)) navigate('/')
      if (e.key === 'Tab' && sheetRef.current) trapTab(e, sheetRef.current)
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

  const photos = (data?.photos ?? []).flatMap((ph) => (ph.r2Url ? [{ id: ph.id, url: ph.r2Url }] : []))

  return (
    <>
      <div className="sheet-scrim" onClick={close} aria-hidden="true" />
      <section
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={tr?.name ?? t('sheet.loading')}
      >
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

          {/* Only when there is nothing to show. A failed background refetch (after a
              vote or a review, the place is refetched) keeps the data on screen,
              and that still-working sheet must not be announced as an error. */}
          {isError && !data && (
            <div className="state state--error" role="alert">
              <p>{notFound ? t('sheet.notFound') : t('sheet.error')}</p>
              {/* The cause, in the UI language, when it tells the user something they
                  can act on (offline, slow down). Never error.message: that is English. */}
              {!notFound && errorKey(error) !== 'err.generic' && <p className="state-detail">{t(errorKey(error))}</p>}
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

              {/* Keyed by place: opening another place while the sheet stays mounted
                  must not carry over a vote, a picked photo or a half-written review. */}
              <PlaceAmenities key={`amen-${data.id}`} placeId={data.id} place={data} />

              {photos.length > 0 && (
                <div className="photo-grid">
                  {photos.map((ph) => (
                    <img key={ph.id} src={ph.url} alt="" loading="lazy" />
                  ))}
                </div>
              )}

              {session === 'unknown' && <SessionRetry onRetry={recheckSession} busy={checking} />}

              <PhotoUpload key={data.id} placeId={data.id} />

              <PlaceReviews
                key={`rev-${data.id}`}
                placeId={data.id}
                reviews={data.reviews}
                reviewCount={data.reviewCount}
                voteCount={data.voteCount}
                scoreAvg={data.scoreAvg}
                scoreCount={data.scoreCount}
                nextCursor={data.nextCursor}
              />
            </>
          )}
        </div>
      </section>
    </>
  )
}

// Text inputs whose content an Escape press could be meant for.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password'])

/**
 * Whether an Escape press is the text field's rather than the sheet's. While an
 * IME composes (Safari reports that keydown as keyCode 229 without isComposing),
 * Escape cancels the composition; in a field holding text it usually dismisses
 * the keyboard's suggestions or the spellcheck popup. Closing the sheet then would
 * throw away a half-written review for a key press aimed at something else.
 */
function escapeBelongsToField(e: KeyboardEvent): boolean {
  if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return true
  const el = e.target
  if (el instanceof HTMLTextAreaElement) return el.value !== ''
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type) && el.value !== ''
  return false
}

/**
 * Keep Tab inside `container`: past the last focusable element it wraps to the
 * first, and Shift+Tab before the first wraps to the last. "Past" is measured in
 * document order rather than by comparing with first/last, because focus often
 * rests on a tabindex="-1" message (the review thanks, the photo progress) that
 * no list of tabbables contains. Focus that has fallen outside (onto <body>, when
 * a focused button was removed) is pulled back in.
 */
function trapTab(e: KeyboardEvent, container: HTMLElement) {
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
  )
  if (focusable.length === 0) {
    e.preventDefault()
    return
  }
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !container.contains(active)) {
    e.preventDefault()
    ;(e.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus()
    return
  }
  const hasNext = focusable.some((el) => active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
  const hasPrev = focusable.some((el) => active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)
  if (!e.shiftKey && !hasNext) {
    e.preventDefault()
    focusable[0].focus()
  } else if (e.shiftKey && !hasPrev) {
    e.preventDefault()
    focusable[focusable.length - 1].focus()
  }
}
