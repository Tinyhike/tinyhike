import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useI18n } from '../lib/i18n.js'

interface ListSummary {
  id: string
  slug: string
  translations: Array<{ name: string }>
  _count: { listPlaces: number }
}

export default function ListsPage() {
  const { t } = useI18n()
  const { data, isLoading, isError, error } = useQuery<ListSummary[]>({
    queryKey: ['lists', 'public'],
    queryFn: () => api.get('/api/lists/public'),
  })

  return (
    <div className="page">
      <h1>{t('lists.title')}</h1>

      {isLoading && (
        <div className="skeleton-group">
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line skeleton--short" />
        </div>
      )}

      {isError && (
        <p className="state state--error" role="alert">
          {t('lists.error')}
          {error instanceof Error ? ` ${error.message}` : ''}
        </p>
      )}

      {data?.length === 0 && <p className="state-detail">{t('lists.empty')}</p>}

      {data && data.length > 0 && (
        <ul className="card-list">
          {data.map((l) => (
            <li key={l.id}>
              <Link to={`/lists/${l.slug}`} className="card">
                {l.translations[0]?.name ?? l.slug}
                <span className="card-meta">
                  {l._count.listPlaces} {t('lists.places')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
