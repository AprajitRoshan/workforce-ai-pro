import { useState } from 'react'
import { CalendarCheck, Eye, FileBarChart, FileSpreadsheet, FileText, TrendingDown, Users, Wallet } from 'lucide-react'
import { download } from '../api/client'
import { Button, Card, DataTable, Field, Input, Modal, PageHeader, Select, cx } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useApi } from '../hooks/useApi'

const REPORTS = [
  { kind: 'employees', title: 'Employee report', icon: Users, desc: 'Directory with department, role, tenure, salary and AI risk level.' },
  { kind: 'attrition', title: 'Attrition report', icon: TrendingDown, desc: 'Current at-risk employees plus recent leavers and exit reasons.' },
  { kind: 'payroll', title: 'Payroll report', icon: Wallet, desc: 'Gross, tax, PF, deductions and net pay per employee for a period.', hr: true },
  { kind: 'attendance', title: 'Attendance report', icon: CalendarCheck, desc: 'Present, late, absent, leave, hours and overtime per employee.' },
]

export default function Reports() {
  const { isHR } = useAuth()
  const toast = useToast()
  const { data: depts } = useApi('/departments')
  const { data: periods } = useApi(isHR ? '/payroll/periods' : null)
  const [opts, setOpts] = useState({ department_id: '', period: '', date_from: '', date_to: '' })
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const params = (kind) => ({ department_id: opts.department_id || undefined, period: kind === 'payroll' ? opts.period || undefined : undefined,
    date_from: kind === 'attendance' ? opts.date_from || undefined : undefined, date_to: kind === 'attendance' ? opts.date_to || undefined : undefined })
  const exp = async (kind, format) => {
    setBusy(`${kind}-${format}`)
    try { await download(`/reports/${kind}`, { ...params(kind), format }); toast.success('Report exported', `${kind} · ${format.toUpperCase()}`) }
    catch (e) { toast.error('Export failed', e.message) } finally { setBusy('') }
  }
  const { data: pv, loading: pvLoading } = useApi(preview ? `/reports/${preview}` : null, preview ? params(preview) : undefined)
  return (
    <>
      <PageHeader title="Reports & Export" icon={FileBarChart} subtitle="Generate PDF and Excel reports — every export is recorded in the audit log" />
      <Card title="Report filters" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Department"><Select value={opts.department_id} onChange={(e) => setOpts({ ...opts, department_id: e.target.value })} placeholder="All departments" options={(depts || []).map((d) => ({ value: d.id, label: d.name }))} /></Field>
          {isHR && <Field label="Payroll period"><Select value={opts.period} onChange={(e) => setOpts({ ...opts, period: e.target.value })} placeholder="Latest" options={(periods || []).map((p) => ({ value: p, label: p }))} /></Field>}
          <Field label="Attendance from"><Input type="date" value={opts.date_from} onChange={(e) => setOpts({ ...opts, date_from: e.target.value })} /></Field>
          <Field label="Attendance to"><Input type="date" value={opts.date_to} onChange={(e) => setOpts({ ...opts, date_to: e.target.value })} /></Field>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {REPORTS.filter((r) => !r.hr || isHR).map((r) => (
          <div key={r.kind} className="card flex flex-col p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-brand-soft p-2.5 text-brand"><r.icon className="h-5 w-5" /></div>
              <div><p className="font-semibold">{r.title}</p><p className="text-sm text-muted">{r.desc}</p></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" icon={Eye} onClick={() => setPreview(r.kind)}>Preview</Button>
              <Button icon={FileText} loading={busy === `${r.kind}-pdf`} onClick={() => exp(r.kind, 'pdf')}>PDF</Button>
              <Button variant="success" icon={FileSpreadsheet} loading={busy === `${r.kind}-xlsx`} onClick={() => exp(r.kind, 'xlsx')}>Excel</Button>
            </div>
          </div>
        ))}
      </div>
      <Modal open={!!preview} onClose={() => setPreview(null)} size="xl" title={pv?.title || 'Preview'} subtitle={pv ? `${pv.subtitle} ${pv.rows.length} rows` : ''}>
        <div className={cx('rounded-lg border border-line', pvLoading && 'opacity-60')}>
          <DataTable loading={pvLoading} rows={pv?.rows?.slice(0, 100)} rowKey="__i" dense columns={(pv?.columns || []).map((c) => ({ key: c.key, label: c.label, render: (r) => (typeof r[c.key] === 'number' ? r[c.key].toLocaleString('en-IN', { maximumFractionDigits: 2 }) : r[c.key] ?? '—') }))} />
        </div>
        {pv?.rows?.length > 100 && <p className="mt-2 text-xs text-muted">Showing first 100 rows — export for the full report.</p>}
      </Modal>
    </>
  )
}
