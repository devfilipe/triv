/* triv WebUI — Login page */

import React, { FormEvent, useState } from 'react'
import { useAuth } from './AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#1e1e2e',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        background: '#181825',
        border: '1px solid #313244',
        borderRadius: 12,
        padding: '2.5rem 2rem',
        width: '100%',
        maxWidth: 360,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        {/* Logo / title */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img src="/logo.svg" alt="triv" style={{ height: 48, width: 'auto' }} />
          <div style={{ color: '#6c7086', fontSize: 13, marginTop: 6 }}>
            Network topology management
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', color: '#cdd6f4', fontSize: 13, marginBottom: 6 }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              required
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                background: '#1e1e2e',
                border: '1px solid #313244',
                borderRadius: 6,
                color: '#cdd6f4',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', color: '#cdd6f4', fontSize: 13, marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                background: '#1e1e2e',
                border: '1px solid #313244',
                borderRadius: 6,
                color: '#cdd6f4',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div style={{
              background: '#45132f',
              border: '1px solid #f38ba8',
              borderRadius: 6,
              color: '#f38ba8',
              fontSize: 13,
              padding: '0.5rem 0.75rem',
              marginBottom: '1rem',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.65rem',
              background: loading ? '#45475a' : '#cba6f7',
              color: '#1e1e2e',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
