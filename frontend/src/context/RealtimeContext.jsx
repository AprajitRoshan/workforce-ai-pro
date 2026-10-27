import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import api, { getTokens, onAuthChange } from '../api/client'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'

const RealtimeContext = createContext(null)

export function RealtimeProvider({ children }) {
  const { user } = useAuth()
  const toast = useToast()
  const wsRef = useRef(null)
  const handlers = useRef(new Map())
  const [connected, setConnected] = useState(false)
  const [online, setOnline] = useState(new Set())
  const [unread, setUnread] = useState(0)
  const [chatUnread, setChatUnread] = useState(0)
  const [token, setToken] = useState(getTokens()?.access_token)

  useEffect(() => onAuthChange((t) => setToken(t?.access_token)), [])

  const subscribe = useCallback((type, fn) => {
    if (!handlers.current.has(type)) handlers.current.set(type, new Set())
    handlers.current.get(type).add(fn)
    return () => handlers.current.get(type)?.delete(fn)
  }, [])

  const refreshCounts = useCallback(() => {
    api.get('/notifications/unread-count').then((r) => setUnread(r.data.total)).catch(() => {})
    api.get('/chat/unread-count').then((r) => setChatUnread(r.data.total)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!user || !token) return
    let stop = false
    let retry = 0
    let pingTimer
    refreshCounts()
    api.get('/chat/online').then((r) => setOnline(new Set(r.data))).catch(() => {})

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(getTokens()?.access_token || '')}`)
      wsRef.current = ws
      ws.onopen = () => {
        retry = 0
        setConnected(true)
        pingTimer = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'ping' })), 25000)
      }
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'notification') {
          setUnread((n) => n + 1)
          const d = msg.data
          const kind = d.priority === 'CRITICAL' || d.priority === 'HIGH' ? 'warning' : d.type === 'SUCCESS' ? 'success' : 'info'
          toast[kind](d.title, d.message)
        } else if (msg.type === 'presence') {
          setOnline((s) => { const n = new Set(s); msg.data.online ? n.add(msg.data.user_id) : n.delete(msg.data.user_id); return n })
        } else if (msg.type === 'chat' && msg.data.receiver_id === user.id) {
          setChatUnread((n) => n + 1)
        }
        handlers.current.get(msg.type)?.forEach((fn) => fn(msg.data))
      }
      ws.onclose = (ev) => {
        setConnected(false)
        clearInterval(pingTimer)
        if (stop || ev.code === 4401) return
        retry += 1
        setTimeout(() => !stop && connect(), Math.min(15000, 1000 * 2 ** retry))
      }
    }
    connect()
    return () => { stop = true; clearInterval(pingTimer); wsRef.current?.close() }
  }, [user, token, toast, refreshCounts])

  const send = useCallback((payload) => {
    if (wsRef.current?.readyState === 1) { wsRef.current.send(JSON.stringify(payload)); return true }
    return false
  }, [])

  const value = useMemo(() => ({
    connected, online, unread, setUnread, chatUnread, setChatUnread, subscribe, send, refreshCounts,
  }), [connected, online, unread, chatUnread, subscribe, send, refreshCounts])

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export const useRealtime = () => useContext(RealtimeContext)
