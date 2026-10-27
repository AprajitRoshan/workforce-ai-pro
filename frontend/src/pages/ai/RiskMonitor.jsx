import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, Play, ShieldAlert, X } from 'lucide-react'
import api from '../../api/client'
import { BarsChart, DonutChart, Legendary, RISK_COLORS } from '../../components/charts'
import RiskPanel from '../../components/RiskPanel'
import {
  Avatar, Badge, Button, Card, DataTable, EmptyState, PageHeader, PageLoader, RiskBadge, Select, StatCard, StatusBadge, Tabs, cx,
  fmtDateTime, timeAgo, titleCase,
} from '../../components/ui'
import { useRealtime } from '../../context/RealtimeContext'
import { useToast } from '../../context/ToastContext'
import { invalidate, useApi } from '../../hooks/useApi'

export default function RiskMonitor() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState('overview')
  const [busy, setBusy] = useState(false)
  const selected = params.get('employee')
  const { data, reload } = useApi('/ai/risk/overview')
  const { subscribe } = useRealtime()
  useEffect(() => subscribe('notification', (n) => n.category === 'RISK' && reload()), [subscribe, reload])

  const runAll = async () => {
    setBusy(true)
    try {
      const r = await api.post('/ai/predict', {})
      toast.success('Predictions complete', `${r.data.scored} employees scored · ${r.data.level_changes} level changes · ${r.data.alerts} alerts`)
      invalidate('/ai'); invalidate('/employees'); reload()
    } catch (e) { toast.error('Prediction failed', e.message) } finally { setBusy(false) }
  }
  if (!data) return <PageLoader />
  const dist = Object.entries(data.distribution).map(([name, value]) => ({ name, value }))
  return (
    <>
      <PageHeader title="AI Risk Monitor" icon={ShieldAlert}
        subtitle={data.model ? `Model v${data.model.version} · ${data.model.algorithm} · AUC ${data.model.auc}` : 'No model trained yet'}
        actions={<Button icon={Play} loading={busy} onClick={runAll}>Run predictions</Button>} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Average risk" value={data.avg_risk !== null ? `${data.avg_risk}%` : '—'} />
        {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((l) => <StatCard key={l} label={`${titleCase(l)} risk`} value={data.distribution[l]} tone={{ CRITICAL: 'red', HIGH: 'red', MEDIUM: 'amber', LOW: 'green' }[l]} />)}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'department', label: 'By department' }, { value: 'all', label: 'All predictions' }, { value: 'logs', label: 'Risk change log' }]} />
      {tab === 'overview' && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title={`High-risk employees (${data.high_risk.length})`} subtitle="HIGH and CRITICAL — click to investigate" className="xl:col-span-2" bodyClass="p-0">
            <DataTable rows={data.high_risk} onRowClick={(e) => setParams({ employee: e.id })} empty={<EmptyState title="No high-risk employees" />} columns={[
              { key: 'full_name', label: 'Employee', render: (e) => <div className="flex items-center gap-2"><Avatar name={e.full_name} size="sm" /><div><p className="font-medium">{e.full_name}</p><p className="text-xs text-muted">{e.job_title} · {e.department}</p></div></div> },
              { key: 'risk', label: 'Risk', render: (e) => <RiskBadge level={e.risk_level} score={e.risk_score} /> },
              { key: 'confidence', label: 'Confidence', align: 'right', render: (e) => (e.confidence ? `${Math.round(e.confidence)}%` : '—') },
              { key: 'top_factor', label: 'Top driver', render: (e) => <span className="text-xs">{e.top_factor || '—'}</span> },
              { key: 'has_intervention', label: 'Action', render: (e) => (e.has_intervention ? <Badge tone="green">In progress</Badge> : <Badge tone="red">None</Badge>) }]} />
          </Card>
          <div className="space-y-4">
            <Card title="Distribution">
              <DonutChart data={dist} colors={RISK_COLORS} />
              <Legendary items={dist.map((d) => ({ label: titleCase(d.name), value: d.value, color: RISK_COLORS[d.name] }))} />
            </Card>
            <Card title="Most common risk drivers">
              <BarsChart data={data.top_factors.slice(0, 6)} x="factor" layout="vertical" height={220} bars={[{ key: 'employees', name: 'Employees', color: '#f43f5e' }]} />
            </Card>
          </div>
          <Card title="Risk score histogram" className="xl:col-span-3">
            <BarsChart data={data.histogram} x="range" height={200} bars={[{ key: 'count', name: 'Employees', cellColors: (d) => { const lo = parseInt(d.range, 10); return lo >= 70 ? '#9f1239' : lo >= 50 ? '#ef4444' : lo >= 20 ? '#f59e0b' : '#10b981' } }]} />
          </Card>
          <Movers onSelect={(id) => setParams({ employee: id })} />
        </div>
      )}
      {tab === 'department' && <DeptPredictions />}
      {tab === 'all' && <AllPredictions onSelect={(id) => setParams({ employee: id })} />}
      {tab === 'logs' && <RiskLogs />}

      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/40" onMouseDown={(e) => e.target === e.currentTarget && setParams({})}>
          <div className="animate-slide-in h-full w-full max-w-4xl overflow-y-auto bg-canvas p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <Link to={`/employees/${selected}`} className="text-sm font-semibold text-indigo-500 hover:underline">Open full profile →</Link>
              <button onClick={() => setParams({})} className="rounded-lg p-1.5 hover:bg-surface-2" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <RiskPanel employeeId={Number(selected)} />
          </div>
        </div>
      )}
    </>
  )
}

