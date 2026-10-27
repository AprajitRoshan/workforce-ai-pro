import axios from 'axios'

const STORAGE_KEY = 'wf_tokens'
let tokens = null
try { tokens = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch { tokens = null }

const listeners = new Set()
export const onAuthChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

export function setTokens(t) {
  tokens = t
  try {
    if (t) localStorage.setItem(STORAGE_KEY, JSON.stringify(t))
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* storage unavailable */ }
  listeners.forEach((fn) => fn(t))
}
export const getTokens = () => tokens

export function tokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.exp * 1000
  } catch { return 0 }
}

const api = axios.create({ baseURL: '/api', timeout: 60000 })

api.interceptors.request.use((cfg) => {
  if (tokens?.access_token) cfg.headers.Authorization = `Bearer ${tokens.access_token}`
  return cfg
})

let refreshing = null
export function refreshTokens() {
  if (!tokens?.refresh_token) return Promise.reject(new Error('No refresh token'))
  refreshing ??= axios.post('/api/auth/refresh', { refresh_token: tokens.refresh_token })
    .then((r) => { setTokens({ access_token: r.data.access_token, refresh_token: r.data.refresh_token }); return r.data.access_token })
    .catch((e) => { setTokens(null); throw e })
    .finally(() => { refreshing = null })
  return refreshing
}

function errorMessage(err) {
  const d = err.response?.data?.detail
  if (Array.isArray(d)) return d.map((x) => `${x.loc?.slice(-1)[0] ?? ''}: ${x.msg}`.replace(/^: /, '')).join('; ')
  if (typeof d === 'string') return d
  if (err.code === 'ECONNABORTED') return 'Request timed out'
  if (!err.response) return 'Cannot reach the server. Is the backend running?'
  return `Request failed (${err.response.status})`
}

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const orig = err.config || {}
    const isAuthCall = orig.url?.startsWith('/auth/login') || orig.url?.startsWith('/auth/refresh')
    if (err.response?.status === 401 && tokens?.refresh_token && !orig._retry && !isAuthCall) {
      orig._retry = true
      try {
        const access = await refreshTokens()
        orig.headers.Authorization = `Bearer ${access}`
        return api(orig)
      } catch { /* fall through: session is over */ }
    }
    err.message = errorMessage(err)
    return Promise.reject(err)
  },
)

export async function download(url, params, fallbackName = 'download') {
  const r = await api.get(url, { params, responseType: 'blob' })
  const cd = r.headers['content-disposition'] || ''
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] || fallbackName
  const href = URL.createObjectURL(r.data)
  const a = Object.assign(document.createElement('a'), { href, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 2000)
}

export default api
