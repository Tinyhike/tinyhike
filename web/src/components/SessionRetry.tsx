import type { Ref } from 'react'
import { useI18n } from '../lib/i18n.js'

/**
 * Shown when /api/auth/me keeps failing for a reason other than "signed out" (a
 * 502 during an API restart, a Cloudflare challenge, offline). We can't tell
 * whether the user is signed in, so we offer a retry instead of a sign-in prompt.
 * Render it once per screen: every gated block on that screen waits on the same
 * lookup, and a repeated line reads as several separate problems.
 */
export default function SessionRetry({ onRetry, busy = false }: { onRetry: () => void; busy?: boolean }) {
  const { t } = useI18n()
  return <RetryLine message={t('session.unknown')} onRetry={onRetry} busy={busy} />
}

/**
 * "Something couldn't be loaded — Try again", as one line. While `busy`, the
 * button stays mounted (it holds the focus) but says it is working and ignores
 * presses: a retry with no visible effect for several seconds gets tapped again.
 */
export function RetryLine({
  message,
  onRetry,
  busy,
  buttonRef,
}: {
  message: string
  onRetry: () => void
  busy: boolean
  buttonRef?: Ref<HTMLButtonElement>
}) {
  const { t } = useI18n()
  return (
    <p className="session-retry">
      <span>{message}</span>
      <button
        ref={buttonRef}
        type="button"
        className="link-btn"
        // aria-disabled rather than disabled: a disabled button drops its focus.
        aria-disabled={busy}
        onClick={() => {
          if (!busy) onRetry()
        }}
      >
        {busy ? t('session.checking') : t('session.retry')}
      </button>
    </p>
  )
}