function Movers({ onSelect }) {
  const { data } = useApi('/ai/risk/movers', { limit: 8 })
  return (
    <Card title="Biggest risk changes" subtitle="Latest re-score vs previous" className="xl:col-span-3" bodyClass="p-0">
      <DataTable rows={data} onRowClick={(r) => onSelect(r.employee_id)} dense columns={[
        { key: 'employee', label: 'Employee', render: (r) => <div><p className="font-medium">{r.employee}</p><p className="text-xs text-muted">{r.department}</p></div> },
        { key: 'change', label: 'Change', render: (r) => <span className={cx('inline-flex items-center gap-1 font-semibold', r.change > 0 ? 'text-rose-500' : 'text-emerald-500')}>{r.change > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}{r.change > 0 ? '+' : ''}{r.change} pts</span> },
        { key: 'levels', label: 'Level', render: (r) => <span className="inline-flex items-center gap-1"><RiskBadge level={r.old_level} /> → <RiskBadge level={r.new_level} /></span> },
        { key: 'created_at', label: 'When', render: (r) => timeAgo(r.created_at) }]} />
    </Card>
  )
}

function DeptPredictions() {
  const { data, loading } = useApi('/ai/predictions/departments')
  return (
    <div className="space-y-4">
      <Card title="Department-level attrition prediction">
        <BarsChart data={data || []} x="department" height={260} stacked bars={[{ key: 'LOW', name: 'Low', color: RISK_COLORS.LOW }, { key: 'MEDIUM', name: 'Medium', color: RISK_COLORS.MEDIUM }, { key: 'HIGH', name: 'High', color: RISK_COLORS.HIGH }, { key: 'CRITICAL', name: 'Critical', color: RISK_COLORS.CRITICAL }]} />
      </Card>
      <Card bodyClass="p-0">
        <DataTable loading={loading} rows={data} rowKey="department_id" columns={[
          { key: 'department', label: 'Department', render: (d) => <b>{d.department}</b> }, { key: 'headcount', label: 'Scored', align: 'right' },
          { key: 'avg_risk', label: 'Avg risk', align: 'right', render: (d) => `${d.avg_risk}%` }, { key: 'max_risk', label: 'Max', align: 'right', render: (d) => `${d.max_risk}%` },
          { key: 'expected_leavers', label: 'Expected leavers (12m)', align: 'right', render: (d) => <b>{d.expected_leavers}</b> },
          { key: 'hc', label: 'High + critical', align: 'right', render: (d) => d.HIGH + d.CRITICAL }]} />
      </Card>
    </div>
  )
}

