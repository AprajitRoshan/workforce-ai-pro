import { useState } from 'react'
import { CalendarCheck, Clock, Download, Plus, Timer, UserCheck, UserX } from 'lucide-react'
import api, { download } from '../api/client'
import { BarsChart } from '../components/charts'
import CheckInCard from '../components/CheckInCard'
import {
  Button, Card, DataTable, Field, Input, Modal, PageHeader, Select, StatCard, StatusBadge, Tabs, fmtDate, fmtTime,
} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useApi } from '../hooks/useApi'

const iso = (d) => d.toISOString().slice(0, 10)

export default function Attendance() {
  const { user, isMgmt, isHR } = useAuth()
  const [tab, setTab] = useState(user.employee_id ? 'mine' : 'records')
  const [bump, setBump] = useState(0)
  return (
    <>
      <PageHeader title="Attendance & Shifts" icon={Clock} subtitle="Check-in/out, working hours, overtime and shift planning" />
      <Tabs value={tab} onChange={setTab} tabs={[
        user.employee_id && { value: 'mine', label: 'My attendance' }, isMgmt && { value: 'records', label: 'Team records' },
        isMgmt && { value: 'report', label: 'Reports' }, { value: 'shifts', label: 'Shifts' }]} />
      {tab === 'mine' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div><CheckInCard onChange={() => setBump((b) => b + 1)} /></div>
          <div className="lg:col-span-2"><Records mine key={bump} /></div>
        </div>
      )}
      {tab === 'records' && <><Summary /><div className="mt-4"><Records /></div></>}
      {tab === 'report' && <Report />}
      {tab === 'shifts' && <Shifts canEdit={isHR} canAssign={isMgmt} />}
    </>
  )
}

function Summary() {
  const { data } = useApi('/attendance/summary', { days: 30 })
  if (!data) return null
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Attendance rate (30d)" value={`${data.attendance_rate}%`} icon={UserCheck} tone="green" />
        <StatCard label="Punctuality" value={`${data.punctuality_rate}%`} icon={Timer} sub={`${data.totals.LATE} late arrivals`} />
        <StatCard label="Absences" value={data.totals.ABSENT} icon={UserX} tone="red" sub={`${data.totals.ON_LEAVE} leave days`} />
        <StatCard label="Overtime (30d)" value={`${data.total_overtime}h`} icon={Clock} tone="amber" sub={`avg ${data.avg_hours}h/day`} />
      </div>
      <Card title="Daily attendance" className="mt-4">
        <BarsChart data={data.trend.map((t) => ({ ...t, date: t.date.slice(5) }))} x="date" stacked height={240} bars={[
          { key: 'PRESENT', name: 'Present', color: '#10b981' }, { key: 'LATE', name: 'Late', color: '#f59e0b' }, { key: 'HALF_DAY', name: 'Half day', color: '#0ea5e9' },
          { key: 'ON_LEAVE', name: 'On leave', color: '#8b5cf6' }, { key: 'ABSENT', name: 'Absent', color: '#ef4444' }]} />
      </Card>
    </>
  )
}

