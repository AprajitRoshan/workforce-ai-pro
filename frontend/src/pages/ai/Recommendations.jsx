import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, HeartHandshake, Lightbulb, Sparkles, Users } from 'lucide-react'
import { InterventionModal } from '../../components/RiskPanel'
import { Avatar, Badge, Button, Card, DataTable, EmptyState, PageHeader, PageLoader, RiskBadge, Tabs, cx, titleCase } from '../../components/ui'
import { useApi } from '../../hooks/useApi'

const SEV = { HIGH: 'border-l-rose-500', MEDIUM: 'border-l-amber-500', LOW: 'border-l-emerald-500' }

export default function Recommendations() {
  const { data, reload } = useApi('/ai/recommendations')
  const [tab, setTab] = useState('employees')
  const [plan, setPlan] = useState(null)
  if (!data) return <PageLoader />
  return (
    <>
      <PageHeader title="AI Recommendation Engine" icon={Sparkles} subtitle="Employee improvement suggestions, workforce optimisation tips and team insights" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'employees', label: 'Employee suggestions', icon: Users, count: data.employees.length },
        { value: 'tips', label: 'Optimisation tips', icon: Lightbulb, count: data.optimization_tips.length }, { value: 'teams', label: 'Team & department insights', icon: Building2 }]} />
      {tab === 'employees' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {!data.employees.length && <Card><EmptyState title="No at-risk employees need action" /></Card>}
          {data.employees.map(({ employee: e, recommendations }) => (
            <Card key={e.id}>
              <div className="flex items-center gap-3">
                <Avatar name={e.full_name} />
                <div className="min-w-0 flex-1">
                  <Link to={`/employees/${e.id}`} className="font-semibold hover:text-indigo-500">{e.full_name}</Link>
                  <p className="text-xs text-muted">{e.job_title} · {e.department}</p>
                </div>
                <RiskBadge level={e.risk_level} score={e.risk_score} />
              </div>
              <ul className="mt-3 space-y-2">
                {recommendations.slice(0, 3).map((r) => (
                  <li key={r.action_type} className="flex items-start gap-2 rounded-lg bg-surface-2 p-2.5">
                    <Badge tone={r.priority === 'HIGH' ? 'red' : r.priority === 'MEDIUM' ? 'amber' : 'gray'}>{titleCase(r.action_type)}</Badge>
                    <p className="flex-1 text-xs">{r.recommendation}<span className="block text-muted">Driver: {r.factor} (+{r.impact} pts)</span></p>
                    <Button size="sm" variant="ghost" icon={HeartHandshake} onClick={() => setPlan({ id: e.id, preset: r })} aria-label="Plan intervention" />
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {tab === 'tips' && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.optimization_tips.map((t, i) => (
            <div key={i} className={cx('card border-l-4 p-4', SEV[t.severity])}>
              <div className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-500" /><p className="font-semibold">{t.area}</p><Badge tone={t.severity === 'HIGH' ? 'red' : t.severity === 'MEDIUM' ? 'amber' : 'green'}>{t.severity}</Badge></div>
              <p className="mt-2 text-sm text-muted">{t.tip}</p>
            </div>
          ))}
        </div>
      )}
      {tab === 'teams' && (
        <>
          <Card bodyClass="p-0" title="Team performance insights">
            <DataTable rows={data.departments} rowKey="department_id" columns={[
              { key: 'department', label: 'Department', render: (d) => <b>{d.department}</b> }, { key: 'headcount', label: 'Headcount', align: 'right' },
              { key: 'avg_rating', label: 'Avg rating', align: 'right', render: (d) => d.avg_rating ?? '—' },
              { key: 'attendance_rate', label: 'Attendance', align: 'right', render: (d) => `${d.attendance_rate}%` },
              { key: 'avg_daily_overtime', label: 'OT / day', align: 'right', render: (d) => `${d.avg_daily_overtime}h` },
              { key: 'task_completion', label: 'Task completion', align: 'right', render: (d) => (d.task_completion !== null ? `${d.task_completion}%` : '—') },
              { key: 'avg_risk', label: 'Avg risk', align: 'right', render: (d) => `${d.avg_risk}%` }]} />
          </Card>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.departments.map((d) => (
              <Card key={d.department_id} title={d.department} subtitle="Top attrition drivers & recommended actions">
                {d.top_drivers.length ? d.top_drivers.map((r) => (
                  <div key={r.driver} className="mb-3 last:mb-0">
                    <p className="text-sm font-medium">{r.driver} <span className="text-xs font-normal text-muted">· {r.affected} employees</span></p>
                    <p className="text-xs text-muted">{r.recommendation}</p>
                  </div>
                )) : <p className="text-sm text-muted">No dominant drivers.</p>}
              </Card>
            ))}
          </div>
        </>
      )}
      <InterventionModal open={!!plan} employeeId={plan?.id} preset={plan?.preset} onClose={() => setPlan(null)} onSaved={reload} />
    </>
  )
}
