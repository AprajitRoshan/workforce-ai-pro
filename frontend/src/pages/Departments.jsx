import { useState } from 'react'
import { Briefcase, Building2, Pencil, Plus, Trash2, UserCog, Users } from 'lucide-react'
import api from '../api/client'
import { BarsChart } from '../components/charts'
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, Modal, PageHeader, PageLoader, ProgressBar, Select, Tabs, Textarea, fmtMoney,
} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { invalidate, useApi } from '../hooks/useApi'

export default function Departments() {
  const { isHR, user } = useAuth()
  const [tab, setTab] = useState('departments')
  return (
    <>
      <PageHeader title="Departments & Roles" icon={Building2} subtitle="Organisation structure, role catalogue and department statistics" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'departments', label: 'Departments', icon: Building2 }, { value: 'roles', label: 'Job roles', icon: Briefcase },
        isHR && { value: 'assign', label: 'Assign employees', icon: UserCog }]} />
      {tab === 'departments' && <DepartmentGrid isHR={isHR} isAdmin={user.role === 'ADMIN'} />}
      {tab === 'roles' && <RolesTable isHR={isHR} />}
      {tab === 'assign' && <BulkAssign />}
    </>
  )
}

function DepartmentGrid({ isHR, isAdmin }) {
  const toast = useToast()
  const { data, loading, reload } = useApi('/departments/stats')
  const { data: people } = useApi(isHR ? '/employees/options' : null)
  const [edit, setEdit] = useState(null)
  const [del, setDel] = useState(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const body = { ...edit, head_id: edit.head_id ? Number(edit.head_id) : null, budget: Number(edit.budget || 0) }
      if (edit.id) await api.put(`/departments/${edit.id}`, body)
      else await api.post('/departments', body)
      toast.success('Department saved')
      invalidate('/departments')
      setEdit(null)
      reload()
    } catch (e) { toast.error('Could not save', e.message) } finally { setBusy(false) }
  }
  const remove = async () => {
    try { await api.delete(`/departments/${del.id}`); toast.success('Department deleted'); setDel(null); reload() }
    catch (e) { toast.error('Delete failed', e.message); setDel(null) }
  }
  if (loading && !data) return <PageLoader />
  return (
    <>
      <div className="mb-4 flex justify-end">{isHR && <Button icon={Plus} onClick={() => setEdit({ name: '', code: '', description: '', budget: 0, head_id: '' })}>New department</Button>}</div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.map((d) => (
          <div key={d.id} className="card p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2"><h3 className="font-semibold">{d.name}</h3><Badge>{d.code}</Badge></div>
                <p className="text-xs text-muted">Head: {d.head || '—'}</p>
              </div>
              {isHR && (
                <div className="flex gap-1">
                  <button className="rounded p-1.5 text-muted hover:bg-surface-2" onClick={() => setEdit({ ...d, head_id: d.head_id || '' })} aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                  {isAdmin && <button className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-rose-500" onClick={() => setDel(d)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button>}
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-surface-2 p-2"><p className="text-lg font-bold">{d.headcount}</p><p className="text-[10px] text-muted">Headcount</p></div>
              <div className="rounded-lg bg-surface-2 p-2"><p className="text-lg font-bold">{d.attrition_rate}%</p><p className="text-[10px] text-muted">Attrition 12m</p></div>
              <div className="rounded-lg bg-surface-2 p-2"><p className={`text-lg font-bold ${d.high_risk ? 'text-rose-500' : ''}`}>{d.high_risk}</p><p className="text-[10px] text-muted">High risk</p></div>
            </div>
            <div className="mt-4 space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-muted">Avg salary</span><span className="font-medium">{fmtMoney(d.avg_salary)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Avg AI risk</span><span className="font-medium">{d.avg_risk ?? '—'}%</span></div>
              <div><div className="mb-1 flex justify-between"><span className="text-muted">Attendance (30d)</span><span className="font-medium">{d.attendance_rate ?? '—'}%</span></div><ProgressBar value={d.attendance_rate} tone="green" /></div>
              {d.budget_utilisation !== null && <div><div className="mb-1 flex justify-between"><span className="text-muted">Budget used (annualised)</span><span className="font-medium">{d.budget_utilisation}%</span></div>
                <ProgressBar value={d.budget_utilisation} tone={d.budget_utilisation > 100 ? 'red' : d.budget_utilisation > 85 ? 'amber' : 'indigo'} /></div>}
            </div>
          </div>
        ))}
      </div>
      <Card title="Department comparison" className="mt-4">
        <BarsChart data={data} x="name" height={260} bars={[{ key: 'headcount', name: 'Headcount' }, { key: 'attrition_rate', name: 'Attrition %', color: '#f59e0b' }, { key: 'avg_risk', name: 'Avg risk %', color: '#ef4444' }]} />
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit department' : 'New department'}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Code"><Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            <Field label="Department head"><Select value={edit.head_id} onChange={(e) => setEdit({ ...edit, head_id: e.target.value })} placeholder="—" options={(people || []).map((p) => ({ value: p.id, label: p.label }))} /></Field>
            <Field label="Annual budget (₹)"><Input type="number" value={edit.budget} onChange={(e) => setEdit({ ...edit, budget: e.target.value })} /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger title="Delete department?" message={`Delete ${del?.name}? Active employees must be reassigned first.`} onConfirm={remove} confirmLabel="Delete" />
    </>
  )
}

function RolesTable({ isHR }) {
  const toast = useToast()
  const { data, loading, reload } = useApi('/job-roles')
  const { data: depts } = useApi('/departments')
  const [edit, setEdit] = useState(null)
  const save = async () => {
    try {
      const body = { ...edit, department_id: edit.department_id ? Number(edit.department_id) : null, level: Number(edit.level), min_salary: Number(edit.min_salary), max_salary: Number(edit.max_salary) }
      if (edit.id) await api.put(`/job-roles/${edit.id}`, body)
      else await api.post('/job-roles', body)
      toast.success('Role saved'); setEdit(null); reload()
    } catch (e) { toast.error('Could not save role', e.message) }
  }
  return (
    <Card bodyClass="p-0" title="Role catalogue" subtitle="Salary bands per level" actions={isHR && <Button size="sm" icon={Plus} onClick={() => setEdit({ title: '', department_id: '', level: 1, min_salary: 0, max_salary: 0 })}>Add role</Button>}>
      <DataTable loading={loading} rows={data} onRowClick={isHR ? (r) => setEdit(r) : undefined} columns={[
        { key: 'title', label: 'Title', render: (r) => <span className="font-medium">{r.title}</span> }, { key: 'department', label: 'Department' },
        { key: 'level', label: 'Level', render: (r) => <Badge tone="indigo">L{r.level}</Badge> },
        { key: 'band', label: 'Salary band', render: (r) => `${fmtMoney(r.min_salary)} – ${fmtMoney(r.max_salary)}` },
        { key: 'employees', label: 'Employees', align: 'right', render: (r) => <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5 text-muted" />{r.employees}</span> }]} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit role' : 'New role'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" className="sm:col-span-2"><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Department"><Select value={edit.department_id || ''} onChange={(e) => setEdit({ ...edit, department_id: e.target.value })} placeholder="—" options={(depts || []).map((d) => ({ value: d.id, label: d.name }))} /></Field>
            <Field label="Level (1–5)"><Input type="number" min={1} max={5} value={edit.level} onChange={(e) => setEdit({ ...edit, level: e.target.value })} /></Field>
            <Field label="Min salary"><Input type="number" value={edit.min_salary} onChange={(e) => setEdit({ ...edit, min_salary: e.target.value })} /></Field>
            <Field label="Max salary"><Input type="number" value={edit.max_salary} onChange={(e) => setEdit({ ...edit, max_salary: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Card>
  )
}

function BulkAssign() {
  const toast = useToast()
  const { data: people } = useApi('/employees/options')
  const { data: depts } = useApi('/departments')
  const { data: roles } = useApi('/employees/meta/job-roles')
  const [sel, setSel] = useState([])
  const [dept, setDept] = useState('')
  const [role, setRole] = useState('')
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const list = (people || []).filter((p) => p.label.toLowerCase().includes(filter.toLowerCase()))
  const submit = async () => {
    setBusy(true)
    try {
      const r = await api.post('/departments/assign', { employee_ids: sel, department_id: dept ? Number(dept) : null, job_role_id: role ? Number(role) : null })
      toast.success('Assignments updated', `${r.data.updated} employee(s) changed`)
      setSel([]); invalidate('/employees')
    } catch (e) { toast.error('Assignment failed', e.message) } finally { setBusy(false) }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title={`Select employees (${sel.length})`} className="lg:col-span-2">
        <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-3" />
        <div className="max-h-[420px] space-y-1 overflow-y-auto">
          {list.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
              <input type="checkbox" checked={sel.includes(p.id)} onChange={() => setSel((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))} className="accent-indigo-600" />
              <span className="flex-1">{p.label}</span><span className="text-xs text-muted">{p.department}</span>
            </label>
          ))}
        </div>
      </Card>
      <Card title="Assign to">
        <div className="space-y-3">
          <Field label="Department"><Select value={dept} onChange={(e) => setDept(e.target.value)} placeholder="Keep current" options={(depts || []).map((d) => ({ value: d.id, label: d.name }))} /></Field>
          <Field label="Job role"><Select value={role} onChange={(e) => setRole(e.target.value)} placeholder="Keep current"
            options={(roles || []).filter((r) => !dept || r.department_id === Number(dept)).map((r) => ({ value: r.id, label: `${r.title} (L${r.level})` }))} /></Field>
          <Button className="w-full" loading={busy} disabled={!sel.length || (!dept && !role)} onClick={submit}>Apply to {sel.length} employee(s)</Button>
        </div>
      </Card>
    </div>
  )
}