function Records({ mine }) {
  const { user } = useAuth()
  const [f, setF] = useState({ date_from: '', date_to: '', status: '', department_id: '' })
  const [page, setPage] = useState(1)
  const { data: depts } = useApi(mine ? null : '/departments')
  const { data, loading } = useApi('/attendance', { ...f, employee_id: mine ? user.employee_id : undefined, page, size: 15 })
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1) }
  return (
    <Card bodyClass="p-0" title={mine ? 'My records' : 'Attendance records'}>
      <div className="flex flex-wrap gap-2 border-b border-line p-3">
        <Input type="date" className="w-auto" value={f.date_from} onChange={set('date_from')} aria-label="From" />
        <Input type="date" className="w-auto" value={f.date_to} onChange={set('date_to')} aria-label="To" />
        <Select className="w-auto" value={f.status} onChange={set('status')} placeholder="Any status" options={['PRESENT', 'LATE', 'ABSENT', 'HALF_DAY', 'ON_LEAVE']} />
        {!mine && <Select className="w-auto" value={f.department_id} onChange={set('department_id')} placeholder="All departments" options={(depts || []).map((d) => ({ value: d.id, label: d.name }))} />}
      </div>
      <DataTable loading={loading} rows={data?.items} page={data} onPage={setPage} dense columns={[
        !mine && { key: 'employee', label: 'Employee', render: (a) => <span className="font-medium">{a.employee}</span> },
        { key: 'date', label: 'Date', render: (a) => fmtDate(a.date) }, { key: 'status', label: 'Status', render: (a) => <StatusBadge status={a.status} /> },
        { key: 'check_in', label: 'Check in', render: (a) => fmtTime(a.check_in) }, { key: 'check_out', label: 'Check out', render: (a) => fmtTime(a.check_out) },
        { key: 'hours_worked', label: 'Hours', align: 'right', render: (a) => a.hours_worked?.toFixed(1) },
        { key: 'overtime_hours', label: 'OT', align: 'right', render: (a) => (a.overtime_hours ? <span className="text-amber-600">{a.overtime_hours.toFixed(1)}</span> : '—') },
      ].filter(Boolean)} />
    </Card>
  )
}

function Report() {
  const toast = useToast()
  const today = new Date()
  const [range, setRange] = useState({ date_from: iso(new Date(today - 29 * 864e5)), date_to: iso(today), department_id: '' })
  const { data: depts } = useApi('/departments')
  const { data, loading } = useApi('/attendance/report', range)
  const exp = (format) => download('/reports/attendance', { ...range, format }).catch((e) => toast.error('Export failed', e.message))
  return (
    <Card bodyClass="p-0" title="Attendance report" subtitle="Per-employee totals for the selected period"
      actions={<><Button size="sm" variant="secondary" icon={Download} onClick={() => exp('xlsx')}>Excel</Button><Button size="sm" variant="secondary" icon={Download} onClick={() => exp('pdf')}>PDF</Button></>}>
      <div className="flex flex-wrap gap-2 border-b border-line p-3">
        <Input type="date" className="w-auto" value={range.date_from} onChange={(e) => setRange({ ...range, date_from: e.target.value })} />
        <Input type="date" className="w-auto" value={range.date_to} onChange={(e) => setRange({ ...range, date_to: e.target.value })} />
        <Select className="w-auto" value={range.department_id} onChange={(e) => setRange({ ...range, department_id: e.target.value })} placeholder="All departments" options={(depts || []).map((d) => ({ value: d.id, label: d.name }))} />
      </div>
      <DataTable loading={loading} rows={data?.rows} rowKey="employee_id" dense columns={[
        { key: 'employee', label: 'Employee', render: (r) => <div><p className="font-medium">{r.employee}</p><p className="text-xs text-muted">{r.department}</p></div> },
        { key: 'present', label: 'Present', align: 'right' }, { key: 'late', label: 'Late', align: 'right' }, { key: 'absent', label: 'Absent', align: 'right' },
        { key: 'on_leave', label: 'Leave', align: 'right' }, { key: 'total_hours', label: 'Hours', align: 'right' }, { key: 'avg_hours', label: 'Avg/day', align: 'right' },
        { key: 'overtime_hours', label: 'Overtime', align: 'right' },
        { key: 'attendance_rate', label: 'Rate', align: 'right', render: (r) => <span className={r.attendance_rate < 85 ? 'font-semibold text-rose-500' : ''}>{r.attendance_rate}%</span> }]} />
    </Card>
  )
}

