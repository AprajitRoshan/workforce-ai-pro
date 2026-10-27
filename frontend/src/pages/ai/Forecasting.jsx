import { useState } from 'react'
import { Area, ComposedChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Gauge, ShieldCheck, TrendingUp, Users } from 'lucide-react'
import { BarsChart } from '../../components/charts'
import { Card, DataTable, PageHeader, PageLoader, ProgressBar, Select, StatCard, StatusBadge, fmtNum } from '../../components/ui'
import { useApi } from '../../hooks/useApi'

export default function Forecasting() {
  const [dept, setDept] = useState('')
  const [horizon, setHorizon] = useState(12)
  const { data: depts } = useApi('/departments')
  const { data: fc } = useApi('/forecast', { horizon, department_id: dept })
  const { data: st } = useApi('/stability')
  if (!fc || !st) return <PageLoader />

  const series = [
    ...fc.history.slice(-12).map((h) => ({ month: h.month, actual: h.headcount })),
    ...fc.forecast.map((f) => ({ month: f.month, forecast: f.headcount, band: [f.lower, f.upper], baseline: f.baseline_headcount })),
  ]
  if (fc.history.length) series[11] = { ...series[11], forecast: series[11].actual, baseline: series[11].actual, band: [series[11].actual, series[11].actual] }

  return (
    <>
      <PageHeader title="Workforce Forecasting & Stability" icon={TrendingUp} subtitle="AI-driven headcount, retention and department stability projections"
        actions={<>
          <Select className="w-auto" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="Whole company" options={(depts || []).map((d) => ({ value: d.id, label: d.name }))} />
          <Select className="w-auto" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} options={[6, 12, 18, 24].map((h) => ({ value: h, label: `${h} months` }))} />
        </>} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Current headcount" value={fc.current_headcount} icon={Users} />
        <StatCard label="Expected leavers (12m)" value={fc.expected_leavers_12m} tone="red" sub={`historical ${fc.historical_monthly_attrition}% / month`} />
        <StatCard label="Retention forecast (12m)" value={`${fc.retention_rate_12m}%`} icon={ShieldCheck} tone="green" />
        <StatCard label="Projected growth" value={`${fc.growth_rate_12m > 0 ? '+' : ''}${fc.growth_rate_12m}%`} tone={fc.growth_rate_12m >= 0 ? 'green' : 'red'} sub={`over ${horizon} months`} />
      </div>

      <Card title="Monthly headcount forecast" subtitle="AI forecast uses each employee's risk score; shaded = 95% interval; dashed = historical-rate baseline" className="mt-4">
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#8a94a633" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#8a94a6', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#8a94a6', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
              <Area dataKey="band" name="95% interval" fill="#6366f1" fillOpacity={0.12} stroke="none" />
              <Line dataKey="actual" name="Actual" stroke="#64748b" strokeWidth={2} dot={false} />
              <Line dataKey="forecast" name="AI forecast" stroke="#6366f1" strokeWidth={2.5} dot={false} />
              <Line dataKey="baseline" name="Baseline" stroke="#f59e0b" strokeDasharray="5 4" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Yearly workforce prediction" bodyClass="p-0">
          <DataTable rows={fc.yearly} rowKey="year" columns={[
            { key: 'year', label: 'Year', render: (y) => <b>{y.year}</b> }, { key: 'projected_headcount', label: 'Headcount', align: 'right' },
            { key: 'expected_leavers', label: 'Leavers', align: 'right' }, { key: 'expected_hires', label: 'Hires', align: 'right' }]} />
        </Card>
        <Card title="Expected exits vs hires per month" className="lg:col-span-2">
          <BarsChart data={fc.forecast} x="month" height={220} bars={[{ key: 'expected_exits', name: 'Expected exits', color: '#ef4444' }, { key: 'expected_hires', name: 'Expected hires', color: '#10b981' }]} formatter={(v) => fmtNum(v, 1)} />
        </Card>
      </div>

      <div className="mt-6 mb-3 flex items-center gap-2"><Gauge className="h-5 w-5 text-indigo-500" /><h2 className="text-lg font-bold">Workforce stability engine</h2></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Overall stability score">
          <div className="flex flex-col items-center py-4">
            <p className="text-5xl font-bold">{st.overall_score}</p>
            <p className="text-sm text-muted">out of 100</p>
            <ProgressBar className="mt-4" value={st.overall_score} tone={st.overall_score >= 70 ? 'green' : st.overall_score >= 55 ? 'amber' : 'red'} />
            <p className="mt-3 text-center text-xs text-muted">Weighted by headcount from average risk (45%), 12-month turnover (35%) and share of high-risk staff (20%).</p>
          </div>
        </Card>
        <Card title="Workforce growth prediction (12m)" className="lg:col-span-2">
          <BarsChart data={st.growth} x="department" height={240} bars={[{ key: 'current', name: 'Current', color: '#94a3b8' }, { key: 'projected_12m', name: 'Projected', color: '#6366f1' }]} />
        </Card>
      </div>
      <Card title="Department stability scoring" className="mt-4" bodyClass="p-0">
        <DataTable rows={st.departments} rowKey="department_id" columns={[
          { key: 'department', label: 'Department', render: (d) => <b>{d.department}</b> },
          { key: 'stability_score', label: 'Stability', render: (d) => <div className="flex w-40 items-center gap-2"><ProgressBar value={d.stability_score} tone={d.status === 'STABLE' ? 'green' : d.status === 'WATCH' ? 'amber' : 'red'} /><span className="w-10 text-right text-sm font-semibold">{d.stability_score}</span></div> },
          { key: 'status', label: 'Status', render: (d) => <StatusBadge status={d.status} /> }, { key: 'headcount', label: 'Headcount', align: 'right' },
          { key: 'avg_risk', label: 'Avg risk', align: 'right', render: (d) => `${d.avg_risk}%` }, { key: 'turnover_12m', label: 'Turnover 12m', align: 'right', render: (d) => `${d.turnover_12m}%` },
          { key: 'high_risk_share', label: 'High-risk share', align: 'right', render: (d) => `${d.high_risk_share}%` },
          { key: 'retention_forecast_12m', label: 'Retention forecast', align: 'right', render: (d) => <b>{d.retention_forecast_12m}%</b> }]} />
      </Card>
    </>
  )
}
