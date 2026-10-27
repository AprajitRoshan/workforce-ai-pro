import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, CheckCheck, MessageSquare, Search, Send, ShieldCheck } from 'lucide-react'
import api from '../api/client'
import { BarsChart } from '../components/charts'
import { Avatar, Badge, Card, DataTable, EmptyState, Input, PageHeader, Tabs, cx, fmtDateTime, fmtTime, timeAgo } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useRealtime } from '../context/RealtimeContext'
import { useToast } from '../context/ToastContext'
import { useApi } from '../hooks/useApi'

export default function Chat() {
  const { isHR } = useAuth()
  const [tab, setTab] = useState('chat')
  return (
    <>
      <PageHeader title="Messages" icon={MessageSquare} subtitle="Real-time one-to-one messaging with read receipts" />
      {isHR && <Tabs value={tab} onChange={setTab} tabs={[{ value: 'chat', label: 'Chat' }, { value: 'logs', label: 'Communication logs', icon: ShieldCheck }]} />}
      {tab === 'chat' ? <ChatWindow /> : <Logs />}
    </>
  )
}

function ChatWindow() {
  const { user } = useAuth()
  const toast = useToast()
  const { online, subscribe, send, setChatUnread, refreshCounts } = useRealtime()
  const { data: directory } = useApi('/users/directory')
  const { data: convs, reload: reloadConvs, setData: setConvs } = useApi('/chat/conversations')
  const [peer, setPeer] = useState(null)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [filter, setFilter] = useState('')
  const [typing, setTyping] = useState(false)
  const endRef = useRef(null)
  const typingTimer = useRef(null)
  const lastTypingSent = useRef(0)

  const contacts = useMemo(() => {
    const byId = new Map((convs || []).map((c) => [c.peer_id, c]))
    const list = (directory || []).map((u) => ({ ...u, conv: byId.get(u.id) }))
    list.sort((a, b) => (b.conv?.last_message.created_at || '').localeCompare(a.conv?.last_message.created_at || '') || a.full_name.localeCompare(b.full_name))
    return list.filter((u) => u.full_name.toLowerCase().includes(filter.toLowerCase()))
  }, [directory, convs, filter])

  const markRead = useCallback((pid) => {
    if (!send({ type: 'read', peer_id: pid })) api.post(`/chat/read/${pid}`).catch(() => {})
    setConvs((cs) => (cs || []).map((c) => (c.peer_id === pid ? { ...c, unread: 0 } : c)))
    setTimeout(refreshCounts, 300)
  }, [send, setConvs, refreshCounts])

  useEffect(() => {
    if (!peer) return
    api.get(`/chat/messages/${peer.id}`).then((r) => setMessages(r.data))
    markRead(peer.id)
  }, [peer, markRead])

  useEffect(() => subscribe('chat', (m) => {
    const other = m.sender_id === user.id ? m.receiver_id : m.sender_id
    if (peer && other === peer.id) {
      setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]))
      if (m.sender_id === peer.id) { markRead(peer.id); setChatUnread((n) => Math.max(0, n - 1)) }
      setTyping(false)
    }
    reloadConvs()
  }), [subscribe, peer, user.id, markRead, reloadConvs, setChatUnread])

  useEffect(() => subscribe('read_receipt', (r) => {
    if (peer && r.reader_id === peer.id) setMessages((ms) => ms.map((m) => (m.sender_id === user.id && !m.read_at ? { ...m, read_at: r.read_at } : m)))
  }), [subscribe, peer, user.id])

  useEffect(() => subscribe('typing', (t) => {
    if (peer && t.user_id === peer.id) {
      setTyping(true)
      clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => setTyping(false), 2500)
    }
  }), [subscribe, peer])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, typing])

  const submit = async (e) => {
    e.preventDefault()
    const content = text.trim()
    if (!content || !peer) return
    setText('')
    if (!send({ type: 'chat', receiver_id: peer.id, content })) {
      try { const r = await api.post('/chat/messages', { receiver_id: peer.id, content }); setMessages((ms) => [...ms, r.data]) }
      catch (err) { toast.error('Message not sent', err.message); setText(content) }
    }
  }
  const onType = (e) => {
    setText(e.target.value)
    if (peer && Date.now() - lastTypingSent.current > 1500) { send({ type: 'typing', peer_id: peer.id }); lastTypingSent.current = Date.now() }
  }

  return (
    <div className="card grid h-[calc(100vh-14rem)] min-h-[480px] overflow-hidden md:grid-cols-[300px_1fr]">
      <aside className={cx('flex min-h-0 flex-col border-r border-line', peer && 'hidden md:flex')}>
        <div className="border-b border-line p-3">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input className="pl-9" placeholder="Search people…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {contacts.map((c) => (
            <button key={c.id} onClick={() => setPeer(c)} className={cx('flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2', peer?.id === c.id && 'bg-brand-soft')}>
              <Avatar name={c.full_name} size="sm" online={online.has(c.id)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{c.full_name}</p>
                  {c.conv && <span className="shrink-0 text-[10px] text-muted">{timeAgo(c.conv.last_message.created_at)}</span>}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-muted">{c.conv ? c.conv.last_message.content : `${c.role.toLowerCase()} · ${c.department || ''}`}</p>
                  {c.conv?.unread > 0 && <span className="rounded-full bg-indigo-500 px-1.5 text-[10px] font-bold text-white">{c.conv.unread}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>
      <section className={cx('flex min-h-0 flex-col', !peer && 'hidden md:flex')}>
        {!peer ? <div className="flex flex-1 items-center justify-center"><EmptyState icon={MessageSquare} title="Select a conversation" description="Messages are delivered instantly over WebSockets." /></div> : (
          <>
            <header className="flex items-center gap-3 border-b border-line px-4 py-3">
              <button className="md:hidden" onClick={() => setPeer(null)} aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
              <Avatar name={peer.full_name} size="sm" online={online.has(peer.id)} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{peer.full_name}</p>
                <p className="text-[11px] text-muted">{typing ? <span className="text-indigo-500">typing…</span> : online.has(peer.id) ? 'Online' : 'Offline'} · {peer.job_title || peer.role}</p>
              </div>
              <Badge className="ml-auto">{peer.role}</Badge>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto bg-surface-2 p-4">
              {!messages.length && <p className="pt-10 text-center text-sm text-muted">No messages yet — say hello 👋</p>}
              {messages.map((m) => {
                const mine = m.sender_id === user.id
                return (
                  <div key={m.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
                    <div className={cx('max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm', mine ? 'rounded-br-md bg-indigo-600 text-white' : 'rounded-bl-md border border-line bg-surface')}>
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <p className={cx('mt-1 flex items-center justify-end gap-1 text-[10px]', mine ? 'text-indigo-100' : 'text-muted')} title={fmtDateTime(m.created_at)}>
                        {fmtTime(m.created_at)}
                        {mine && (m.read_at ? <CheckCheck className="h-3.5 w-3.5 text-sky-300" /> : <Check className="h-3.5 w-3.5" />)}
                      </p>
                    </div>
                  </div>
                )
              })}
              {typing && <div className="inline-flex gap-1 rounded-2xl border border-line bg-surface px-3 py-2">{[0, 1, 2].map((i) => <span key={i} className="pulse-dot h-1.5 w-1.5 rounded-full bg-muted" style={{ animationDelay: `${i * 0.2}s` }} />)}</div>}
              <div ref={endRef} />
            </div>
            <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
              <Input value={text} onChange={onType} placeholder={`Message ${peer.full_name.split(' ')[0]}…`} maxLength={4000} autoFocus />
              <button type="submit" disabled={!text.trim()} className="rounded-lg bg-indigo-600 px-3 text-white hover:bg-indigo-500 disabled:opacity-50" aria-label="Send"><Send className="h-4 w-4" /></button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}

function Logs() {
  const { data, loading } = useApi('/chat/logs', { days: 30 })
  return (
    <div className="space-y-4">
      <Card title="Message volume (30 days)" subtitle={`${data?.total ?? 0} messages · content is never shown in logs`}>
        <BarsChart data={data?.daily || []} x="date" height={200} bars={[{ key: 'messages', name: 'Messages' }]} />
      </Card>
      <Card title="Conversation pairs" bodyClass="p-0">
        <DataTable loading={loading} rows={data?.pairs} rowKey="last_at" columns={[
          { key: 'user_a', label: 'Participant' }, { key: 'user_b', label: 'Participant' }, { key: 'messages', label: 'Messages', align: 'right' },
          { key: 'last_at', label: 'Last activity', render: (r) => fmtDateTime(r.last_at) }]} />
      </Card>
    </div>
  )
}
