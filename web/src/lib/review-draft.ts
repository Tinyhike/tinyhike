import { hasVisibleText } from './text.js'

export interface ReviewDraft {
  score: number
  comment: string
}

// A review form that holds unsent changes is kept here, one entry per place, so
// that closing the sheet (Escape, a tap on the map above it, another place), a
// reload, or a session that ran out mid-post doesn't lose what the parent typed.
// localStorage rather than sessionStorage: the magic link usually opens the app in
// a new tab, which starts with an empty sessionStorage. An entry is removed once
// the review is posted or the form is emptied, and ignored after a day.
const DRAFT_PREFIX = 'tinyhike.reviewDraft.'
const DRAFT_TTL_MS = 24 * 60 * 60_000
const MAX_COMMENT = 500

/** Store the draft; false when storage is unavailable (private mode, blocked). */
export function saveDraft(placeId: string, draft: ReviewDraft): boolean {
  try {
    localStorage.setItem(DRAFT_PREFIX + placeId, JSON.stringify({ ...draft, savedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export function readDraft(placeId: string): ReviewDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + placeId)
    if (!raw) return null
    const draft = parseDraft(JSON.parse(raw))
    // Stale or malformed: drop it now rather than carry it forever.
    if (!draft) localStorage.removeItem(DRAFT_PREFIX + placeId)
    return draft
  } catch {
    return null
  }
}

export function clearDraft(placeId: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + placeId)
  } catch {
    /* storage unavailable: there was nothing to clear */
  }
}

/**
 * Remove every stored draft. Called on an explicit sign-out: on a shared phone or
 * tablet, the next parent to sign in must not find someone else's half-written
 * review in the form.
 */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(DRAFT_PREFIX)) keys.push(key)
    }
    // Collected first: removing while walking the indexes would skip entries.
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    /* storage unavailable: there was nothing to clear */
  }
}

/** True when the form holds something worth keeping (the API would accept it). */
export function draftHasContent(draft: ReviewDraft): boolean {
  return draft.score > 0 || hasVisibleText(draft.comment)
}

function parseDraft(value: unknown): ReviewDraft | null {
  if (!value || typeof value !== 'object') return null
  const { score, comment, savedAt } = value as Record<string, unknown>
  if (typeof savedAt !== 'number' || Date.now() - savedAt > DRAFT_TTL_MS) return null
  if (typeof comment !== 'string' || typeof score !== 'number') return null
  // Same bounds as the form, whatever the stored value says.
  const draft = {
    score: Number.isInteger(score) && score >= 1 && score <= 5 ? score : 0,
    comment: comment.slice(0, MAX_COMMENT),
  }
  return draftHasContent(draft) ? draft : null
}
