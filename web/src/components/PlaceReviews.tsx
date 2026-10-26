import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api.js'
import { errorKey, retryTransient } from '../lib/errors.js'
import { useI18n, type MessageKey } from '../lib/i18n.js'
import { placePath, signInPath } from '../lib/next-path.js'
import { clearDraft, draftHasContent, readDraft, saveDraft } from '../lib/review-draft.js'
import { markSignedOut, useMe } from '../lib/session.js'
import { isTagKey, type TagKey } from '../lib/tags.js'
import { hasVisibleText } from '../lib/text.js'
import { RetryLine } from './SessionRetry.js'

/** One written review as the API returns it (GET /api/places/:id and /:id/reviews). */
export interface ReviewItem {
  id: string
  score: number | null
  comment: string | null
  tagsConfirmed: string[]
  tagsDisputed: string[]
  anonymous: boolean
  createdAt: string
  user: { handle: string | null } | null
}

interface ReviewPage {
  reviews: ReviewItem[]
  nextCursor: string | null
}

/** The caller's own written review, or null when they have none yet. */
interface MyReview {
  score: number | null
  comment: string | null
}

interface Props {
  placeId: string
  /** First page of written reviews, newest first. */
  reviews: ReviewItem[]
  /** All written reviews (a score or a comment). */
  reviewCount: number
  /** Tag-only rows: the amenities section's one-tap yes/no votes. */
  voteCount: number
  scoreAvg: number | null
  scoreCount: number
  /** Where GET /:id/reviews continues, or null when `reviews` is everything. */
  nextCursor: string | null
}

const COLLAPSED_COUNT = 3
const PAGE_SIZE = 20
// -deep variants only: the avatars carry white initials once handles exist.
const AVATAR_COLOURS = [
  'var(--grape-deep)',
  'var(--sky-deep)',
  'var(--mint-deep)',
  'var(--berry-deep)',
  'var(--sun-deep)',
]

/**
 * Rating + reviews on the place sheet — the validated mockup
 * (design/mockups/place-reviews-mockup.html): a one-second score header, the
 * review list with tag chips, and the star + comment form.
 *
 * The feed holds written reviews only. The amenities section's yes/no votes are
 * counted on the server and shown as one figure ("12 facts confirmed"), so a
 * burst of one-tap votes can never push the written reviews out of reach.
 */
