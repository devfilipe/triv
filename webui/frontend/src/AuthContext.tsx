/* triv WebUI — Authentication context */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { apiFetch, getToken, removeToken, setToken } from './apiFetch'

interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'editor' | 'viewer'
}

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  isAdmin: boolean
  canEdit: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken)
  const [user, setUser] = useState<AuthUser | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleRefresh = useCallback((expiresIn: number) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    // Refresh when 5 minutes remain
    const delay = Math.max((expiresIn - 300) * 1000, 10_000)
    refreshTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch('/api/auth/refresh', { method: 'POST' })
        if (res.ok) {
          const data = await res.json()
          setToken(data.access_token)
          setTokenState(data.access_token)
          scheduleRefresh(data.expires_in)
        }
      } catch {
        // Ignore refresh errors — next API call will trigger re-login
      }
    }, delay)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Login failed')
    }
    const data = await res.json()
    setToken(data.access_token)
    setTokenState(data.access_token)
    setUser(data.user)
    scheduleRefresh(data.expires_in)
  }, [scheduleRefresh])

  const logout = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    removeToken()
    setTokenState(null)
    setUser(null)
  }, [])

  // Fetch user info on mount if token exists
  useEffect(() => {
    if (!token) return
    apiFetch('/api/auth/me')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setUser(data))
      .catch(() => {
        // Token invalid — clear it
        removeToken()
        setTokenState(null)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isAdmin = user?.role === 'admin'
  const canEdit = user?.role === 'admin' || user?.role === 'editor'

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAdmin, canEdit }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
