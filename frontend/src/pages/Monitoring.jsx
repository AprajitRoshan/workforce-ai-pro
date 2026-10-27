import { useEffect, useState } from 'react'
import { Activity, AlertOctagon, Clock, LogIn, Radio, UserCheck, UserX, Wifi } from 'lucide-react'
import { BarsChart } from '../components/charts'
import { Avatar, Badge, Card, EmptyState, PageHeader, PageLoader, StatCard, StatusBadge, cx, fmtTime, timeAgo } from '../components/ui'
import { useRealtime } from '../context/RealtimeContext'
import { useApi } from '../hooks/useApi'

const ACTION_TONE = { CHECK_IN: 'green', CHECK_OUT: 'blue', LOGIN: 'gray', LOGIN_FAILED: 'red', DELETE: 'red', CREATE: 'indigo', UPDATE: 'amber', PREDICT: 'purple', APPROVED: 'green', REJECTED: 'red' }

export default function Monitoring() {
  const { data, reload } = useApi('/monitoring/live')
  const { subscribe, connected } = useRealtime()
  const [feed, setFeed] = useState([])
  const [flash, setFlash] = useState(null)
  useEffect(() => { if (data) setFeed(data.feed) }, [data])
  useEffect(() => subscribe('activity', (a) => {
    setFeed((f) => [{ ...a, id: a.id || `live-${Date.now()}`, live: true }, ...f].slice(0, 60))
    setFlash(Date.now())
    if (['CHECK_IN', 'CHECK_OUT'].includes(a.action)) reload()
  }), [subscribe, reload])
  useEffect(() => { const t = setInterval(reload, 30000); return () => clearInterval(t) }, [reload])
  if (!data) return <PageLoader />
  return (
    <>
      <PageHeader title="Real-Time Workforce Monitor" icon={Radio}
        subtitle={<span className="inline-flex items-center gap-2">{connected ? <><span className="pulse-dot h-2 w-2 rounded-full bg-emerald-500" />Streaming live events</> : 'Reconnecting…'} · refreshed {fmtTime(data.timestamp)}</span>} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Working now" value={data.working_now} icon={Activity} tone="green" />
        <StatCard label="Presence rate" value={`${data.presence_rate}%`} icon={UserCheck} sub={`${data.checked_out} checked out`} />
        <StatCard label="Late today" value={data.late} icon={Clock} tone="amber" />
        <StatCard label="On leave" value={data.on_leave} tone="purple" />
        <StatCard label="Not checked in" value={data.not_checked_in} icon={UserX} tone="red" sub={`of ${data.headcount}`} />
        <StatCard label="Users online" value={data.online_users} icon={Wifi} tone="blue" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Workforce instability detection" subtitle="Compares today against a 30-day baseline">
            {data.instability_signals.length ? (
              <ul className="space-y-2">
                {data.instability_signals.map((s, i) => (
                  <li key={i} className={cx('flex items-start gap-3 rounded-lg border-l-4 bg-surface-2 p-3', s.level === 'HIGH' ? 'border-l-rose-500' : 'border-l-amber-500')}>
                    <AlertOctagon className={cx('mt-0.5 h-4 w-4 shrink-0', s.level === 'HIGH' ? 'text-rose-500' : 'text-amber-500')} />
                    <div><p className="text-sm font-semibold">{s.signal}</p><p className="text-xs text-muted">{s.detail}</p></div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={UserCheck} title="No instability detected" description="Attendance and risk signals are within normal range." />}
          </Card>
          <Card title="Working now by department">
            <BarsChart data={data.working_by_department} x="department" height={220} bars={[{ key: 'count', name: 'Working', color: '#10b981' }]} />
          </Card>
          <Card title={`On the clock (${data.working.length})`} bodyClass="p-0">
            <div className="grid max-h-80 gap-px overflow-y-auto bg-line sm:grid-cols-2 lg:grid-cols-3">
              {data.working.map((w) => (
                <div key={w.employee_id} className="flex items-center gap-2 bg-surface p-2.5">
                  <Avatar name={w.employee} size="sm" online />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{w.employee}</p><p className="truncate text-[11px] text-muted">{w.department} · in {fmtTime(w.check_in)}</p></div>
                  {w.status === 'LATE' && <StatusBadge status="LATE" />}
                </div>
              ))}
            </div>
          </Card>
        </div>
        <Card title={<span className="inline-flex items-center gap-2">Live activity feed {flash && <span key={flash} className="pulse-dot h-2 w-2 rounded-full bg-indigo-500" />}</span>} bodyClass="p-0">
          <ul className="max-h-[900px] divide-y divide-line overflow-y-auto">
            {feed.map((a) => (
              <li key={a.id} className={cx('flex gap-3 px-4 py-2.5', a.live && 'animate-slide-in bg-brand-soft/40')}>
                {a.action === 'CHECK_IN' ? <LogIn className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <Activity className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{a.summary}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted"><Badge tone={ACTION_TONE[a.action] || 'gray'}>{a.action}</Badge>{timeAgo(a.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