export default function PlaceReviews({
  placeId,
  reviews,
  reviewCount,
  voteCount,
  scoreAvg,
  scoreCount,
  nextCursor,
}: Props) {
  const { t, tn, locale } = useI18n()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  // Pages fetched with "load more", appended after the detail's first page.
  const [older, setOlder] = useState<ReviewItem[]>([])
  const [cursor, setCursor] = useState(nextCursor)
  const [firstPage, setFirstPage] = useState(reviews)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<MessageKey | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const currentFirstPage = useRef(reviews)

  // A refetch of the place (after posting, or on window focus with changed data)
  // brings a new first page: drop the pages that were loaded against the old one.
  // TanStack's structural sharing keeps the same array when nothing changed.
  if (firstPage !== reviews) {
    setFirstPage(reviews)
    setOlder([])
    setCursor(nextCursor)
    setMoreError(null)
  }
  useEffect(() => {
    currentFirstPage.current = reviews
  }, [reviews])

  const scoreFormat = useMemo(
    () => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    [locale],
  )
  const all = useMemo(() => {
    const seen = new Set<string>()
    return [...reviews, ...older].filter((r) => !seen.has(r.id) && seen.add(r.id))
  }, [reviews, older])
  const visible = expanded ? all : all.slice(0, COLLAPSED_COUNT)

  async function loadMore() {
    if (!cursor || loadingMore) return
    const startedFrom = reviews
    setLoadingMore(true)
    setMoreError(null)
    try {
      const page = await api.get<ReviewPage>(
        `/api/places/${encodeURIComponent(placeId)}/reviews?cursor=${encodeURIComponent(cursor)}&take=${PAGE_SIZE}`,
      )
      // The first page changed while this was in flight: this page continues a
      // list that is no longer on screen.
      if (currentFirstPage.current !== startedFrom) return
      setOlder((prev) => [...prev, ...page.reviews])
      setCursor(page.nextCursor)
      // The button disappears with the last page; keep focus in the section.
      if (!page.nextCursor) toggleRef.current?.focus()
    } catch (err) {
      if (currentFirstPage.current !== startedFrom) return
      if (err instanceof ApiError && err.status === 400) {
        // The cursor review is gone (deleted, or moderated away), so this chain of
        // pages can't continue. Restart it: right after the detail's first page
        // when a later page broke, or from a refetched detail when the first
        // page's own cursor is stale (that refetch brings a new first page, which
        // resets everything above).
        const restartFrom = older.length > 0 ? nextCursor : null
        setOlder([])
        setCursor(restartFrom)
        // Without a cursor the button that has focus disappears.
        if (!restartFrom) toggleRef.current?.focus()
        void queryClient.invalidateQueries({ queryKey: ['place', placeId] })
      }
      const key = errorKey(err)
      setMoreError(key === 'err.generic' ? 'rev.loadError' : key)
    } finally {
      setLoadingMore(false)
    }
  }

  const metaParts: string[] = []
  if (reviewCount > 0) metaParts.push(tn('rev.count', reviewCount))
  if (voteCount > 0) metaParts.push(tn('rev.confirmed', voteCount))
  const meta = metaParts.join(' · ')

  return (
    <section className="rev-section">
      {scoreAvg !== null && scoreCount > 0 ? (
        <div className="rev-score">
          {/* The stars below carry the same figure for screen readers, with its scale. */}
          <div className="rev-score-big" aria-hidden="true">
            {scoreFormat.format(scoreAvg)}
          </div>
          <div>
            <div className="rev-kicker">{t('rev.kicker')}</div>
            <div
              className="rev-stars-lg"
              role="img"
              aria-label={t('rev.stars.avg').replace('{n}', scoreFormat.format(scoreAvg))}
            >
              {starString(scoreAvg)}
            </div>
            <div className="rev-score-meta">{meta}</div>
          </div>
        </div>
      ) : (
        meta && <p className="rev-votes">{meta}</p>
      )}

      {all.length === 0 && (
        <div className="rev-empty">
          <div className="rev-empty-emoji" aria-hidden="true">🐣</div>
          <p className="rev-empty-title">{t('rev.empty.title')}</p>
          <p className="rev-empty-sub">{t('rev.empty.sub')}</p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="rev-list">
          {visible.map((review, i) => (
            <ReviewRow key={review.id} review={review} colour={AVATAR_COLOURS[i % AVATAR_COLOURS.length]} />
          ))}
        </div>
      )}

      {expanded && cursor && (
        <button
          type="button"
          className="amen-more rev-more"
          onClick={loadMore}
          // aria-disabled rather than disabled: a disabled button drops the focus
          // it holds, and the user just pressed it.
          aria-disabled={loadingMore}
        >
          {loadingMore ? t('rev.loadingMore') : t('rev.loadMore')}
        </button>
      )}
      {expanded && moreError && (
        <p className="state state--error" role="alert">
          {t(moreError)}
        </p>
      )}

      {/* One button that changes label, so the focus stays on it when it's pressed. */}
      {reviewCount > COLLAPSED_COUNT && (
        <button
          ref={toggleRef}
          type="button"
          className="amen-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? t('rev.showLess') : t('rev.showAll').replace('{n}', String(reviewCount))}
        </button>
      )}

      <ReviewForm placeId={placeId} />
    </section>
  )
}

