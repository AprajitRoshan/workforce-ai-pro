import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Mail, MailOpen, Megaphone, Radar, Sparkles, Trash2 } from 'lucide-react'
import api from '../api/client'
import {
  Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, StatCard, Tabs, Textarea, cx, fmtDateTime, timeAgo,
  titleCase,
} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useRealtime } from '../context/RealtimeContext'
import { useToast } from '../context/ToastContext'
import { useApi } from '../hooks/useApi'

const PRIO_TONE = { LOW: 'blue', MEDIUM: 'amber', HIGH: 'red', CRITICAL: 'red' }

export default function Notifications() {
  const { isHR, isMgmt } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const { setUnread, subscribe, refreshCounts } = useRealtime()
  const [tab, setTab] = useState('all')
  const [f, setF] = useState({ category: '', priority: '' })
  const [page, setPage] = useState(1)
  const [broadcast, setBroadcast] = useState(null)
  const url = tab === 'ai' ? '/alerts' : '/notifications'
  const { data, loading, reload, setData } = useApi(url, { ...f, unread_only: tab === 'unread' || undefined, page, size: 20 })
  const { data: stats, reload: reloadStats } = useApi(isMgmt ? '/alerts/stats' : null)
  useEffect(() => subscribe('notification', () => { reload(); reloadStats() }), [subscribe, reload, reloadStats])

  const patch = (n, changes) => setData((d) => ({ ...d, items: d.items.map((x) => (x.id === n.id ? { ...x, ...changes } : x)) }))
  const toggle = async (n) => {
    await api.post(`/notifications/${n.id}/${n.is_read ? 'unread' : 'read'}`)
    patch(n, { is_read: !n.is_read })
    setUnread((c) => Math.max(0, c + (n.is_read ? 1 : -1)))
  }
  const remove = async (n) => { await api.delete(`/notifications/${n.id}`); reload(); refreshCounts() }
  const readAll = async () => { await api.post('/notifications/read-all'); setUnread(0); reload() }
  const runEngine = async () => {
    try {
      const r = await api.post('/alerts/run')
      toast.info('Alert engine finished', `${r.data.total} new alert(s): ${r.data.escalations} escalations, ${r.data.burnout} burnout, ${r.data.instability} instability`)
      reload(); reloadStats()
    } catch (e) { toast.error('Alert engine failed', e.message) }
  }
  const send = async () => {
    try { const r = await api.post('/notifications/broadcast', broadcast); toast.success('Broadcast sent', `${r.data.sent} recipients`); setBroadcast(null) }
    catch (e) { toast.error('Broadcast failed', e.message) }
  }
  const open = async (n) => {
    if (!n.is_read) { await api.post(`/notifications/${n.id}/read`); setUnread((c) => Math.max(0, c - 1)) }
    if (n.link) nav(n.link)
  }

  return (
    <>
      <PageHeader title="Notifications & Alerts" icon={Bell} subtitle="In-app notifications, AI alerts and escalations"
        actions={<>
          <Button variant="secondary" icon={CheckCheck} onClick={readAll}>Mark all read</Button>
          {isHR && <Button variant="secondary" icon={Radar} onClick={runEngine}>Run alert engine</Button>}
          {isHR && <Button icon={Megaphone} onClick={() => setBroadcast({ title: '', message: '', priority: 'MEDIUM', roles: ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'] })}>Broadcast</Button>}
        </>} />
      {isMgmt && stats && (
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Critical AI alerts" value={stats.by_priority.CRITICAL || 0} tone="red" icon={Sparkles} />
          <StatCard label="High priority" value={stats.by_priority.HIGH || 0} tone="amber" />
          <StatCard label="Unread AI alerts" value={stats.unread} tone="indigo" />
          <StatCard label="Escalated" value={stats.escalated} tone="purple" />
        </div>
      )}
      <Tabs value={tab} onChange={(t) => { setTab(t); setPage(1) }} tabs={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }, isMgmt && { value: 'ai', label: 'AI alerts', icon: Sparkles }]} />
      <Card bodyClass="p-0">
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Select className="w-auto" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="All categories" options={['SYSTEM', 'LEAVE', 'PAYROLL', 'RISK', 'TASK', 'ATTENDANCE']} />
          <Select className="w-auto" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} placeholder="Any priority" options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']} />
        </div>
        {!loading && !data?.items.length && <EmptyState icon={Bell} title="No notifications" description="You're all caught up." />}
        <ul className="divide-y divide-line">
          {(data?.items || []).map((n) => (
            <li key={n.id} className={cx('group flex gap-3 px-4 py-3', !n.is_read && 'bg-brand-soft/40')}>
              <span className={cx('mt-2 h-2 w-2 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-indigo-500')} />
              <button className="min-w-0 flex-1 text-left" onClick={() => open(n)}>
                <div className="flex flex-wrap items-center gap-2">
                  {n.is_ai && <Sparkles className="h-4 w-4 text-violet-500" />}
                  <span className="text-sm font-semibold">{n.title}</span>
                  <Badge tone={PRIO_TONE[n.priority]}>{n.priority}</Badge>
                  <Badge>{titleCase(n.category)}</Badge>
                  {n.escalated && <Badge tone="purple">Escalated</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-muted">{n.message}</p>
                <p className="mt-1 text-[11px] text-muted" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}</p>
              </button>
              <div className="flex shrink-0 items-start gap-1 opacity-60 group-hover:opacity-100">
                <button onClick={() => toggle(n)} className="rounded p-1.5 hover:bg-surface-2" title={n.is_read ? 'Mark unread' : 'Mark read'}>{n.is_read ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}</button>
                <button onClick={() => remove(n)} className="rounded p-1.5 hover:bg-surface-2 hover:text-rose-500" title="Delete"><Trash2 className="h-4 w-4" /></button>
              </div>
            </li>
          ))}
        </ul>
        {data && data.pages > 1 && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      </Card>
      <Modal open={!!broadcast} onClose={() => setBroadcast(null)} title="Broadcast announcement" footer={<><Button variant="secondary" onClick={() => setBroadcast(null)}>Cancel</Button><Button icon={Megaphone} onClick={send}>Send</Button></>}>
        {broadcast && (
          <div className="space-y-3">
            <Field label="Title"><Input value={broadcast.title} onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })} /></Field>
            <Field label="Message"><Textarea value={broadcast.message} onChange={(e) => setBroadcast({ ...broadcast, message: e.target.value })} /></Field>
            <Field label="Priority"><Select value={broadcast.priority} onChange={(e) => setBroadcast({ ...broadcast, priority: e.target.value })} options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']} /></Field>
            <div className="flex flex-wrap gap-3 text-sm">
              {['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'].map((r) => (
                <label key={r} className="flex items-center gap-1.5"><input type="checkbox" className="accent-indigo-600" checked={broadcast.roles.includes(r)}
                  onChange={() => setBroadcast({ ...broadcast, roles: broadcast.roles.includes(r) ? broadcast.roles.filter((x) => x !== r) : [...broadcast.roles, r] })} />{titleCase(r)}</label>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
