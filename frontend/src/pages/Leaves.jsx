import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, Check, Plus, X } from 'lucide-react'
import api from '../api/client'
import { BarsChart, DonutChart, Legendary, PALETTE } from '../components/charts'
import {
  Badge, Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, ProgressBar, Select, StatCard, StatusBadge, Tabs, Textarea,
  fmtDate, titleCase,
} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useApi } from '../hooks/useApi'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function Leaves() {
  const { user, isMgmt, isHR } = useAuth()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState(params.get('tab') || (user.employee_id ? 'mine' : 'approvals'))
  useEffect(() => { const t = params.get('tab'); if (t) setTab(t) }, [params])
  const change = (t) => { setTab(t); setParams({ tab: t }) }
  return (
    <>
      <PageHeader title="Leave Management" icon={CalendarDays} subtitle="Apply, approve and track leave against policy" />
      <Tabs value={tab} onChange={change} tabs={[
        user.employee_id && { value: 'mine', label: 'My leave' }, isMgmt && { value: 'approvals', label: 'Approvals' },
        isMgmt && { value: 'all', label: 'All requests' }, { value: 'policies', label: 'Policies' }, isMgmt && { value: 'report', label: 'Reports' }]} />
      {tab === 'mine' && <MyLeave />}
      {tab === 'approvals' && <Requests scope="approvals" status={['PENDING']} approvals />}
      {tab === 'all' && <Requests scope="all" />}
      {tab === 'policies' && <Policies canEdit={isHR} />}
      {tab === 'report' && <Report />}
    </>
  )
}

function MyLeave() {
  const toast = useToast()
  const { data: bal, reload: reloadBal } = useApi('/leaves/balance')
  const { data: policies } = useApi('/leaves/policies')
  const [page, setPage] = useState(1)
  const { data, loading, reload } = useApi('/leaves', { scope: 'mine', page, size: 10 })
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const apply = async () => {
    setBusy(true)
    try {
      await api.post('/leaves', form)
      toast.success('Leave requested', 'Your manager and HR have been notified.')
      setForm(null); reload(); reloadBal()
    } catch (e) { toast.error('Cannot apply', e.message) } finally { setBusy(false) }
  }
  const cancel = async (l) => {
    try { await api.post(`/leaves/${l.id}/cancel`); toast.info('Leave cancelled'); reload(); reloadBal() } catch (e) { toast.error('Cannot cancel', e.message) }
  }
  const today = new Date().toISOString().slice(0, 10)
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {(bal || []).map((b) => (
          <div key={b.leave_type} className="card p-4">
            <div className="flex items-center justify-between"><p className="text-xs font-medium text-muted">{titleCase(b.leave_type)}</p>{b.carried_forward > 0 && <Badge tone="blue">+{b.carried_forward} carried</Badge>}</div>
            <p className="mt-1 text-2xl font-bold">{b.remaining ?? b.used}<span className="text-sm font-normal text-muted">{b.remaining !== null ? ` / ${b.entitled}` : ' days taken'}</span></p>
            {b.remaining !== null && <ProgressBar className="mt-2" value={(b.remaining / (b.entitled || 1)) * 100} tone={b.remaining < 2 ? 'amber' : 'green'} />}
            <p className="mt-1.5 text-[11px] text-muted">{b.used} used · {b.pending} pending</p>
          </div>
        ))}
      </div>
      <Card className="mt-4" bodyClass="p-0" title="My requests" actions={<Button icon={Plus} onClick={() => setForm({ leave_type: 'ANNUAL', start_date: today, end_date: today, reason: '' })}>Apply for leave</Button>}>
        <DataTable loading={loading} rows={data?.items} page={data} onPage={setPage} empty={<EmptyState icon={CalendarDays} title="No leave requests yet" />} columns={[
          { key: 'leave_type', label: 'Type', render: (l) => titleCase(l.leave_type) }, { key: 'dates', label: 'Dates', render: (l) => `${fmtDate(l.start_date)} → ${fmtDate(l.end_date)}` },
          { key: 'days', label: 'Days', align: 'right' }, { key: 'reason', label: 'Reason', render: (l) => <span className="line-clamp-1">{l.reason || '—'}</span> },
          { key: 'status', label: 'Status', render: (l) => <div><StatusBadge status={l.status} />{l.approver_comment && <p className="mt-0.5 text-[11px] text-muted">“{l.approver_comment}”</p>}</div> },
          { key: 'act', label: '', render: (l) => (l.status === 'PENDING' || (l.status === 'APPROVED' && l.start_date > today)) && <Button size="sm" variant="ghost" onClick={() => cancel(l)}>Cancel</Button> }]} />
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title="Apply for leave" footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button loading={busy} onClick={apply}>Submit request</Button></>}>
        {form && (
          <div className="space-y-3">
            <Field label="Leave type"><Select value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })} options={(policies || []).map((p) => ({ value: p.leave_type, label: `${titleCase(p.leave_type)} — max ${p.max_consecutive_days} days` }))} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From"><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value, end_date: e.target.value > form.end_date ? e.target.value : form.end_date })} /></Field>
              <Field label="To"><Input type="date" min={form.start_date} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
            </div>
            <Field label="Reason"><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
            <p className="text-[11px] text-muted">Weekends are excluded automatically. Requests are validated against your balance and existing leave.</p>
          </div>
        )}
      </Modal>
    </>
  )
}