function ReviewRow({ review, colour }: { review: ReviewItem; colour: string }) {
  const { t, tn, locale } = useI18n()
  const name = review.user?.handle ?? t('rev.anon')
  const initial = review.user?.handle?.[0]?.toUpperCase() ?? '👤'
  const confirmed = knownTags(review.tagsConfirmed)
  const disputed = knownTags(review.tagsDisputed)
  const hasVotes = confirmed.length > 0 || disputed.length > 0
  // Rows stored before the API checked comments may be blank: don't render an empty paragraph.
  const comment = review.comment?.trim()
  const showComment = comment !== undefined && hasVisibleText(comment)

  return (
    <article className="rev-item">
      <div className="rev-item-head">
        <div className="rev-avatar" style={{ background: colour }} aria-hidden="true">
          {initial}
        </div>
        <div className="rev-who-col">
          <div className="rev-who">{name}</div>
          <time className="rev-when" dateTime={review.createdAt}>
            {relativeDate(review.createdAt, locale)}
          </time>
        </div>
        {review.score !== null ? (
          // role="img" is what lets the label be read: on a plain div screen readers
          // ignore aria-label and spell out the glyphs instead.
          <div className="rev-stars" role="img" aria-label={tn('rev.stars.label', review.score)}>
            {starString(review.score)}
          </div>
        ) : (
          hasVotes && <div className="rev-tagonly">{t('rev.tagOnly')}</div>
        )}
      </div>
      {showComment && <p className="rev-text">{comment}</p>}
      {hasVotes && (
        <div className="rev-tags">
          {confirmed.map((tag) => (
            <span key={tag} className="rev-chip rev-chip--yes">
              ✓ {t(`tag.${tag}`)}
            </span>
          ))}
          {disputed.map((tag) => (
            <span key={tag} className="rev-chip rev-chip--no">
              ✗ {t(`tag.${tag}`)}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

/**
 * Stars and comments need an account (one written review per parent per place,
 * and posting again replaces it); the amenity yes/no votes above don't.
 */
function ReviewForm({ placeId }: { placeId: string }) {
  const { status } = useMe()
  // Set when this form's own post found the session gone: the sign-in card then
  // says why it replaced the form, and whether the typed review was kept.
  const [expired, setExpired] = useState<{ draftKept: boolean } | null>(null)
  if (expired && status === 'signedIn') setExpired(null)

  // 'unknown' renders nothing: the sheet shows one retry line for the review form
  // and the photo upload together.
  if (status === 'pending' || status === 'unknown') return null
  if (status === 'signedOut') return <SignInCard placeId={placeId} expired={expired} />
  return <SignedInForm placeId={placeId} onExpired={(draftKept) => setExpired({ draftKept })} />
}

function SignInCard({ placeId, expired }: { placeId: string; expired: { draftKept: boolean } | null }) {
  const { t } = useI18n()
  const linkRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    // The form's submit button, which had focus, is gone: land on the way back in
    // rather than on <body>, outside the modal sheet.
    if (expired) linkRef.current?.focus()
  }, [expired])

  return (
    <div className="rev-form rev-signin">
      <h2 className="rev-form-title">{t('rev.form.title')}</h2>
      {expired && (
        <p className="state state--error rev-expired" role="alert">
          {t('err.signedOut')}
          {expired.draftKept && ` ${t('rev.signin.draftKept')}`}
        </p>
      )}
      <p className="rev-signin-text">{t('rev.signin.text')}</p>
      <Link ref={linkRef} className="btn btn--sky signin-btn" to={signInPath(placePath(placeId))}>
        {t('rev.signin.cta')}
      </Link>
      <p className="rev-hint">{t('rev.signin.votesFree')}</p>
    </div>
  )
}

function SignedInForm({ placeId, onExpired }: { placeId: string; onExpired: (draftKept: boolean) => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const formId = useId()
  const thanksRef = useRef<HTMLParagraphElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  // Set by "Edit my review": the button that had focus disappears with the thanks.
  const focusFormNext = useRef(false)
  // Unsent changes from an earlier visit (the sheet was closed, the page reloaded,
  // or the session ran out mid-post) come back here.
  const [draft] = useState(() => readDraft(placeId))
  const [score, setScore] = useState(draft?.score ?? 0)
  const [comment, setComment] = useState(draft?.comment ?? '')
  // True once the form holds something the stored review must not overwrite: a
  // restored draft, or anything the parent changed since the last prefill or post.
  const [dirty, setDirty] = useState(draft !== null)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState<MessageKey | null>(null)
  const [thanks, setThanks] = useState<MessageKey>('rev.form.thanks')

  useEffect(() => {
    // Keep unsent changes on the device as they are made: closing the sheet
    // unmounts this form, often by accident (a tap on the map above it to put the
    // keyboard away), and an unmount cleanup would miss a reload or a killed tab.
    if (!dirty) return
    const current = { score, comment }
    if (draftHasContent(current)) saveDraft(placeId, current)
    else clearDraft(placeId)
  }, [placeId, score, comment, dirty])

  const mine = useQuery<MyReview | null>({
    queryKey: ['my-review', placeId],
    queryFn: async ({ signal }) => {
      try {
        return await api.get<MyReview | null>(`/api/places/${encodeURIComponent(placeId)}/my-review`, signal)
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          markSignedOut(queryClient)
          return null
        }
        throw err
      }
    },
    // No background refetches: the answer only prefills the form, and the prefill
    // below never lands on edits anyway. After posting, it is invalidated by hand.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // The form waits behind a skeleton until this answers: one quick retry, then
    // the retry line below.
    retry: retryTransient(1),
  })

  // Whether the parent already has a review here is unknown until this answers. A
  // form shown without that answer would post as "new" and silently replace the
  // stored review (the API overwrites score and comment), so the form waits.
  const mineKnown = mine.data !== undefined
  // TanStack v5 puts a query that has no data back to pending when it is
  // refetched, so a retry after a failure looks like the first load;
  // errorUpdateCount tells them apart and keeps the retry line (and its focus) up.
  const mineFailed = !mineKnown && (mine.isError || mine.errorUpdateCount > 0)
  const mineRetrying = mineFailed && mine.isFetching

  // Prefill from the stored review when it (re)loads, e.g. after posting, but only
  // into an untouched form: a late answer must never replace what the parent typed.
  const [prefilledFrom, setPrefilledFrom] = useState<MyReview | null | undefined>(undefined)
  if (mine.data !== undefined && mine.data !== prefilledFrom) {
    setPrefilledFrom(mine.data)
    if (mine.data && !dirty) {
      setScore(mine.data.score ?? 0)
      setComment(mine.data.comment ?? '')
    }
  }
  const editing = Boolean(mine.data)

  useEffect(() => {
    // The button that had focus is gone each time; move focus to what replaced it,
    // inside the sheet, so a keyboard user isn't dropped onto <body>.
    if (state === 'sent') {
      thanksRef.current?.focus()
    } else if (focusFormNext.current) {
      focusFormNext.current = false
      const form = formRef.current
      const star =
        form?.querySelector<HTMLInputElement>('input[type="radio"]:checked') ??
        form?.querySelector<HTMLInputElement>('input[type="radio"]')
      ;(star ?? retryRef.current)?.focus()
    }
  }, [state])

  function edit() {
    setMessage(null)
    setState('idle')
    focusFormNext.current = true
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'sending') return
    // The API trims too, then treats a comment with nothing visible in it (only
    // zero-width or other blank characters) as no comment at all.
    const trimmed = comment.trim()
    const hasComment = hasVisibleText(trimmed)
    if (score === 0 && !hasComment) {
      setState('error')
      setMessage('rev.form.needSomething')
      return
    }
    setState('sending')
    try {
      const { status } = await api.postWithStatus<ReviewItem>(`/api/places/${encodeURIComponent(placeId)}/reviews`, {
        ...(score > 0 ? { score } : {}),
        ...(hasComment ? { comment: trimmed } : {}),
        // Nothing lets a parent set a public handle yet, so every review shows as
        // "a parent". The server forces this anyway when there is no session.
        anonymous: true,
      })
      // The server knows whether it replaced a review (200) or created one (201);
      // `editing` only knows what /my-review said when it last answered.
      setThanks(status === 200 ? 'rev.form.updated' : 'rev.form.thanks')
      setDirty(false)
      clearDraft(placeId)
      setState('sent')
      // Refetch every locale variant of this place so the review shows up, and
      // the stored review so "Edit my review" opens on what was just saved.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['place', placeId] }),
        queryClient.invalidateQueries({ queryKey: ['my-review', placeId] }),
      ])
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Signed out meanwhile: this swaps the form for the sign-in card. Keep what
        // was typed, so it is back in the form once the parent has signed in.
        onExpired(saveDraft(placeId, { score, comment }))
        markSignedOut(queryClient)
        return
      }
      setState('error')
      if (err instanceof ApiError && err.status === 400) {
        // The only 400 this form can meet: a comment the check above let through
        // (the browser's Unicode tables may be older than the server's) that the
        // API still found empty. Retrying would fail the same way.
        setMessage('rev.form.needSomething')
        return
      }
      const key = errorKey(err)
      setMessage(key === 'err.generic' ? 'rev.form.error' : key)
    }
  }

  return (
    <div className="rev-form">
      {/* Mounted in every state, so the thanks is announced as a change. */}
      <div role="status">
        {state === 'sent' && (
          <p ref={thanksRef} className="rev-thanks" tabIndex={-1}>
            🎉 {t(thanks)}
          </p>
        )}
      </div>

      {/* The hint promises that posting again replaces the review: this is the way
          back to the form without closing the sheet. */}
      {state === 'sent' && (
        <div className="rev-edit-row">
          <button type="button" className="link-btn" onClick={edit}>
            {t('rev.form.edit')}
          </button>
        </div>
      )}

      {state !== 'sent' && !mineKnown && !mineFailed && (
        <div className="skeleton-group" aria-busy="true">
          <div className="skeleton skeleton--title" />
          <div className="skeleton skeleton--line" />
        </div>
      )}

      {state !== 'sent' && mineFailed && (
        <RetryLine
          message={t('rev.form.mineError')}
          onRetry={() => void mine.refetch()}
          busy={mineRetrying}
          buttonRef={retryRef}
        />
      )}

      {state !== 'sent' && mineKnown && (
        <form ref={formRef} onSubmit={submit} aria-labelledby={`${formId}-title`}>
          <h2 id={`${formId}-title`} className="rev-form-title">
            {t('rev.form.title')}
          </h2>
          {editing && <p className="rev-editing">{t('rev.form.editing')}</p>}

          <StarPicker
            name={`${formId}-score`}
            value={score}
            onChange={(n) => {
              setScore(n)
              setDirty(true)
            }}
          />

          <label className="rev-label" htmlFor={`${formId}-comment`}>
            {t('rev.form.commentLabel')}
          </label>
          <textarea
            id={`${formId}-comment`}
            className="rev-textarea"
            value={comment}
            maxLength={500}
            onChange={(e) => {
              setComment(e.target.value)
              setDirty(true)
            }}
            placeholder={t('rev.form.placeholder')}
          />
          <p className="rev-hint">{t('rev.form.hint').replace('{anon}', t('rev.anon'))}</p>
          {state === 'error' && message && (
            <p className="state state--error" role="alert">
              {t(message)}
            </p>
          )}
          <button
            type="submit"
            className="btn"
            style={{ width: '100%' }}
            // aria-disabled rather than disabled, so the focused button keeps focus
            // while the request is in flight; submit() ignores repeat presses.
            aria-disabled={state === 'sending'}
          >
            {state === 'sending' ? t('rev.form.sending') : editing ? t('rev.form.update') : t('rev.form.submit')}
          </button>
        </form>
      )}
    </div>
  )
}

/**
 * Native radios, visually hidden, with their labels drawn as stars. That gives the
 * radio-group behaviour for free: one tab stop, arrow keys to change the rating,
 * and clicking the checked star leaves it checked.
 */
function StarPicker({ name, value, onChange }: { name: string; value: number; onChange: (n: number) => void }) {
  const { t, tn } = useI18n()
  return (
    <fieldset className="rev-pick">
      <legend className="rev-pick-legend">{t('rev.form.ratingLabel')}</legend>
      <div className="rev-pick-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={n <= value ? 'rev-pick-star rev-pick-star--on' : 'rev-pick-star'}>
            <input
              className="rev-pick-input sr-only"
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
            />
            <span className="rev-pick-glyph" aria-hidden="true">
              ⭐
            </span>
            <span className="sr-only">{tn('rev.stars.label', n)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function knownTags(tags: string[]): TagKey[] {
  // Known keys only, each once: anything else is a value from before the API
  // validated tags, and is not worth echoing raw into the page.
  return [...new Set(tags)].filter(isTagKey)
}

function starString(score: number): string {
  const full = Math.max(0, Math.min(5, Math.round(score)))
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

/**
 * "il y a 3 jours" via Intl — no translation tables needed. Days are counted in
 * calendar days, so a review from this morning reads "today" and one from 23:00
 * last night reads "yesterday", whatever the hour.
 */
function relativeDate(iso: string, locale: string): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  // Both values are local midnights, so the difference is a whole number of days
  // except across a DST change (23 h or 25 h): Math.round absorbs exactly that.
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  // <= 0 also covers a server clock slightly ahead of the phone's.
  if (days <= 0) return rtf.format(0, 'day')
  if (days < 7) return rtf.format(-days, 'day')
  // floor, so the label never runs ahead: 45 days is "1 month ago", not 2.
  if (days < 30) return rtf.format(-Math.floor(days / 7), 'week')
  if (days < 365) return rtf.format(-Math.floor(days / 30), 'month')
  return rtf.format(-Math.floor(days / 365), 'year')
}
