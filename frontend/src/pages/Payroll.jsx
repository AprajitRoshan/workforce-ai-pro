import { useState } from 'react'
import { BadgeIndianRupee, CheckCircle2, Download, Gift, Play, Plus, Trash2, Wallet } from 'lucide-react'
import api, { download } from '../api/client'
import { BarsChart, LinesChart } from '../components/charts'
import {
  Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, StatCard, StatusBadge, Tabs, fmtDate, fmtMoney,
} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useApi, useDebounced } from '../hooks/useApi'

const lastMonth = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7) }

export default function Payroll() {
  const { isHR } = useAuth()
  const [tab, setTab] = useState(isHR ? 'overview' : 'mine')
  return (
    <>
      <PageHeader title="Payroll" icon={Wallet} subtitle={isHR ? 'Generate payroll, manage bonuses and issue payslips' : 'Your payslips and salary breakdown'} />
      {isHR && <Tabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'payslips', label: 'Payslips' }, { value: 'bonuses', label: 'Bonuses & incentives' }]} />}
      {tab === 'overview' && <Overview />}
      {tab === 'payslips' && <Payslips admin />}
      {tab === 'bonuses' && <Bonuses />}
      {tab === 'mine' && <Payslips />}
    </>
  )
}

function Overview() {
  const toast = useToast()
  const [period, setPeriod] = useState('')
  const { data: periods } = useApi('/payroll/periods')
  const { data, reload } = useApi('/payroll/summary', { period })
  const [gen, setGen] = useState(null)
  const [busy, setBusy] = useState(false)
  const generate = async () => {
    setBusy(true)
    try {
      const r = await api.post('/payroll/generate', { period: gen })
      toast.success('Payroll generated', `${r.data.generated} payslips for ${r.data.period}${r.data.skipped_paid ? ` (${r.data.skipped_paid} already paid)` : ''}`)
      setGen(null); setPeriod(r.data.period); reload()
    } catch (e) { toast.error('Generation failed', e.message) } finally { setBusy(false) }
  }
  const markPaid = async () => {
    try { const r = await api.post('/payroll/mark-paid', null, { params: { period: data.period } }); toast.success('Marked as paid', `${r.data.updated} payslips`); reload() }
    catch (e) { toast.error('Failed', e.message) }
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Select className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="Latest period" options={(periods || []).map((p) => ({ value: p, label: p }))} />
        <div className="flex gap-2">
          {data?.payslips > data?.paid && <Button variant="secondary" icon={CheckCircle2} onClick={markPaid}>Mark {data.period} paid</Button>}
          <Button icon={Play} onClick={() => setGen(lastMonth())}>Run payroll</Button>
        </div>
      </div>
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={`Gross · ${data.period || '—'}`} value={fmtMoney(data.gross)} icon={BadgeIndianRupee} sub={`${data.payslips} payslips · ${data.paid} paid`} />
            <StatCard label="Net pay" value={fmtMoney(data.net)} icon={Wallet} tone="green" />
            <StatCard label="Tax (TDS) + PF" value={fmtMoney(data.tax + data.pf)} tone="red" sub={`Tax ${fmtMoney(data.tax)} · PF ${fmtMoney(data.pf)}`} />
            <StatCard label="Bonuses & overtime" value={fmtMoney(data.bonus + data.overtime)} icon={Gift} tone="amber" sub={`OT ${fmtMoney(data.overtime)}`} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Payroll trend"><LinesChart data={data.trend} x="period" height={250} lines={[{ key: 'gross', name: 'Gross' }, { key: 'net', name: 'Net' }, { key: 'tax', name: 'Tax' }]} formatter={(v) => `₹${(v / 100000).toFixed(1)}L`} /></Card>
            <Card title="Cost by department"><BarsChart data={data.by_department} x="department" layout="vertical" height={250} bars={[{ key: 'net', name: 'Net pay' }]} formatter={(v) => `₹${(v / 100000).toFixed(1)}L`} /></Card>
          </div>
        </>
      )}
      <Modal open={!!gen} onClose={() => setGen(null)} size="sm" title="Run payroll" footer={<><Button variant="secondary" onClick={() => setGen(null)}>Cancel</Button><Button loading={busy} onClick={generate}>Generate</Button></>}>
        <Field label="Period" hint="Salary split, overtime (from attendance), bonuses, unpaid leave, PF and slab-based tax are computed automatically. Paid payslips are never overwritten.">
          <Input type="month" value={gen || ''} onChange={(e) => setGen(e.target.value)} />
        </Field>
      </Modal>
    </>
  )
}

