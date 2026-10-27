import { Link } from 'react-router-dom'
import {
  Activity, AlertTriangle, CalendarClock, CalendarDays, HeartHandshake, ListChecks, ShieldAlert, Target, UserMinus, UserPlus,
  Users, Wallet,
} from 'lucide-react'
import { BarsChart, DonutChart, Legendary, LinesChart, RISK_COLORS } from '../components/charts'
import CheckInCard from '../components/CheckInCard'
import {
  Badge, Card, EmptyState, ErrorState, PageHeader, PageLoader, ProgressBar, StatCard, StatusBadge, fmtDate, fmtMoney, fmtNum,
  timeAgo, titleCase,
} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useApi } from '../hooks/useApi'

export default function Dashboard() {
  const { user } = useAuth()
  const { data, loading, error, reload } = useApi('/dashboard')
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <PageLoader />
  return data.role === 'EMPLOYEE' ? <EmployeeDashboard data={data} user={user} reload={reload} /> : <ManagementDashboard data={data} user={user} loading={loading} />
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function ManagementDashboard({ data, user, loading }) {
  const { employees, attendance, payroll, departments, risk } = data
  const riskData = Object.entries(risk).map(([name, value]) => ({ name, value }))
  const atRisk = (risk.HIGH || 0) + (risk.CRITICAL || 0)
  return (
    <>
      <PageHeader title={`${greeting()}, ${user.full_name.split(' ')[0]}`}
        subtitle={user.role === 'MANAGER' ? 'Here is how your team is doing today.' : 'Here is your workforce at a glance.'} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Active employees" value={fmtNum(employees.active)} icon={Users} loading={loading}
          sub={<><UserPlus className="inline h-3 w-3" /> {employees.new_hires_30d} joined · <UserMinus className="inline h-3 w-3" /> {employees.exits_30d} left (30d)</>} />
        <StatCard label="Present today" value={`${attendance.rate_today}%`} icon={Activity} tone="green" sub={`${attendance.checked_in} checked in`} />
        <StatCard label="At-risk employees" value={atRisk} icon={ShieldAlert} tone="red" sub={`${risk.CRITICAL || 0} critical`} />
        <StatCard label="Pending leaves" value={data.pending_leaves} icon={CalendarDays} tone="amber" sub="awaiting approval" />
        <StatCard label="Open interventions" value={data.open_interventions} icon={HeartHandshake} tone="purple" sub="retention actions" />
        {payroll
          ? <StatCard label={`Net payroll · ${payroll.period}`} value={fmtMoney(payroll.net / 100000, 1) + 'L'} icon={Wallet} tone="blue" sub={`${payroll.payslips} payslips`} />
          : <StatCard label="Open tasks" value={data.open_tasks} icon={ListChecks} tone="blue" sub={`${data.overdue_tasks} overdue`} />}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Attendance — last 14 working days" subtitle="Daily status breakdown" className="xl:col-span-2">
          <BarsChart data={attendance.trend} x="date" stacked height={260} bars={[
            { key: 'present', name: 'Present', color: '#10b981' }, { key: 'late', name: 'Late', color: '#f59e0b' },
            { key: 'on_leave', name: 'On leave', color: '#8b5cf6' }, { key: 'absent', name: 'Absent', color: '#ef4444' }]} />
        </Card>
        <Card title="Attrition risk distribution" subtitle="Latest AI scoring" actions={<Link to="/ai/risk" className="text-xs font-semibold text-indigo-500 hover:underline">Open monitor →</Link>}>
          <DonutChart data={riskData} colors={RISK_COLORS} center={atRisk} centerLabel="at risk" />
          <Legendary items={riskData.map((r) => ({ label: titleCase(r.name), value: r.value, color: RISK_COLORS[r.name] }))} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Department analytics" subtitle="Headcount and average attrition risk" className="xl:col-span-2">
          <BarsChart data={departments} x="department" height={260} bars={[{ key: 'headcount', name: 'Headcount' }, { key: 'avg_risk', name: 'Avg risk %', color: '#f43f5e' }]} />
        </Card>
        {payroll ? (
          <Card title="Payroll overview" subtitle="Net pay by month">
            <LinesChart data={payroll.trend} x="period" area height={180} lines={[{ key: 'net', name: 'Net pay' }]} formatter={(v) => `₹${(v / 100000).toFixed(1)}L`} />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-surface-2 p-2"><p className="text-muted">Gross</p><p className="font-semibold">{fmtMoney(payroll.gross)}</p></div>
              <div className="rounded-lg bg-surface-2 p-2"><p className="text-muted">Tax</p><p className="font-semibold">{fmtMoney(payroll.tax)}</p></div>
              <div className="rounded-lg bg-surface-2 p-2"><p className="text-muted">Net</p><p className="font-semibold">{fmtMoney(payroll.net)}</p></div>
            </div>
          </Card>
        ) : (
          <Card title="Employee status">
            <div className="space-y-3">
              {Object.entries(employees.by_status).map(([s, c]) => (
                <div key={s} className="flex items-center justify-between text-sm"><StatusBadge status={s} /><span className="font-semibold">{c}</span></div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {data.recent_activity.length > 0 && (
        <Card title="Recent activity" className="mt-4" actions={<Link to="/audit" className="text-xs font-semibold text-indigo-500 hover:underline">Audit log →</Link>} bodyClass="p-0">
          <ul className="divide-y divide-line">
            {data.recent_activity.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Badge tone="indigo">{a.action}</Badge>
                <span className="min-w-0 flex-1 truncate">{a.summary}</span>
                <span className="shrink-0 text-xs text-muted">{timeAgo(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function EmployeeDashboard({ data, user, reload }) {
  if (!data.linked) {
    return (
      <>
        <PageHeader title={`${greeting()}, ${user.full_name.split(' ')[0]}`} />
        <Card><EmptyState icon={AlertTriangle} title="Your account is not linked to an employee record yet"
          description="Ask HR to link your account. Once linked you'll see attendance, leave and payroll here." /></Card>
      </>
    )
  }
  const { attendance } = data
  return (
    <>
      <PageHeader title={`${greeting()}, ${user.full_name.split(' ')[0]}`} subtitle={`${data.employee.job_title} · ${data.employee.department}`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1"><CheckInCard onChange={reload} /></div>
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <StatCard label="Attendance (30d)" value={attendance.rate_30d !== null ? `${attendance.rate_30d}%` : '—'} icon={Activity} tone="green" sub={`${attendance.late_30d} late arrivals`} />
          <StatCard label="Hours worked (30d)" value={fmtNum(attendance.hours_30d)} icon={CalendarClock} sub={`${attendance.overtime_30d}h overtime`} />
          <StatCard label="Open tasks" value={data.tasks.length} icon={ListChecks} tone="amber" sub={`${data.tasks.filter((t) => t.overdue).length} overdue`} />
          <StatCard label="Unread notifications" value={data.unread_notifications} icon={AlertTriangle} tone="purple" />
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Leave balance" actions={<Link to="/leaves" className="text-xs font-semibold text-indigo-500 hover:underline">Apply →</Link>}>
          <div className="space-y-3">
            {data.leave_balance.filter((b) => b.leave_type !== 'UNPAID').map((b) => (
              <div key={b.leave_type}>
                <div className="mb-1 flex justify-between text-xs"><span className="font-medium">{titleCase(b.leave_type)}</span><span className="text-muted">{b.remaining} of {b.entitled} left</span></div>
                <ProgressBar value={(b.remaining / (b.entitled || 1)) * 100} tone={b.remaining / (b.entitled || 1) < 0.25 ? 'amber' : 'green'} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Daily hours — last 14 days" className="lg:col-span-2">
          <BarsChart data={attendance.trend} x="date" height={200} bars={[{ key: 'hours', name: 'Hours', cellColors: (d) => (d.hours > 9.5 ? '#f59e0b' : '#6366f1') }]} />
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="My tasks" actions={<Link to="/tasks" className="text-xs font-semibold text-indigo-500 hover:underline">All tasks →</Link>} bodyClass="p-0">
          {data.tasks.length ? (
            <ul className="divide-y divide-line">
              {data.tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="truncate">{t.title}</span>
                  {t.overdue ? <Badge tone="red">Overdue</Badge> : <span className="text-xs text-muted">{fmtDate(t.due_date)}</span>}
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No open tasks" />}
        </Card>
        <Card title="Goals" actions={<Link to="/performance" className="text-xs font-semibold text-indigo-500 hover:underline">Manage →</Link>}>
          {data.goals.length ? data.goals.map((g) => (
            <div key={g.id} className="mb-3 last:mb-0">
              <div className="mb-1 flex justify-between text-xs"><span className="font-medium">{g.title}</span><span className="text-muted">{g.progress}%</span></div>
              <ProgressBar value={g.progress} />
            </div>
          )) : <EmptyState icon={Target} title="No active goals" />}
        </Card>
        <Card title="Recent payslips" actions={<Link to="/payroll" className="text-xs font-semibold text-indigo-500 hover:underline">View →</Link>}>
          {data.payroll.length ? <LinesChart data={data.payroll} x="period" height={170} lines={[{ key: 'net', name: 'Net' }]} formatter={(v) => `₹${Math.round(v / 1000)}k`} />
            : <EmptyState icon={Wallet} title="No payslips yet" />}
        </Card>
      </div>
    </>
  )
}
