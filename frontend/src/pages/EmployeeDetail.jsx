import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, GitBranch, Mail, Pencil, Phone, Trash2 } from 'lucide-react'
import api, { download } from '../api/client'
import EmployeeForm from '../components/EmployeeForm'
import RiskPanel from '../components/RiskPanel'
import {
  Avatar, Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, KeyValue, Modal, PageLoader, ProgressBar, RiskBadge,
  Select, StatCard, StatusBadge, Tabs, fmtDate, fmtDateTime, fmtMoney, fmtTime, titleCase,
} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { invalidate, useApi } from '../hooks/useApi'

const SAT = ['', 'Low', 'Medium', 'High', 'Very high']

export default function EmployeeDetail() {
  const { id } = useParams()
  const { user, isHR } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const [tab, setTab] = useState('overview')
  const [edit, setEdit] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [workflow, setWorkflow] = useState(null)
  const { data: e, error, reload } = useApi(`/employees/${id}`)

  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!e) return <PageLoader />
  const s = e.summary

  const del = async () => {
    try { await api.delete(`/employees/${id}`); invalidate('/employees'); toast.success('Employee deleted'); nav('/employees') }
    catch (err) { toast.error('Delete failed', err.message) }
  }
  const startWorkflow = async () => {
    try {
      const r = await api.post('/tasks/workflow', null, { params: { employee_id: id, workflow } })
      toast.success('Workflow started', `${r.data.created} tasks created`)
      setWorkflow(null)
    } catch (err) { toast.error('Could not start workflow', err.message) }
  }

  return (
    <>
      <Link to="/employees" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Employees</Link>
      <div className="card mb-4 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={e.full_name} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold">{e.full_name}</h1>
              <StatusBadge status={e.status} />
              <RiskBadge level={e.risk_level} score={e.risk_score} />
            </div>
            <p className="text-sm text-muted">{e.job_title || 'No role'} · {e.department || 'No department'} · <span className="font-mono">{e.employee_code}</span></p>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{e.email}</span>
              {e.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{e.phone}</span>}
              {e.manager && <span>Reports to <Link className="font-medium text-indigo-500 hover:underline" to={`/employees/${e.manager_id}`}>{e.manager}</Link></span>}
            </div>
          </div>
          {isHR && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={GitBranch} onClick={() => setWorkflow('ONBOARDING')}>Workflow</Button>
              <Button variant="secondary" icon={Pencil} onClick={() => setEdit(true)}>Edit</Button>
              {user.role === 'ADMIN' && <Button variant="danger" icon={Trash2} onClick={() => setConfirmDel(true)}>Delete</Button>}
            </div>
          )}
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Overview' }, { value: 'risk', label: 'AI Risk' }, { value: 'attendance', label: 'Attendance' },
        { value: 'leave', label: 'Leave' }, isHR && { value: 'payroll', label: 'Payroll' }, isHR && { value: 'documents', label: 'Documents' },
        { value: 'performance', label: 'Performance' }, isHR && { value: 'history', label: 'Change history' },
      ]} />

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Attendance (30d)" value={s.attendance_rate_30d !== null ? `${s.attendance_rate_30d}%` : '—'} tone="green" sub={`${s.late_days_30d} late days`} />
            <StatCard label="Overtime (30d)" value={`${s.overtime_30d}h`} tone="amber" sub={`${s.hours_30d}h worked`} />
            <StatCard label="Avg review rating" value={s.avg_rating || '—'} tone="purple" sub={`${s.active_goals} active goals`} />
            <StatCard label="Tenure" value={`${e.tenure_years}y`} tone="blue" sub={`since ${fmtDate(e.hire_date)}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Profile" className="lg:col-span-2">
              <KeyValue items={[['Gender', e.gender], ['Date of birth', fmtDate(e.date_of_birth)], ['Marital status', e.marital_status],
                ['Education level', e.education], ['Address', e.address], ['Hire date', fmtDate(e.hire_date)], ['Monthly CTC', fmtMoney(e.salary)],
                ['Job level', e.job_level ? `L${e.job_level}` : null], ['Direct reports', s.direct_reports], ['Open tasks', s.open_tasks],
                ['Documents', s.documents], ['Last net pay', fmtMoney(s.last_net_pay)],
                e.termination_date && ['Left on', fmtDate(e.termination_date)], e.termination_reason && ['Exit reason', e.termination_reason]]} />
            </Card>
            <Card title="Engagement signals" subtitle="Inputs to the attrition model">
              <div className="space-y-3">
                {[['Job satisfaction', e.job_satisfaction], ['Environment', e.environment_satisfaction], ['Work-life balance', e.work_life_balance], ['Involvement', e.job_involvement]].map(([k, v]) => (
                  <div key={k}>
                    <div className="mb-1 flex justify-between text-xs"><span>{k}</span><span className="text-muted">{SAT[v]}</span></div>
                    <ProgressBar value={(v / 4) * 100} tone={v <= 1 ? 'red' : v === 2 ? 'amber' : 'green'} />
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                  <div className="rounded-lg bg-surface-2 p-2"><p className="text-muted">Since promotion</p><p className="font-semibold">{e.years_since_last_promotion} yrs</p></div>
                  <div className="rounded-lg bg-surface-2 p-2"><p className="text-muted">Trainings / yr</p><p className="font-semibold">{e.training_times_last_year}</p></div>
                  <div className="rounded-lg bg-surface-2 p-2"><p className="text-muted">Commute</p><p className="font-semibold">{e.distance_from_home} km</p></div>
                  <div className="rounded-lg bg-surface-2 p-2"><p className="text-muted">Stock options</p><p className="font-semibold">Level {e.stock_option_level}</p></div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
      {tab === 'risk' && <RiskPanel employeeId={Number(id)} />}
      {tab === 'attendance' && <EmployeeAttendance id={id} />}
      {tab === 'leave' && <EmployeeLeave id={id} />}
      {tab === 'payroll' && <EmployeePayroll id={id} />}
      {tab === 'documents' && <EmployeeDocs id={id} />}
      {tab === 'performance' && <EmployeePerformance id={id} />}
      {tab === 'history' && <EmployeeHistory id={id} />}

      <EmployeeForm open={edit} onClose={() => setEdit(false)} employee={e} onSaved={() => { invalidate('/employees'); reload() }} />
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} danger title="Delete employee?" confirmLabel="Delete permanently"
        message={`This permanently removes ${e.full_name} and all their attendance, leave, payroll and documents. Prefer setting status to Resigned/Terminated to keep history.`} onConfirm={del} />
      <Modal open={!!workflow} onClose={() => setWorkflow(null)} title="Start HR workflow" size="sm"
        footer={<><Button variant="secondary" onClick={() => setWorkflow(null)}>Cancel</Button><Button onClick={startWorkflow}>Start</Button></>}>
        <Select value={workflow || ''} onChange={(ev) => setWorkflow(ev.target.value)} options={['ONBOARDING', 'OFFBOARDING', 'REVIEW', 'RETENTION']} />
        <p className="mt-2 text-xs text-muted">Creates a checklist of tasks with due dates, assigned to the employee's manager.</p>
      </Modal>
    </>
  )
}

function EmployeeAttendance({ id }) {
  const [page, setPage] = useState(1)
  const { data, loading } = useApi('/attendance', { employee_id: id, page, size: 15 })
  return (
    <Card bodyClass="p-0">
      <DataTable loading={loading} rows={data?.items} page={data} onPage={setPage} columns={[
        { key: 'date', label: 'Date', render: (a) => fmtDate(a.date) }, { key: 'status', label: 'Status', render: (a) => <StatusBadge status={a.status} /> },
        { key: 'check_in', label: 'In', render: (a) => fmtTime(a.check_in) }, { key: 'check_out', label: 'Out', render: (a) => fmtTime(a.check_out) },
        { key: 'hours_worked', label: 'Hours', align: 'right' }, { key: 'overtime_hours', label: 'Overtime', align: 'right' }]} />
    </Card>
  )
}

function EmployeeLeave({ id }) {
  const { data: bal } = useApi('/leaves/balance', { employee_id: id })
  const { data, loading } = useApi('/leaves', { scope: 'all', employee_id: id, size: 50 })
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {(bal || []).map((b) => <StatCard key={b.leave_type} label={titleCase(b.leave_type)} value={b.remaining ?? `${b.used}d`} sub={b.remaining !== null ? `of ${b.entitled} · ${b.pending} pending` : 'days taken'} tone="purple" />)}
      </div>
      <Card bodyClass="p-0">
        <DataTable loading={loading} rows={data?.items} columns={[
          { key: 'leave_type', label: 'Type', render: (l) => titleCase(l.leave_type) }, { key: 'start_date', label: 'From', render: (l) => fmtDate(l.start_date) },
          { key: 'end_date', label: 'To', render: (l) => fmtDate(l.end_date) }, { key: 'days', label: 'Days', align: 'right' },
          { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status', render: (l) => <StatusBadge status={l.status} /> }]} />
      </Card>
    </div>
  )
}

function EmployeePayroll({ id }) {
  const toast = useToast()
  const { data, loading } = useApi('/payroll', { employee_id: id, size: 24 })
  return (
    <Card bodyClass="p-0">
      <DataTable loading={loading} rows={data?.items} columns={[
        { key: 'period', label: 'Period' }, { key: 'gross', label: 'Gross', align: 'right', render: (p) => fmtMoney(p.gross) },
        { key: 'tax', label: 'Tax', align: 'right', render: (p) => fmtMoney(p.tax) }, { key: 'net', label: 'Net', align: 'right', render: (p) => <b>{fmtMoney(p.net)}</b> },
        { key: 'status', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
        { key: 'pdf', label: '', render: (p) => <Button size="sm" variant="ghost" icon={Download} onClick={() => download(`/payroll/${p.id}/pdf`).catch((e) => toast.error('Download failed', e.message))}>PDF</Button> }]} />
    </Card>
  )
}

function EmployeeDocs({ id }) {
  const toast = useToast()
  const { data, loading } = useApi('/documents', { employee_id: id, size: 50 })
  return (
    <Card bodyClass="p-0" title="Documents" actions={<Link to="/documents" className="text-xs font-semibold text-indigo-500 hover:underline">Upload in Documents →</Link>}>
      <DataTable loading={loading} rows={data?.items} empty={<EmptyState title="No documents" />} columns={[
        { key: 'title', label: 'Title' }, { key: 'doc_type', label: 'Type', render: (d) => <Badge>{titleCase(d.doc_type)}</Badge> },
        { key: 'size', label: 'Size', render: (d) => `${(d.size / 1024).toFixed(1)} KB` }, { key: 'created_at', label: 'Uploaded', render: (d) => fmtDate(d.created_at) },
        { key: 'dl', label: '', render: (d) => <Button size="sm" variant="ghost" icon={Download} onClick={() => download(`/documents/${d.id}/download`, null, d.original_name).catch((e) => toast.error('Download failed', e.message))} /> }]} />
    </Card>
  )
}

function EmployeePerformance({ id }) {
  const { data: reviews, loading } = useApi('/reviews', { employee_id: id, size: 20 })
  const { data: goals } = useApi('/goals', { employee_id: id })
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Review history" className="lg:col-span-2" bodyClass="p-0">
        <DataTable loading={loading} rows={reviews?.items} empty={<EmptyState title="No reviews yet" />} columns={[
          { key: 'period', label: 'Period' }, { key: 'rating', label: 'Rating', render: (r) => <b>{r.rating} / 5</b> },
          { key: 'reviewer', label: 'Reviewer' }, { key: 'strengths', label: 'Strengths' }, { key: 'improvements', label: 'To improve' }]} />
      </Card>
      <Card title="Goals">
        {goals?.length ? goals.map((g) => (
          <div key={g.id} className="mb-3">
            <div className="mb-1 flex justify-between text-xs"><span className="font-medium">{g.title}</span><StatusBadge status={g.status} /></div>
            <ProgressBar value={g.progress} />
          </div>
        )) : <EmptyState title="No goals" />}
      </Card>
    </div>
  )
}

function EmployeeHistory({ id }) {
  const { data, loading } = useApi(`/audit/entity/employee/${id}`)
  if (loading && !data) return <PageLoader />
  return (
    <Card title="Change history" subtitle="Field-level audit trail">
      {!data?.length ? <EmptyState title="No recorded changes" /> : (
        <ol className="relative space-y-4 border-l border-line pl-5">
          {data.map((a) => (
            <li key={a.id}>
              <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-indigo-500" />
              <p className="text-sm"><b>{a.user}</b> — {a.summary}</p>
              <p className="text-[11px] text-muted">{fmtDateTime(a.created_at)}</p>
              {Object.keys(a.changes || {}).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(a.changes).map(([k, [o, n]]) => (
                    <span key={k} className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px]"><b>{titleCase(k)}</b>: <s className="text-muted">{String(o ?? '—')}</s> → {String(n ?? '—')}</span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
