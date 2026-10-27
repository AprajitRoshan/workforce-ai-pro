import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api, { getTokens, onAuthChange, refreshTokens, setTokens, tokenExpiry } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadMe = useCallback(async () => {
    if (!getTokens()) { setUser(null); setLoading(false); return }
    try {
      const { data } = await api.get('/auth/me')
      setUser(data.user)
    } catch {
      setTokens(null)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadMe() }, [loadMe])
  useEffect(() => onAuthChange((t) => { if (!t) setUser(null) }), [])

  // Proactively refresh the access token one minute before it expires.
  useEffect(() => {
    if (!user) return
    let timer
    const schedule = () => {
      const t = getTokens()
      if (!t) return
      const wait = Math.max(5000, tokenExpiry(t.access_token) - Date.now() - 60000)
      timer = setTimeout(() => refreshTokens().then(schedule).catch(() => setUser(null)), wait)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [user])

  const finishAuth = (data) => {
    setTokens({ access_token: data.access_token, refresh_token: data.refresh_token })
    setUser(data.user)
    return data.user
  }

  const login = async (email, password) => finishAuth((await api.post('/auth/login', { email, password })).data)
  const register = async (body) => finishAuth((await api.post('/auth/register', body)).data)
  const logout = async (allDevices = false) => {
    try { await api.post('/auth/logout', null, { params: { all_devices: allDevices } }) } catch { /* ignore */ }
    setTokens(null)
    setUser(null)
  }

  const value = useMemo(() => ({
    user, loading, login, register, logout, reload: loadMe,
    hasRole: (...roles) => !!user && roles.includes(user.role),
    isHR: !!user && ['ADMIN', 'HR'].includes(user.role),
    isMgmt: !!user && ['ADMIN', 'HR', 'MANAGER'].includes(user.role),
  }), [user, loading, loadMe])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
