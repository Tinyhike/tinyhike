import { useState } from 'react'
import { api } from '../lib/api.js'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    await api.post('/api/auth/magic', { email })
    setSent(true)
  }

  if (sent) return <p style={{ padding: 16 }}>Check your inbox — link valid 15 min.</p>

  return (
    <form onSubmit={submit} style={{ padding: 16, maxWidth: 360, margin: '80px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h1 style={{ fontSize: 24 }}>Sign in to TinyHike</h1>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
        style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', fontSize: 16 }}
      />
      <button type="submit" style={{ padding: 10, background: '#2d6a4f', color: '#fff', fontSize: 16 }}>
        Send magic link
      </button>
    </form>
  )
}
