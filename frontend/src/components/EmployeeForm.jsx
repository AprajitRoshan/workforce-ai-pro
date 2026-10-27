import { useEffect, useState } from 'react'
import api from '../api/client'
import { useApi } from '../hooks/useApi'
import { useToast } from '../context/ToastContext'
import { Button, Field, Input, Modal, Select } from './ui'

const EMPTY = {
  first_name: '', last_name: '', email: '', phone: '', gender: '', date_of_birth: '', marital_status: 'Single', education: 3,
  address: '', hire_date: new Date().toISOString().slice(0, 10), status: 'ACTIVE', department_id: '', job_role_id: '',
  manager_id: '', salary: 50000, job_satisfaction: 3, environment_satisfaction: 3, work_life_balance: 3, job_involvement: 3,
  distance_from_home: 10, num_companies_worked: 1, years_since_last_promotion: 0, training_times_last_year: 2, stock_option_level: 0,
}
const SCALE = [{ value: 1, label: '1 – Low' }, { value: 2, label: '2 – Medium' }, { value: 3, label: '3 – High' }, { value: 4, label: '4 – Very high' }]
const INT_FIELDS = ['education', 'job_satisfaction', 'environment_satisfaction', 'work_life_balance', 'job_involvement', 'distance_from_home',
  'num_companies_worked', 'years_since_last_promotion', 'training_times_last_year', 'stock_option_level']

export default function EmployeeForm({ open, onClose, employee, onSaved }) {
  const toast = useToast()
  const { data: depts } = useApi(open ? '/departments' : null)
  const { data: roles } = useApi(open ? '/employees/meta/job-roles' : null)
  const { data: people } = useApi(open ? '/employees/options' : null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(employee ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, employee[k] ?? ''])) : EMPTY)
  }, [open, employee])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const body = { ...form }
    for (const k of ['department_id', 'job_role_id', 'manager_id', 'date_of_birth', 'gender', 'phone', 'address']) if (body[k] === '') body[k] = null
    for (const k of ['department_id', 'job_role_id', 'manager_id']) if (body[k] !== null) body[k] = Number(body[k])
    for (const k of INT_FIELDS) body[k] = Number(body[k])
    body.salary = Number(body.salary)
    try {
      const r = employee ? await api.patch(`/employees/${employee.id}`, body) : await api.post('/employees', body)
      toast.success(employee ? 'Employee updated' : 'Employee created', r.data.full_name)
      onSaved?.(r.data)
      onClose()
    } catch (err) {
      toast.error('Could not save employee', err.message)
    } finally {
      setBusy(false)
    }
  }
  const roleOpts = (roles || []).filter((r) => !form.department_id || r.department_id === Number(form.department_id))

  return (
    <Modal open={open} onClose={onClose} size="lg" title={employee ? `Edit ${employee.full_name}` : 'Add employee'}
      subtitle="Engagement signals feed the attrition model — keep them current after reviews and surveys."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button form="emp-form" type="submit" loading={busy}>{employee ? 'Save changes' : 'Create employee'}</Button></>}>
      <form id="emp-form" onSubmit={submit} className="space-y-6">
        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Personal</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name *"><Input required value={form.first_name} onChange={set('first_name')} /></Field>
            <Field label="Last name *"><Input required value={form.last_name} onChange={set('last_name')} /></Field>
            <Field label="Email *"><Input type="email" required value={form.email} onChange={set('email')} /></Field>
            <Field label="Phone"><Input value={form.phone || ''} onChange={set('phone')} /></Field>
            <Field label="Gender"><Select value={form.gender || ''} onChange={set('gender')} placeholder="—" options={['Female', 'Male', 'Other'].map((v) => ({ value: v, label: v }))} /></Field>
            <Field label="Date of birth"><Input type="date" value={form.date_of_birth || ''} onChange={set('date_of_birth')} /></Field>
            <Field label="Marital status"><Select value={form.marital_status} onChange={set('marital_status')} options={['Single', 'Married', 'Divorced'].map((v) => ({ value: v, label: v }))} /></Field>
            <Field label="Education level (1–5)"><Input type="number" min={1} max={5} value={form.education} onChange={set('education')} /></Field>
            <Field label="Address" className="sm:col-span-2"><Input value={form.address || ''} onChange={set('address')} /></Field>
          </div>
        </section>
        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Employment</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Department"><Select value={form.department_id || ''} onChange={(e) => setForm({ ...form, department_id: e.target.value, job_role_id: '' })} placeholder="—"
              options={(depts || []).map((d) => ({ value: d.id, label: d.name }))} /></Field>
            <Field label="Job role"><Select value={form.job_role_id || ''} onChange={set('job_role_id')} placeholder="—" options={roleOpts.map((r) => ({ value: r.id, label: `${r.title} (L${r.level})` }))} /></Field>
            <Field label="Manager"><Select value={form.manager_id || ''} onChange={set('manager_id')} placeholder="—"
              options={(people || []).filter((p) => p.id !== employee?.id).map((p) => ({ value: p.id, label: p.label }))} /></Field>
            <Field label="Monthly CTC (₹)"><Input type="number" min={0} step={500} value={form.salary} onChange={set('salary')} /></Field>
            <Field label="Hire date *"><Input type="date" required value={form.hire_date} onChange={set('hire_date')} /></Field>
            <Field label="Status"><Select value={form.status} onChange={set('status')} options={['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED']} /></Field>
          </div>
        </section>
        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Engagement & career signals</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Job satisfaction"><Select value={form.job_satisfaction} onChange={set('job_satisfaction')} options={SCALE} /></Field>
            <Field label="Environment satisfaction"><Select value={form.environment_satisfaction} onChange={set('environment_satisfaction')} options={SCALE} /></Field>
            <Field label="Work-life balance"><Select value={form.work_life_balance} onChange={set('work_life_balance')} options={SCALE} /></Field>
            <Field label="Job involvement"><Select value={form.job_involvement} onChange={set('job_involvement')} options={SCALE} /></Field>
            <Field label="Distance from home (km)"><Input type="number" min={0} value={form.distance_from_home} onChange={set('distance_from_home')} /></Field>
            <Field label="Companies worked before"><Input type="number" min={0} value={form.num_companies_worked} onChange={set('num_companies_worked')} /></Field>
            <Field label="Years since promotion"><Input type="number" min={0} value={form.years_since_last_promotion} onChange={set('years_since_last_promotion')} /></Field>
            <Field label="Trainings last year"><Input type="number" min={0} value={form.training_times_last_year} onChange={set('training_times_last_year')} /></Field>
            <Field label="Stock option level (0–3)"><Input type="number" min={0} max={3} value={form.stock_option_level} onChange={set('stock_option_level')} /></Field>
          </div>
        </section>
      </form>
    </Modal>
  )
}
