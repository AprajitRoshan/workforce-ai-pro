import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Filter, Plus, RotateCcw, Search, Users } from 'lucide-react'
import { download } from '../api/client'
import EmployeeForm from '../components/EmployeeForm'
import {
  Avatar, Button, Card, DataTable, EmptyState, ErrorState, Field, Input, PageHeader, RiskBadge, Select, StatusBadge, cx, fmtDate,
  fmtMoney,
} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { invalidate, useApi, useDebounced } from '../hooks/useApi'

const RISKS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
const INITIAL = { q: '', department_id: '', status: 'ACTIVE', risk_level: [], salary_min: '', salary_max: '', attendance_min: '', hired_from: '', hired_to: '' }

export default function Employees() {
  const { isHR } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const [f, setF] = useState(INITIAL)
  const [advanced, setAdvanced] = useState(false)
  const [sort, setSort] = useState({ by: 'name', dir: 'asc' })
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const q = useDebounced(f.q, 300)
  const { data: depts } = useApi('/departments')
  const params = { ...f, q, sort_by: sort.by, sort_dir: sort.dir, page, size: 15 }
  const { data, loading, error, reload } = useApi('/employees', params)

  const set = (k, v) => { setF((s) => ({ ...s, [k]: v })); setPage(1) }
  const toggleRisk = (r) => set('risk_level', f.risk_level.includes(r) ? f.risk_level.filter((x) => x !== r) : [...f.risk_level, r])
  const onSort = (by) => setSort((s) => ({ by, dir: s.by === by && s.dir === 'asc' ? 'desc' : 'asc' }))
  const activeFilters = Object.entries(f).filter(([k, v]) => k !== 'q' && k !== 'status' && (Array.isArray(v) ? v.length : v)).length

  const exportAs = async (format) => {
    try { await download('/reports/employees', { format, department_id: f.department_id || undefined }, `employees.${format}`) }
    catch (e) { toast.error('Export failed', e.message) }
  }

  const columns = [
    { key: 'name', label: 'Employee', sortable: true, render: (e) => (
      <div className="flex items-center gap-3">
        <Avatar name={e.full_name} size="sm" />
        <div className="min-w-0"><p className="truncate font-medium">{e.full_name}</p><p className="truncate text-xs text-muted">{e.email}</p></div>
      </div>) },
    { key: 'code', label: 'Code', sortable: true, render: (e) => <span className="font-mono text-xs">{e.employee_code}</span> },
    { key: 'department', label: 'Department', render: (e) => <div><p>{e.department || '—'}</p><p className="text-xs text-muted">{e.job_title}</p></div> },
    { key: 'hire_date', label: 'Hired', sortable: true, render: (e) => <span className="whitespace-nowrap">{fmtDate(e.hire_date)}</span> },
    { key: 'salary', label: 'Monthly CTC', sortable: true, align: 'right', render: (e) => fmtMoney(e.salary) },
    { key: 'risk_score', label: 'AI risk', sortable: true, render: (e) => <RiskBadge level={e.risk_level} score={e.risk_score} /> },
    { key: 'status', label: 'Status', sortable: true, render: (e) => <StatusBadge status={e.status} /> },
  ]

  return (
    <>
      <PageHeader title="Employees" icon={Users} subtitle={data ? `${data.total} matching employee${data.total === 1 ? '' : 's'}` : 'Directory & profiles'}
        actions={<>
          <Button variant="secondary" icon={Download} onClick={() => exportAs('xlsx')}>Excel</Button>
          <Button variant="secondary" icon={Download} onClick={() => exportAs('pdf')}>PDF</Button>
          {isHR && <Button icon={Plus} onClick={() => setFormOpen(true)}>Add employee</Button>}
        </>} />
      <Card bodyClass="p-0">
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Search name, email or code…" className="pl-9" />
            </div>
            <Select className="w-auto" value={f.department_id} onChange={(e) => set('department_id', e.target.value)} placeholder="All departments"
              options={(depts || []).map((d) => ({ value: d.id, label: d.name }))} />
            <Select className="w-auto" value={f.status} onChange={(e) => set('status', e.target.value)} placeholder="Any status" options={['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED']} />
            <div className="flex items-center gap-1">
              {RISKS.map((r) => (
                <button key={r} onClick={() => toggleRisk(r)} className={cx('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  f.risk_level.includes(r) ? 'border-indigo-500 bg-brand-soft text-brand' : 'border-line text-muted hover:text-ink')}>{r[0] + r.slice(1).toLowerCase()}</button>
              ))}
            </div>
            <Button variant="ghost" icon={Filter} onClick={() => setAdvanced((a) => !a)}>Advanced{activeFilters ? ` (${activeFilters})` : ''}</Button>
            {(activeFilters > 0 || f.q || f.status !== 'ACTIVE') && <Button variant="ghost" icon={RotateCcw} onClick={() => { setF(INITIAL); setPage(1) }}>Reset</Button>}
          </div>
          {advanced && (
            <div className="grid gap-3 rounded-lg bg-surface-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Min salary"><Input type="number" value={f.salary_min} onChange={(e) => set('salary_min', e.target.value)} placeholder="₹" /></Field>
              <Field label="Max salary"><Input type="number" value={f.salary_max} onChange={(e) => set('salary_max', e.target.value)} placeholder="₹" /></Field>
              <Field label="Min attendance % (30d)"><Input type="number" min={0} max={100} value={f.attendance_min} onChange={(e) => set('attendance_min', e.target.value)} /></Field>
              <Field label="Hired from"><Input type="date" value={f.hired_from} onChange={(e) => set('hired_from', e.target.value)} /></Field>
              <Field label="Hired to"><Input type="date" value={f.hired_to} onChange={(e) => set('hired_to', e.target.value)} /></Field>
            </div>
          )}
        </div>
        {error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
          <DataTable columns={columns} rows={data?.items} loading={loading} sort={sort} onSort={onSort} page={data} onPage={setPage}
            onRowClick={(e) => nav(`/employees/${e.id}`)}
            empty={<EmptyState icon={Users} title="No employees match these filters" description="Try widening the search or resetting filters." />} />
        )}
      </Card>
      <EmployeeForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={(e) => { invalidate('/employees'); nav(`/employees/${e.id}`) }} />
    </>
  )
}