function Payslips({ admin }) {
  const toast = useToast()
  const [f, setF] = useState({ period: '', department_id: '', status: '', q: '' })
  const [page, setPage] = useState(1)
  const [view, setView] = useState(null)
  const q = useDebounced(f.q)
  const { data: periods } = useApi('/payroll/periods')
  const { data: depts } = useApi(admin ? '/departments' : null)
  const { data, loading } = useApi('/payroll', { ...f, q, page, size: 15 })
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1) }
  const pdf = (p) => download(`/payroll/${p.id}/pdf`).catch((e) => toast.error('Download failed', e.message))
  return (
    <Card bodyClass="p-0">
      <div className="flex flex-wrap gap-2 border-b border-line p-3">
        {admin && <Input className="w-56" placeholder="Search employee…" value={f.q} onChange={set('q')} />}
        <Select className="w-auto" value={f.period} onChange={set('period')} placeholder="All periods" options={(periods || []).map((p) => ({ value: p, label: p }))} />
        {admin && <Select className="w-auto" value={f.department_id} onChange={set('department_id')} placeholder="All departments" options={(depts || []).map((d) => ({ value: d.id, label: d.name }))} />}
        {admin && <Select className="w-auto" value={f.status} onChange={set('status')} placeholder="Any status" options={['GENERATED', 'PAID']} />}
      </div>
      <DataTable loading={loading} rows={data?.items} page={data} onPage={setPage} onRowClick={setView} empty={<EmptyState icon={Wallet} title="No payslips found" />} columns={[
        admin && { key: 'employee', label: 'Employee', render: (p) => <div><p className="font-medium">{p.employee}</p><p className="text-xs text-muted">{p.employee_code} · {p.department}</p></div> },
        { key: 'period', label: 'Period' }, { key: 'gross', label: 'Gross', align: 'right', render: (p) => fmtMoney(p.gross) },
        { key: 'total_deductions', label: 'Deductions', align: 'right', render: (p) => <span className="text-rose-500">−{fmtMoney(p.total_deductions)}</span> },
        { key: 'net', label: 'Net pay', align: 'right', render: (p) => <b>{fmtMoney(p.net)}</b> }, { key: 'status', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
        { key: 'pdf', label: '', render: (p) => <Button size="sm" variant="ghost" icon={Download} onClick={(e) => { e.stopPropagation(); pdf(p) }}>PDF</Button> },
      ].filter(Boolean)} />
      <Modal open={!!view} onClose={() => setView(null)} title={view && `Payslip · ${view.period}`} subtitle={view?.employee}
        footer={<Button icon={Download} onClick={() => pdf(view)}>Download PDF</Button>}>
        {view && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted">Earnings</p>
              {[['Basic', view.basic], ['HRA', view.hra], ['Special allowance', view.allowances], ['Overtime', view.overtime_pay], ['Bonus', view.bonus], ['Incentives', view.incentives]].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-line py-1.5 text-sm"><span>{k}</span><span className="tabular-nums">{fmtMoney(v, 2)}</span></div>
              ))}
              <div className="flex justify-between py-2 text-sm font-semibold"><span>Gross</span><span>{fmtMoney(view.gross, 2)}</span></div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted">Deductions</p>
              {[['Income tax (TDS)', view.tax], ['Provident fund', view.pf], ['Unpaid leave', view.unpaid_leave_deduction]].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-line py-1.5 text-sm"><span>{k}</span><span className="tabular-nums">{fmtMoney(v, 2)}</span></div>
              ))}
              <div className="flex justify-between py-2 text-sm font-semibold"><span>Total</span><span>{fmtMoney(view.total_deductions, 2)}</span></div>
            </div>
            <div className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 p-4 text-white sm:col-span-2">
              <p className="text-xs text-indigo-100">Net pay</p><p className="text-2xl font-bold">{fmtMoney(view.net, 2)}</p>
              <p className="text-[11px] text-indigo-100">Generated {fmtDate(view.generated_at)} · {view.status}</p>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  )
}

function Bonuses() {
  const toast = useToast()
  const [period, setPeriod] = useState(lastMonth())
  const { data, loading, reload } = useApi('/payroll/bonuses', { period })
  const { data: people } = useApi('/employees/options')
  const [form, setForm] = useState(null)
  const save = async () => {
    try { await api.post('/payroll/bonuses', { ...form, employee_id: Number(form.employee_id), amount: Number(form.amount) }); toast.success('Added', 'Re-run payroll for the period to include it.'); setForm(null); reload() }
    catch (e) { toast.error('Could not add', e.message) }
  }
  const remove = async (b) => { try { await api.delete(`/payroll/bonuses/${b.id}`); reload() } catch (e) { toast.error('Delete failed', e.message) } }
  return (
    <Card bodyClass="p-0" title="Bonuses & incentives" actions={<><Input type="month" className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} /><Button icon={Plus} onClick={() => setForm({ employee_id: '', period, kind: 'BONUS', amount: 5000, reason: '' })}>Add</Button></>}>
      <DataTable loading={loading} rows={data} empty={<EmptyState icon={Gift} title="No bonuses for this period" />} columns={[
        { key: 'employee', label: 'Employee' }, { key: 'kind', label: 'Type', render: (b) => <StatusBadge status={b.kind === 'BONUS' ? 'GENERATED' : 'IN_PROGRESS'} label={b.kind} /> },
        { key: 'amount', label: 'Amount', align: 'right', render: (b) => fmtMoney(b.amount) }, { key: 'reason', label: 'Reason' },
        { key: 'x', label: '', render: (b) => <button className="text-muted hover:text-rose-500" onClick={() => remove(b)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button> }]} />
      <Modal open={!!form} onClose={() => setForm(null)} title="Add bonus / incentive" footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button onClick={save} disabled={!form?.employee_id}>Add</Button></>}>
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Employee" className="sm:col-span-2"><Select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} placeholder="Select…" options={(people || []).map((p) => ({ value: p.id, label: p.label }))} /></Field>
            <Field label="Type"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} options={['BONUS', 'INCENTIVE']} /></Field>
            <Field label="Amount (₹)"><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="Period"><Input type="month" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} /></Field>
            <Field label="Reason"><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Card>
  )
}
