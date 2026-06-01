import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'

interface Me {
  id: string
  email: string
  handle: string | null
  role: string
}

export default function ProfilePage() {
  const { data, isLoading } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api.get('/api/auth/me'),
    retry: false,
  })

  if (isLoading) return <p style={{ padding: 16 }}>Loading…</p>
  if (!data) return (
    <div style={{ padding: 16 }}>
      <p>Not signed in.</p>
      <Link to="/auth">Sign in</Link>
    </div>
  )

  return (
    <div style={{ padding: 16, maxWidth: 400, margin: '0 auto' }}>
      <h1>Profile</h1>
      <p style={{ marginTop: 8 }}>{data.email}</p>
      {data.handle && <p>@{data.handle}</p>}
      <p style={{ color: '#666', marginTop: 4 }}>{data.role}</p>
      <button
        onClick={() => api.post('/api/auth/logout', {}).then(() => window.location.replace('/'))}
        style={{ marginTop: 16, padding: '8px 16px', background: '#c0392b', color: '#fff' }}
      >
        Sign out
      </button>
    </div>
  )
}