function Shifts({ canEdit, canAssign }) {
  const toast = useToast()
  const { data: shifts, reload } = useApi('/shifts')
  const { data: assigns, reload: reloadA } = useApi('/shifts/assignments')
  const { data: people } = useApi(canAssign ? '/employees/options' : null)
  const [edit, setEdit] = useState(null)
  const [assign, setAssign] = useState(null)
  const saveShift = async () => {
    try {
      if (edit.id) await api.put(`/shifts/${edit.id}`, edit)
      else await api.post('/shifts', edit)
      toast.success('Shift saved'); setEdit(null); reload()
    } catch (e) { toast.error('Could not save shift', e.message) }
  }
  const doAssign = async () => {
    try {
      const r = await api.post('/shifts/assign', { ...assign, shift_id: Number(assign.shift_id), employee_ids: assign.employee_ids.map(Number) })
      toast.success('Shift assigned', `${r.data.assigned} employee(s)`); setAssign(null); reload(); reloadA()
    } catch (e) { toast.error('Assignment failed', e.message) }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {canAssign && <Button variant="secondary" icon={CalendarCheck} onClick={() => setAssign({ shift_id: shifts?.[0]?.id || '', employee_ids: [], start_date: iso(new Date()) })}>Assign shift</Button>}
        {canEdit && <Button icon={Plus} onClick={() => setEdit({ name: '', start_time: '09:00', end_time: '18:00', grace_minutes: 15 })}>New shift</Button>}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {(shifts || []).map((s) => (
          <button key={s.id} disabled={!canEdit} onClick={() => setEdit(s)} className="card p-5 text-left enabled:hover:border-indigo-400">
            <div className="flex items-center justify-between"><p className="font-semibold">{s.name}</p><span className="text-xs text-muted">{s.employees} assigned</span></div>
            <p className="mt-2 text-2xl font-bold tabular-nums">{s.start_time} – {s.end_time}</p>
            <p className="text-xs text-muted">{s.hours}h shift · {s.grace_minutes} min grace</p>
          </button>
        ))}
      </div>
      <Card title="Current assignments" subtitle="Employees without an assignment work the default General shift" bodyClass="p-0">
        <DataTable rows={assigns} dense columns={[{ key: 'employee', label: 'Employee' }, { key: 'shift', label: 'Shift' },
          { key: 'start_date', label: 'From', render: (a) => fmtDate(a.start_date) }, { key: 'end_date', label: 'Until', render: (a) => (a.end_date ? fmtDate(a.end_date) : 'Ongoing') }]} />
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit shift' : 'New shift'} size="sm" footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={saveShift}>Save</Button></>}>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" className="col-span-2"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Start"><Input type="time" value={edit.start_time} onChange={(e) => setEdit({ ...edit, start_time: e.target.value })} /></Field>
            <Field label="End"><Input type="time" value={edit.end_time} onChange={(e) => setEdit({ ...edit, end_time: e.target.value })} /></Field>
            <Field label="Grace minutes" className="col-span-2"><Input type="number" value={edit.grace_minutes} onChange={(e) => setEdit({ ...edit, grace_minutes: Number(e.target.value) })} /></Field>
          </div>
        )}
      </Modal>
      <Modal open={!!assign} onClose={() => setAssign(null)} title="Assign shift" footer={<><Button variant="secondary" onClick={() => setAssign(null)}>Cancel</Button><Button onClick={doAssign} disabled={!assign?.employee_ids.length}>Assign</Button></>}>
        {assign && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Shift"><Select value={assign.shift_id} onChange={(e) => setAssign({ ...assign, shift_id: e.target.value })} options={(shifts || []).map((s) => ({ value: s.id, label: s.name }))} /></Field>
              <Field label="Start date"><Input type="date" value={assign.start_date} onChange={(e) => setAssign({ ...assign, start_date: e.target.value })} /></Field>
            </div>
            <Field label={`Employees (${assign.employee_ids.length} selected)`}>
              <select multiple className="input h-56" value={assign.employee_ids} onChange={(e) => setAssign({ ...assign, employee_ids: [...e.target.selectedOptions].map((o) => o.value) })}>
                {(people || []).map((p) => <option key={p.id} value={p.id}>{p.label} — {p.department}</option>)}
              </select>
            </Field>
            <p className="text-[11px] text-muted">Hold Ctrl / Cmd to select multiple.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