function Requests({ scope, status, approvals }) {
  const toast = useToast()
  const [f, setF] = useState({ status: status || [], leave_type: '', department_id: '' })
  const [page, setPage] = useState(1)
  const { data: depts } = useApi('/departments')
  const { data, loading, reload } = useApi('/leaves', { scope, ...f, page, size: 15 })
  const [decide, setDecide] = useState(null)
  const submit = async () => {
    try {
      await api.post(`/leaves/${decide.leave.id}/decision`, { approve: decide.approve, comment: decide.comment || null })
      toast.success(decide.approve ? 'Leave approved' : 'Leave rejected', decide.leave.employee)
      setDecide(null); reload()
    } catch (e) { toast.error('Decision failed', e.message) }
  }
  return (
    <Card bodyClass="p-0">
      {!approvals && (
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Select className="w-auto" value={f.status[0] || ''} onChange={(e) => setF({ ...f, status: e.target.value ? [e.target.value] : [] })} placeholder="Any status" options={['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']} />
          <Select className="w-auto" value={f.leave_type} onChange={(e) => setF({ ...f, leave_type: e.target.value })} placeholder="Any type" options={['ANNUAL', 'SICK', 'CASUAL', 'UNPAID']} />
          <Select className="w-auto" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })} placeholder="All departments" options={(depts || []).map((d) => ({ value: d.id, label: d.name }))} />
        </div>
      )}
      <DataTable loading={loading} rows={data?.items} page={data} onPage={setPage}
        empty={<EmptyState icon={Check} title={approvals ? 'No pending approvals' : 'No requests'} description={approvals ? 'You are all caught up.' : undefined} />} columns={[
          { key: 'employee', label: 'Employee', render: (l) => <div><p className="font-medium">{l.employee}</p><p className="text-xs text-muted">{l.department}</p></div> },
          { key: 'leave_type', label: 'Type', render: (l) => titleCase(l.leave_type) }, { key: 'dates', label: 'Dates', render: (l) => `${fmtDate(l.start_date)} → ${fmtDate(l.end_date)}` },
          { key: 'days', label: 'Days', align: 'right' }, { key: 'reason', label: 'Reason', render: (l) => <span className="line-clamp-1">{l.reason || '—'}</span> },
          { key: 'status', label: 'Status', render: (l) => <StatusBadge status={l.status} /> },
          { key: 'act', label: '', render: (l) => l.status === 'PENDING' && (
            <div className="flex gap-1">
              <Button size="sm" variant="success" icon={Check} onClick={() => setDecide({ leave: l, approve: true, comment: '' })}>Approve</Button>
              <Button size="sm" variant="secondary" icon={X} onClick={() => setDecide({ leave: l, approve: false, comment: '' })}>Reject</Button>
            </div>) }]} />
      <Modal open={!!decide} onClose={() => setDecide(null)} size="sm" title={decide?.approve ? 'Approve leave' : 'Reject leave'}
        subtitle={decide && `${decide.leave.employee} · ${decide.leave.days} day(s) ${titleCase(decide.leave.leave_type)}`}
        footer={<><Button variant="secondary" onClick={() => setDecide(null)}>Cancel</Button><Button variant={decide?.approve ? 'success' : 'danger'} onClick={submit}>{decide?.approve ? 'Approve' : 'Reject'}</Button></>}>
        <Field label="Comment (optional)"><Textarea value={decide?.comment || ''} onChange={(e) => setDecide({ ...decide, comment: e.target.value })} /></Field>
      </Modal>
    </Card>
  )
}

