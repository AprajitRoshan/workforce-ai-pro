import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlarmClock, CheckCircle2, HeartHandshake, Plus, TrendingDown } from 'lucide-react'
import api from '../../api/client'
import { BarsChart } from '../../components/charts'
import { InterventionModal } from '../../components/RiskPanel'
import {
  Badge, Button, Card, DataTable, EmptyState, Field, Modal, PageHeader, RiskBadge, Select, StatCard, StatusBadge, Textarea, cx, fmtDate, titleCase,
} from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { useApi } from '../../hooks/useApi'

export default function Interventions() {
  const toast = useToast()
  const [params] = useSearchParams()
  const [status, setStatus] = useState('')
  const [overdue, setOverdue] = useState(false)
  const [page, setPage] = useState(1)
  const [edit, setEdit] = useState(null)
  const [create, setCreate] = useState(params.get('employee') ? Number(params.get('employee')) : null)
  const [pick, setPick] = useState(false)
  const [pickId, setPickId] = useState('')
  const { data: stats, reload: reloadStats } = useApi('/ai/interventions/stats')
  const { data, loading, reload } = useApi('/ai/interventions', { status: status || undefined, overdue: overdue || undefined, page, size: 15 })
  const { data: people } = useApi(pick ? '/employees/options' : null)

  const save = async () => {
    try {
      await api.patch(`/ai/interventions/${edit.id}`, { status: edit.status, notes: edit.notes, outcome: edit.outcome, follow_up_date: edit.follow_up_date || null })
      toast.success('Intervention updated'); setEdit(null); reload(); reloadStats()
    } catch (e) { toast.error('Update failed', e.message) }
  }
  const s = stats || { by_status: {}, by_type: {} }
  return (
    <>
      <PageHeader title="HR Interventions" icon={HeartHandshake} subtitle="Decision support: retention actions, follow-ups and outcomes"
        actions={<Button icon={Plus} onClick={() => setPick(true)}>New intervention</Button>} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open" value={(s.by_status.OPEN || 0) + (s.by_status.IN_PROGRESS || 0)} icon={HeartHandshake} sub={`${s.by_status.IN_PROGRESS || 0} in progress`} />
        <StatCard label="Completed" value={s.by_status.COMPLETED || 0} icon={CheckCircle2} tone="green" />
        <StatCard label="Overdue follow-ups" value={s.overdue_follow_ups ?? 0} icon={AlarmClock} tone="red" />
        <StatCard label="Avg risk change after completion" value={s.avg_risk_change_after_completion !== null && s.avg_risk_change_after_completion !== undefined ? `${s.avg_risk_change_after_completion} pts` : '—'} icon={TrendingDown} tone="purple"
          sub={`${s.completed_with_risk_drop || 0} employees improved`} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card bodyClass="p-0" className="xl:col-span-2">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <Select className="w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} placeholder="Any status" options={['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-indigo-600" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />Overdue follow-ups only</label>
          </div>
          <DataTable loading={loading} rows={data?.items} page={data} onPage={setPage} onRowClick={(i) => setEdit({ ...i })}
            empty={<EmptyState icon={HeartHandshake} title="No interventions" description="Plan one from an employee's AI recommendations." />} columns={[
              { key: 'employee', label: 'Employee', render: (i) => <div><Link onClick={(e) => e.stopPropagation()} to={`/employees/${i.employee_id}`} className="font-medium hover:text-indigo-500">{i.employee?.full_name}</Link><p className="text-xs text-muted">{i.employee?.department}</p></div> },
              { key: 'action_type', label: 'Action', render: (i) => <div><p className="text-sm font-medium">{titleCase(i.action_type)}</p><p className="line-clamp-1 text-xs text-muted">{i.recommendation}</p></div> },
              { key: 'risk', label: 'Risk then → now', render: (i) => <span className="whitespace-nowrap text-xs tabular-nums">{i.risk_at_creation ?? '—'}% → <RiskBadge level={i.employee?.risk_level} score={i.employee?.risk_score} /></span> },
              { key: 'owner', label: 'Owner' },
              { key: 'follow_up_date', label: 'Follow-up', render: (i) => { const late = i.follow_up_date && new Date(i.follow_up_date) < new Date() && ['OPEN', 'IN_PROGRESS'].includes(i.status); return <span className={cx('whitespace-nowrap', late && 'font-semibold text-rose-500')}>{fmtDate(i.follow_up_date)}</span> } },
              { key: 'status', label: 'Status', render: (i) => <StatusBadge status={i.status} /> }]} />
        </Card>
        <Card title="Actions by type">
          <BarsChart data={Object.entries(s.by_type).map(([k, v]) => ({ type: titleCase(k), count: v }))} x="type" layout="vertical" height={280} bars={[{ key: 'count', name: 'Interventions', color: '#8b5cf6' }]} />
        </Card>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Update intervention" subtitle={edit && `${edit.employee?.full_name} · ${titleCase(edit.action_type)}`}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {edit && (
          <div className="space-y-3">
            <p className="rounded-lg bg-surface-2 p-3 text-sm">{edit.recommendation}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status"><Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} options={['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']} /></Field>
              <Field label="Follow-up date"><input type="date" className="input" value={edit.follow_up_date || ''} onChange={(e) => setEdit({ ...edit, follow_up_date: e.target.value })} /></Field>
            </div>
            <Field label="Notes"><Textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <Field label="Outcome"><Textarea value={edit.outcome || ''} onChange={(e) => setEdit({ ...edit, outcome: e.target.value })} placeholder="What changed after the action?" /></Field>
            <div className="flex items-center gap-2 text-xs text-muted">Risk at creation <Badge>{edit.risk_at_creation ?? '—'}%</Badge> · current <RiskBadge level={edit.employee?.risk_level} score={edit.employee?.risk_score} /></div>
          </div>
        )}
      </Modal>
      <Modal open={pick} onClose={() => setPick(false)} size="sm" title="Select employee"
        footer={<Button disabled={!pickId} onClick={() => { setCreate(Number(pickId)); setPick(false) }}>Continue</Button>}>
        <Select value={pickId} onChange={(e) => setPickId(e.target.value)} placeholder="Choose…" options={(people || []).map((p) => ({ value: p.id, label: p.label }))} />
      </Modal>
      <InterventionModal open={!!create} employeeId={create} onClose={() => setCreate(null)} onSaved={() => { reload(); reloadStats() }} />
    </>
  )
}
