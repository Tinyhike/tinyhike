import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'

export default function PlacePage() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading } = useQuery({
    queryKey: ['place', id],
    queryFn: () => api.get<{ translations: Array<{ locale: string; name: string; description?: string; tips?: string }>; photos: Array<{ r2Url: string }> }>(`/api/places/${id}?locale=nl`),
  })

  if (isLoading) return <p style={{ padding: 16 }}>Loading…</p>
  if (!data) return <p style={{ padding: 16 }}>Not found</p>

  const t = data.translations[0]
  return (
    <div style={{ padding: 16, maxWidth: 600, margin: '0 auto' }}>
      <h1>{t?.name}</h1>
      {t?.description && <p style={{ marginTop: 8 }}>{t.description}</p>}
      {t?.tips && <p style={{ marginTop: 8, fontStyle: 'italic' }}>{t.tips}</p>}
      {data.photos.map((ph) => (
        <img key={ph.r2Url} src={ph.r2Url} alt="" style={{ width: '100%', borderRadius: 8, marginTop: 12 }} />
      ))}
    </div>
  )
}