function AllPredictions({ onSelect }) {
  const [level, setLevel] = useState('')
  const [dept, setDept] = useState('')
  const [page, setPage] = useState(1)
  const { data: depts } = useApi('/departments')
  const { data, loading } = useApi('/ai/predictions', { risk_level: level || undefined, department_id: dept, page, size: 15 })
  return (
    <Card bodyClass="p-0">
      <div className="flex flex-wrap gap-2 border-b border-line p-3">
        <Select className="w-auto" value={level} onChange={(e) => { setLevel(e.target.value); setPage(1) }} placeholder="All risk levels" options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']} />
        <Select className="w-auto" value={dept} onChange={(e) => { setDept(e.target.value); setPage(1) }} placeholder="All departments" options={(depts || []).map((d) => ({ value: d.id, label: d.name }))} />
      </div>
      <DataTable loading={loading} rows={data?.items} page={data} onPage={setPage} onRowClick={(p) => onSelect(p.employee_id)} columns={[
        { key: 'employee', label: 'Employee', render: (p) => <div><p className="font-medium">{p.employee.full_name}</p><p className="text-xs text-muted">{p.employee.department}</p></div> },
        { key: 'risk', label: 'Risk', render: (p) => <RiskBadge level={p.risk_level} score={p.risk_score} /> },
        { key: 'confidence', label: 'Confidence', align: 'right', render: (p) => `${Math.round(p.confidence)}%` },
        { key: 'factors', label: 'Drivers', render: (p) => <div className="flex flex-wrap gap-1">{p.top_factors.slice(0, 2).map((f) => <Badge key={f.feature}>{f.label}</Badge>)}</div> },
        { key: 'created_at', label: 'Scored', render: (p) => timeAgo(p.created_at) }]} />
    </Card>
  )
}

function RiskLogs() {
  const [event, setEvent] = useState('')
  const [page, setPage] = useState(1)
  const { data, loading } = useApi('/ai/risk/logs', { event, page, size: 20 })
  return (
    <Card bodyClass="p-0" title="Monitoring log" subtitle="Every level change or ≥5-point move is recorded">
      <div className="border-b border-line p-3"><Select className="w-auto" value={event} onChange={(e) => { setEvent(e.target.value); setPage(1) }} placeholder="All events" options={['ESCALATED', 'DEESCALATED', 'NEW_HIGH_RISK', 'RESCORED']} /></div>
      <DataTable loading={loading} rows={data?.items} page={data} onPage={setPage} dense columns={[
        { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
        { key: 'employee', label: 'Employee', render: (r) => <div><p className="font-medium">{r.employee}</p><p className="text-xs text-muted">{r.department}</p></div> },
        { key: 'event', label: 'Event', render: (r) => <StatusBadge status={{ ESCALATED: 'HIGH', DEESCALATED: 'LOW', NEW_HIGH_RISK: 'CRITICAL', RESCORED: 'TODO' }[r.event]} label={titleCase(r.event)} /> },
        { key: 'scores', label: 'Score', render: (r) => <span className="tabular-nums">{r.old_score ?? '—'} → <b>{r.new_score}</b></span> },
        { key: 'change', label: 'Δ', align: 'right', render: (r) => <span className={r.change > 0 ? 'text-rose-500' : 'text-emerald-500'}>{r.change > 0 ? '+' : ''}{r.change}</span> },
        { key: 'levels', label: 'Level', render: (r) => <span className="inline-flex items-center gap-1">{r.old_level ? <RiskBadge level={r.old_level} /> : '—'} → <RiskBadge level={r.new_level} /></span> }]} />
    </Card>
  )
}
