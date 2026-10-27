import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Download, LogOut, Percent, TrendingDown, UserX } from 'lucide-react'
import { download } from '../../api/client'
import { BarsChart, DonutChart, Legendary, LinesChart, PALETTE } from '../../components/charts'
import { Button, Card, DataTable, PageHeader, PageLoader, Select, StatCard, StatusBadge, fmtDate } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { useApi } from '../../hooks/useApi'

export default function AttritionAnalytics() {
  const toast = useToast()
  const [dept, setDept] = useState('')
  const { data: depts } = useApi('/departments')
  const { data } = useApi('/analytics/attrition', { department_id: dept, months: 24 })
  if (!data) return <PageLoader />
  const s = data.summary
  const exp = (format) => download('/reports/attrition', { format, department_id: dept || undefined }).catch((e) => toast.error('Export failed', e.message))
  const breakdown = (rows) => <BarsChart data={rows} x="group" height={220} bars={[{ key: 'attrition_rate', name: 'Attrition %', color: '#f43f5e' }]} formatter={(v) => `${v}%`} />
  return (
    <>
      <PageHeader title="Attrition Analytics" icon={TrendingDown} subtitle="Turnover statistics, trends and department-wise analysis"
        actions={<>
          <Select className="w-auto" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="All departments" options={(depts || []).map((d) => ({ value: d.id, label: d.name }))} />
          <Button variant="secondary" icon={Download} onClick={() => exp('pdf')}>PDF</Button>
          <Button variant="secondary" icon={Download} onClick={() => exp('xlsx')}>Excel</Button>
        </>} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Attrition rate (12m)" value={`${s.attrition_rate_12m}%`} icon={Percent} tone="red" />
        <StatCard label="Exits (12m)" value={s.exits_12m} icon={LogOut} tone="amber" sub={`${s.voluntary_12m} voluntary · ${s.involuntary_12m} involuntary`} />
        <StatCard label="Avg tenure of leavers" value={s.avg_tenure_leavers ? `${s.avg_tenure_leavers}y` : '—'} icon={Clock} />
        <StatCard label="Early exits (<1y)" value={s.early_exits_12m} icon={UserX} tone="purple" />
        <StatCard label="Currently at risk" value={s.at_risk} tone="red" sub={`of ${s.active} active`} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Turnover analytics — 24 months" subtitle="Monthly exits, hires and turnover rate" className="xl:col-span-2">
          <BarsChart data={data.turnover} x="month" height={260} bars={[{ key: 'hires', name: 'Hires', color: '#10b981' }, { key: 'exits', name: 'Exits', color: '#ef4444' }, { key: 'voluntary_exits', name: 'Voluntary', color: '#f59e0b' }]} />
        </Card>
        <Card title="Exit reasons">
          <DonutChart data={data.exit_reasons.map((r) => ({ name: r.reason, value: r.count }))} />
          <Legendary items={data.exit_reasons.map((r, i) => ({ label: r.reason, value: r.count, color: PALETTE[i % PALETTE.length] }))} />
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Headcount trend"><LinesChart data={data.turnover} x="month" area height={220} lines={[{ key: 'headcount', name: 'Headcount' }]} /></Card>
        <Card title="Average predicted risk over time" subtitle="Employee trend report across scoring runs">
          <LinesChart data={data.risk_trend} x="date" height={220} lines={[{ key: 'avg_risk', name: 'Avg risk %', color: '#ef4444' }]} />
        </Card>
      </div>
      <Card title="Department-wise analysis" className="mt-4" bodyClass="p-0">
        <DataTable rows={data.by_department} rowKey="group" columns={[
          { key: 'group', label: 'Department', render: (r) => <b>{r.group}</b> }, { key: 'employees', label: 'Employees (incl. leavers)', align: 'right' },
          { key: 'exits', label: 'Exits 12m', align: 'right' },
          { key: 'attrition_rate', label: 'Attrition rate', align: 'right', render: (r) => <span className={r.attrition_rate > 15 ? 'font-semibold text-rose-500' : ''}>{r.attrition_rate}%</span> },
          { key: 'avg_risk', label: 'Avg current risk', align: 'right', render: (r) => (r.avg_risk !== null ? `${r.avg_risk}%` : '—') }]} />
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="By tenure">{breakdown(data.by_tenure)}</Card>
        <Card title="By job level">{breakdown(data.by_job_level)}</Card>
        <Card title="By salary band">{breakdown(data.by_salary_band)}</Card>
      </div>
      <Card title="Recent leavers" className="mt-4" bodyClass="p-0">
        <DataTable rows={data.recent_leavers} columns={[
          { key: 'full_name', label: 'Employee', render: (e) => <Link to={`/employees/${e.id}`} className="font-medium hover:text-indigo-500">{e.full_name}</Link> },
          { key: 'department', label: 'Department' }, { key: 'job_title', label: 'Role' }, { key: 'status', label: 'Type', render: (e) => <StatusBadge status={e.status} /> },
          { key: 'termination_date', label: 'Left on', render: (e) => fmtDate(e.termination_date) }, { key: 'tenure', label: 'Tenure', align: 'right', render: (e) => `${e.tenure}y` },
          { key: 'reason', label: 'Reason' }]} />
      </Card>
    </>
  )
}
