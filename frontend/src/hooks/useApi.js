import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../api/client'

// Tiny stale-while-revalidate cache shared across pages (keeps navigation snappy).
const cache = new Map()
const keyOf = (url, params) => url + (params ? JSON.stringify(params) : '')

export function serializeParams(params) {
  const sp = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x))
    else sp.append(k, v)
  })
  return sp
}

export function useApi(url, params, { enabled = true, keepPrevious = true } = {}) {
  const key = url ? keyOf(url, params) : null
  const [data, setData] = useState(() => (key ? cache.get(key) : undefined))
  const [loading, setLoading] = useState(!data && enabled && !!url)
  const [error, setError] = useState(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!url || !enabled) return
    const id = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const r = await api.get(url, { params: serializeParams(params) })
      if (id !== seq.current) return
      cache.set(key, r.data)
      setData(r.data)
    } catch (e) {
      if (id === seq.current) setError(e.message)
    } finally {
      if (id === seq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  useEffect(() => {
    if (!keepPrevious) setData(cache.get(key))
    else if (cache.has(key)) setData(cache.get(key))
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  return { data, loading, error, reload: load, setData }
}

export function invalidate(prefix) {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k)
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}
