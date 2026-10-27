import { useState } from 'react'
import { History, ScrollText, ShieldAlert, Users } from 'lucide-react'
import { BarsChart } from '../components/charts'
import { Badge, Card, DataTable, Input, Modal, PageHeader, Select, StatCard, fmtDateTime, titleCase } from '../components/ui'
import { useApi, useDebounced } from '../hooks/useApi'

const TONE = { CREATE: 'green', UPDATE: 'amber', DELETE: 'red', LOGIN: 'gray', LOGIN_FAILED: 'red', EXPORT: 'blue', PREDICT: 'purple', TRAIN: 'purple' }

export default function Audit() {
  const [f, setF] = useState({ q: '', action: '', entity_type: '', date_from: '', date_to: '' })
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState(null)
  const q = useDebounced(f.q)
  const { data: stats } = useApi('/audit/stats', { days: 14 })
  const { data, loading } = useApi('/audit', { ...f, q, page, size: 25 })
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1) }
  return (
    <>
      <PageHeader title="Audit Logs & Activity Tracking" icon={ScrollText} subtitle="Immutable record of user actions and data changes" />
      {stats && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Events (14d)" value={stats.daily.reduce((a, d) => a + d.events, 0)} icon={History} />
            <StatCard label="Data changes" value={stats.changes} tone="amber" sub="create · update · delete" />
            <StatCard label="Failed logins" value={stats.failed_logins} icon={ShieldAlert} tone="red" />
            <StatCard label="Active users" value={stats.top_users.length} icon={Users} tone="green" />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card title="Events per day" className="lg:col-span-2"><BarsChart data={stats.daily.map((d) => ({ ...d, date: d.date.slice(5) }))} x="date" height={200} bars={[{ key: 'events', name: 'Events' }]} /></Card>
            <Card title="Most active users"><BarsChart data={stats.top_users} x="user" layout="vertical" height={200} bars={[{ key: 'events', name: 'Events', color: '#0ea5e9' }]} /></Card>
          </div>
        </>
      )}
      <Card className="mt-4" bodyClass="p-0">
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="w-56" placeholder="Search summary…" value={f.q} onChange={set('q')} />
          <Select className="w-auto" value={f.action} onChange={set('action')} placeholder="All actions" options={Object.keys(stats?.by_action || {}).sort()} />
          <Select className="w-auto" value={f.entity_type} onChange={set('entity_type')} placeholder="All entities" options={Object.keys(stats?.by_entity || {}).sort()} />
          <Input type="date" className="w-auto" value={f.date_from} onChange={set('date_from')} />
          <Input type="date" className="w-auto" value={f.date_to} onChange={set('date_to')} />
        </div>
        <DataTable loading={loading} rows={data?.items} page={data} onPage={setPage} dense onRowClick={(a) => Object.keys(a.changes || {}).length && setDetail(a)} columns={[
          { key: 'created_at', label: 'Time', render: (a) => <span className="whitespace-nowrap text-xs">{fmtDateTime(a.created_at)}</span> },
          { key: 'user', label: 'User', render: (a) => <div><p className="text-sm font-medium">{a.user}</p>{a.role && <p className="text-[11px] text-muted">{a.role}</p>}</div> },
          { key: 'action', label: 'Action', render: (a) => <Badge tone={TONE[a.action] || 'indigo'}>{a.action}</Badge> },
          { key: 'entity_type', label: 'Entity', render: (a) => <span className="text-xs">{titleCase(a.entity_type)}{a.entity_id ? ` #${a.entity_id}` : ''}</span> },
          { key: 'summary', label: 'Summary', render: (a) => <span className="text-sm">{a.summary}{Object.keys(a.changes || {}).length > 0 && <Badge tone="amber" className="ml-2">{Object.keys(a.changes).length} field(s)</Badge>}</span> },
          { key: 'ip_address', label: 'IP', render: (a) => <span className="font-mono text-[11px] text-muted">{a.ip_address || '—'}</span> }]} />
      </Card>
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Change details" subtitle={detail && `${detail.user} · ${fmtDateTime(detail.created_at)}`}>
        {detail && (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Field</th><th>Before</th><th>After</th></tr></thead>
            <tbody>{Object.entries(detail.changes).map(([k, [o, n]]) => (
              <tr key={k} className="border-t border-line"><td className="py-2 font-medium">{titleCase(k)}</td><td className="text-rose-500">{String(o ?? '—')}</td><td className="text-emerald-600">{String(n ?? '—')}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Modal>
    </>
  )
}
