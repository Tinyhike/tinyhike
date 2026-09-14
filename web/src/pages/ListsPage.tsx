import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'

interface ListSummary {
  id: string
  slug: string
  translations: Array<{ name: string }>
  _count: { listPlaces: number }
}

export default function ListsPage() {
  const { data, isLoading, isError, error } = useQuery<ListSummary[]>({
    queryKey: ['lists', 'public'],
    queryFn: () => api.get('/api/lists/public'),
  })

  return (
    <div className="page">
      <h1>Listes publiques</h1>

      {isLoading && (
        <div className="skeleton-group">
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line skeleton--short" />
        </div>
      )}

      {isError && (
        <p className="state state--error" role="alert">
          Impossible de charger les listes.{error instanceof Error ? ` ${error.message}` : ''}
        </p>
      )}

      {data?.length === 0 && <p className="state-detail">Aucune liste publique pour le moment.</p>}

      {data && data.length > 0 && (
        <ul style={{ marginTop: 12, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.map((l) => (
            <li key={l.id}>
              <Link
                to={`/lists/${l.slug}`}
                style={{ display: 'block', padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
              >
                <strong>{l.translations[0]?.name ?? l.slug}</strong>
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{l._count.listPlaces} lieux</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
