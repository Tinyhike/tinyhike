import { NavLink, Outlet } from 'react-router-dom'
import { useI18n } from '../lib/i18n.js'

/**
 * The app shell: a full-height column with the routed page on top and a persistent
 * tab bar underneath. Before this existed the router had five routes and no way to
 * move between them — /lists and /profile were reachable only by typing the URL,
 * and leaving a place meant using the browser's back button.
 */
export default function AppLayout() {
  const { t } = useI18n()

  return (
    <div className="app-shell">
      <main className="app-main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="TinyHike">
        <Tab to="/" label={t('nav.map')} end>
          <path d="M9 3 3 5.5v16L9 19l6 2.5 6-2.5v-16L15 5.5 9 3Zm0 0v16m6-13.5v16" />
        </Tab>
        <Tab to="/lists" label={t('nav.lists')}>
          <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
        </Tab>
        <Tab to="/profile" label={t('nav.profile')}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        </Tab>
      </nav>
    </div>
  )
}

function Tab({
  to,
  label,
  end,
  children,
}: {
  to: string
  label: string
  end?: boolean
  children: React.ReactNode
}) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'tab tab--active' : 'tab')}>
      {/* Inline SVG rather than an icon package: three icons don't justify a dependency. */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
      <span>{label}</span>
    </NavLink>
  )
}
