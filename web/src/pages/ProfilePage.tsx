import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'

interface Me {
  id: string
  email: string
  handle: string | null
  role: string
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<Me>({
    queryKey: ['me'],
    // A 401 here just means "signed out" — retrying it three times only delays the
    // sign-in prompt.
    retry: false,
    queryFn: () => api.get('/api/auth/me'),
  })

  async function signOut() {
    await api.post('/api/auth/logout', {})
    // Drop every cached response: some of it is scoped to the user we just left.
    queryClient.clear()
    navigate('/')
  }

  if (isLoading) {
    return (
      <div className="page">
        <div className="skeleton-group">
          <div className="skeleton skeleton--title" />
          <div className="skeleton skeleton--line skeleton--short" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="page">
        <h1>Profil</h1>
        <p className="state-detail">Tu n’es pas connecté.</p>
        <Link to="/auth" className="btn" style={{ display: 'inline-block', textDecoration: 'none', color: '#fff' }}>
          Se connecter
        </Link>
      </div>
    )
  }

  return (
    <div className="page">
      <h1>Profil</h1>
      <p>{data.email}</p>
      {data.handle && <p className="state-detail">@{data.handle}</p>}
      <p className="state-detail">{data.role}</p>
      <button onClick={signOut} className="btn" style={{ background: '#c0392b' }}>
        Se déconnecter
      </button>
    </div>
  )
}
