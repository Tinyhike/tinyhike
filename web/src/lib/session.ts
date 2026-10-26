import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api, ApiError } from './api.js'

export interface Me {
  id: string
  email: string
  handle: string | null
  role: string
}

/**
 * - pending: the first /me lookup has not answered yet (retries included).
 * - signedIn / signedOut: the server said so.
 * - unknown: /me kept failing for another reason (502 during a restart, a
 *   Cloudflare challenge, offline). Not the same as signed out: showing a sign-in
 *   prompt here would send a signed-in parent through the magic link again.
 */
export type SessionStatus = 'pending' | 'signedIn' | 'signedOut' | 'unknown'

const ME_KEY = ['me'] as const

async function fetchMe(signal: AbortSignal): Promise<Me | null> {
  try {
    return await api.get<Me>('/api/auth/me', signal)
  } catch (err) {
    // 401: no session, or an expired one. 404: the session's user was deleted.
    // Both resolve to null instead of throwing: signed out is data, not an error.
    // TanStack keeps the previous data when a refetch throws, so a thrown 401
    // would leave a stale signed-in state on screen forever.
    if (err instanceof ApiError && (err.status === 401 || err.status === 404)) return null
    throw err
  }
}

/**
 * The one "who am I" lookup, shared by every component that gates on the session
 * so they agree on the retry policy and on what counts as signed out.
 */
export function useMe(): {
  me: Me | null
  status: SessionStatus
  /** True while a re-check started from the 'unknown' state is in flight. */
  checking: boolean
  refetch: () => void
} {
  const query = useQuery<Me | null>({
    queryKey: ME_KEY,
    queryFn: ({ signal }) => fetchMe(signal),
    // Signed out resolves, so only transient failures reach this.
    retry: 2,
    // Several components on one sheet mount together; one lookup a minute is plenty.
    staleTime: 60_000,
  })

  // TanStack v5 puts a query that has no data back to pending when it is refetched,
  // so a re-check after a failure would read as the first load: the retry line (and
  // the focus on its button) would vanish for the length of the re-check.
  // errorUpdateCount tells the two apart; the re-check stays 'unknown', with
  // `checking` set while it runs.
  const status: SessionStatus = query.data
    ? 'signedIn'
    : query.data === null
      ? 'signedOut'
      : query.isPending && query.errorUpdateCount === 0
        ? 'pending'
        : 'unknown'

  return {
    me: query.data ?? null,
    status,
    checking: status === 'unknown' && query.isFetching,
    refetch: () => {
      void query.refetch()
    },
  }
}

/**
 * Record that the session is gone: after logout, or when any API call answers 401.
 * Invalidating ['me'] is not enough on its own: the refetch would have to succeed
 * before the cached user disappears, and until then every gate stays open.
 */
export function markSignedOut(queryClient: QueryClient): void {
  queryClient.setQueryData<Me | null>(ME_KEY, null)
}