function Policies({ canEdit }) {
  const toast = useToast()
  const { data, reload } = useApi('/leaves/policies')
  const [edit, setEdit] = useState(null)
  const save = async () => {
    try { await api.post('/leaves/policies', { ...edit, annual_quota: Number(edit.annual_quota), max_consecutive_days: Number(edit.max_consecutive_days) }); toast.success('Policy saved'); setEdit(null); reload() }
    catch (e) { toast.error('Could not save policy', e.message) }
  }
  return (
    <>
      {canEdit && <div className="mb-4 flex justify-end"><Button icon={Plus} onClick={() => setEdit({ leave_type: '', annual_quota: 5, carry_forward: false, max_consecutive_days: 5, requires_document: false, description: '' })}>New policy</Button></div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(data || []).map((p) => (
          <button key={p.id} disabled={!canEdit} onClick={() => setEdit(p)} className="card p-5 text-left enabled:hover:border-indigo-400">
            <p className="font-semibold">{titleCase(p.leave_type)}</p>
            <p className="mt-2 text-3xl font-bold">{p.annual_quota}<span className="text-sm font-normal text-muted"> days / year</span></p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge tone="indigo">max {p.max_consecutive_days} consecutive</Badge>
              {p.carry_forward && <Badge tone="green">carry forward</Badge>}
              {p.requires_document && <Badge tone="amber">document required</Badge>}
            </div>
            <p className="mt-3 text-xs text-muted">{p.description}</p>
          </button>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Leave policy" footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Leave type code"><Input value={edit.leave_type} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, leave_type: e.target.value.toUpperCase() })} /></Field>
            <Field label="Annual quota (days)"><Input type="number" value={edit.annual_quota} onChange={(e) => setEdit({ ...edit, annual_quota: e.target.value })} /></Field>
            <Field label="Max consecutive days"><Input type="number" value={edit.max_consecutive_days} onChange={(e) => setEdit({ ...edit, max_consecutive_days: e.target.value })} /></Field>
            <div className="flex flex-col justify-end gap-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-600" checked={edit.carry_forward} onChange={(e) => setEdit({ ...edit, carry_forward: e.target.checked })} />Carry forward (max 5)</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-600" checked={edit.requires_document} onChange={(e) => setEdit({ ...edit, requires_document: e.target.checked })} />Requires document</label>
            </div>
            <Field label="Description" className="sm:col-span-2"><Textarea value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </>
  )
}

function Report() {
  const { data } = useApi('/leaves/report')
  if (!data) return null
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {['APPROVED', 'PENDING', 'REJECTED', 'CANCELLED'].map((s) => <StatCard key={s} label={titleCase(s)} value={data.by_status[s] || 0} tone={{ APPROVED: 'green', PENDING: 'amber', REJECTED: 'red', CANCELLED: 'blue' }[s]} />)}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title={`Approved days by month (${data.year})`} className="lg:col-span-2">
          <BarsChart data={data.by_month.map((m) => ({ ...m, month: MONTHS[m.month - 1] }))} x="month" bars={[{ key: 'days', name: 'Days' }]} height={240} />
        </Card>
        <Card title="By leave type">
          <DonutChart data={data.by_type.map((t) => ({ name: titleCase(t.leave_type), value: t.days }))} />
          <Legendary items={data.by_type.map((t, i) => ({ label: titleCase(t.leave_type), value: `${t.days}d`, color: PALETTE[i] }))} />
        </Card>
      </div>
      <Card title="By department" className="mt-4"><BarsChart data={data.by_department} x="department" bars={[{ key: 'days', name: 'Leave days', color: '#8b5cf6' }]} height={220} /></Card>
    </>
  )
}
