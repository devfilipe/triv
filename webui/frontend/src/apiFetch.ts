/* triv WebUI — Auth-aware fetch wrapper */

const TOKEN_KEY = 'triv_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const res = await fetch(url, { ...init, headers })
  if (res.status === 401) {
    const hadToken = getToken() !== null
    removeToken()
    if (hadToken) {
      window.location.href = '/login'
    }
  }
  return res
}
