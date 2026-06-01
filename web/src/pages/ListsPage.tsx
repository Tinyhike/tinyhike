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
  const { data, isLoading } = useQuery<ListSummary[]>({
    queryKey: ['lists', 'public'],
    queryFn: () => api.get('/api/lists/public'),
  })

  if (isLoading) return <p style={{ padding: 16 }}>Loading…</p>

  return (
    <div style={{ padding: 16, maxWidth: 600, margin: '0 auto' }}>
      <h1>Public lists</h1>
      <ul style={{ marginTop: 12, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data?.map((l) => (
          <li key={l.id}>
            <Link to={`/lists/${l.slug}`} style={{ display: 'block', padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
              <strong>{l.translations[0]?.name ?? l.slug}</strong>
              <span style={{ color: '#666', marginLeft: 8 }}>{l._count.listPlaces} places</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
