import { useEffect, useState } from 'react'
import { FlaskConical, HeartHandshake, RefreshCw, Sparkles } from 'lucide-react'
import api from '../api/client'
import { useApi } from '../hooks/useApi'
import { useToast } from '../context/ToastContext'
import { LinesChart } from './charts'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageLoader, RiskBadge, Select, StatusBadge, Textarea, cx, fmtDate, titleCase } from './ui'

const RISK_BG = { LOW: 'from-emerald-500 to-teal-500', MEDIUM: 'from-amber-500 to-orange-500', HIGH: 'from-rose-500 to-red-600', CRITICAL: 'from-rose-700 to-red-900' }

export function RiskGauge({ score, level, confidence }) {
  const pct = Math.max(0, Math.min(100, score || 0))
  const angle = (pct / 100) * 180
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 70" className="w-48">
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="var(--line)" strokeWidth="10" strokeLinecap="round" />
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="url(#rg)" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${(angle / 180) * 157} 157`} />
        <defs><linearGradient id="rg"><stop offset="0%" stopColor="#10b981" /><stop offset="50%" stopColor="#f59e0b" /><stop offset="100%" stopColor="#e11d48" /></linearGradient></defs>
        <text x="60" y="52" textAnchor="middle" className="fill-current text-ink" style={{ fontSize: 20, fontWeight: 700 }}>{Math.round(pct)}%</text>
        <text x="60" y="66" textAnchor="middle" style={{ fontSize: 7, fill: '#8a94a6' }}>probability of leaving (12m)</text>
      </svg>
      <div className="mt-1 flex items-center gap-2"><RiskBadge level={level} /><Badge tone="indigo">{Math.round(confidence)}% confidence</Badge></div>
    </div>
  )
}

export function InterventionModal({ open, onClose, employeeId, preset, onSaved }) {
  const toast = useToast()
  const { data: users } = useApi(open ? '/users/directory' : null)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setForm({ action_type: preset?.action_type || 'ONE_ON_ONE', recommendation: preset?.recommendation || '', notes: '', owner_id: '',
      follow_up_date: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) })
  }, [open, preset])
  const save = async () => {
    setBusy(true)
    try {
      await api.post('/ai/interventions', { ...form, employee_id: employeeId, owner_id: form.owner_id ? Number(form.owner_id) : null, follow_up_date: form.follow_up_date || null })
      toast.success('Intervention planned', titleCase(form.action_type))
      onSaved?.()
      onClose()
    } catch (e) { toast.error('Could not create intervention', e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Plan retention intervention"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save} icon={HeartHandshake}>Create</Button></>}>
      <div className="space-y-3">
        <Field label="Action type"><Select value={form.action_type} onChange={(e) => setForm({ ...form, action_type: e.target.value })}
          options={['ONE_ON_ONE', 'COMPENSATION_REVIEW', 'CAREER_PATH', 'WORKLOAD', 'TRAINING', 'RECOGNITION', 'FLEXIBLE_WORK']} /></Field>
        <Field label="Recommendation / plan"><Textarea value={form.recommendation} onChange={(e) => setForm({ ...form, recommendation: e.target.value })} required /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Owner"><Select value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })} placeholder="Me"
            options={(users || []).filter((u) => u.role !== 'EMPLOYEE').map((u) => ({ value: u.id, label: `${u.full_name} (${u.role})` }))} /></Field>
          <Field label="Follow-up date"><Input type="date" value={form.follow_up_date || ''} onChange={(e) => setForm({ ...form, follow_up_date: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

const SIM_FIELDS = [
  ['monthly_income', 'Monthly income (₹)', 1000], ['overtime_hours', 'Overtime hrs / month', 1], ['job_satisfaction', 'Job satisfaction (1-4)', 1],
  ['work_life_balance', 'Work-life balance (1-4)', 1], ['environment_satisfaction', 'Environment sat. (1-4)', 1],
  ['years_since_last_promotion', 'Years since promotion', 1], ['training_times_last_year', 'Trainings / year', 1], ['stock_option_level', 'Stock option level (0-3)', 1],
]

function Simulator({ employeeId }) {
  const toast = useToast()
  const [base, setBase] = useState(null)
  const [vals, setVals] = useState({})
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = async (changes) => {
    setBusy(true)
    try {
      const r = await api.post('/ai/simulate', { employee_id: employeeId, changes })
      setRes(r.data)
      if (!base) { setBase(r.data.features); setVals(Object.fromEntries(SIM_FIELDS.map(([k]) => [k, r.data.features[k]]))) }
    } catch (e) { toast.error('Simulation failed', e.message) } finally { setBusy(false) }
  }
  useEffect(() => { run({}) }, [employeeId]) // eslint-disable-line react-hooks/exhaustive-deps
  const changes = base ? Object.fromEntries(Object.entries(vals).filter(([k, v]) => Number(v) !== Number(base[k])).map(([k, v]) => [k, Number(v)])) : {}
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><FlaskConical className="h-4 w-4 text-violet-500" />What-if simulator</span>}
      subtitle="Adjust drivers to see how a retention action would change the predicted risk">
      {!base ? <PageLoader /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SIM_FIELDS.map(([k, label, step]) => (
              <Field key={k} label={label} hint={`current: ${base[k]}`}>
                <Input type="number" step={step} value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button icon={FlaskConical} loading={busy} onClick={() => run(changes)} disabled={!Object.keys(changes).length}>Simulate</Button>
            <Button variant="ghost" onClick={() => { setVals(Object.fromEntries(SIM_FIELDS.map(([k]) => [k, base[k]]))); run({}) }}>Reset</Button>
            {res && Object.keys(res.overrides).length > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <RiskBadge level={res.before.risk_level} score={res.before.risk_score} /> →
                <RiskBadge level={res.after.risk_level} score={res.after.risk_score} />
                <span className={cx('font-semibold', res.risk_change < 0 ? 'text-emerald-500' : 'text-rose-500')}>
                  {res.risk_change > 0 ? '+' : ''}{res.risk_change} pts
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  )
}

export default function RiskPanel({ employeeId, compact }) {
  const toast = useToast()
  const { data, loading, reload } = useApi(`/ai/predictions/employee/${employeeId}`)
  const [preset, setPreset] = useState(null)
  const [busy, setBusy] = useState(false)
  const rescore = async () => {
    setBusy(true)
    try { const r = await api.post('/ai/predict', { employee_ids: [employeeId] }); toast.success('Re-scored', `Batch ${r.data.batch_id}`); reload() }
    catch (e) { toast.error('Prediction failed', e.message) } finally { setBusy(false) }
  }
  if (loading && !data) return <PageLoader />
  if (!data) return null
  const p = data.latest
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Attrition risk" actions={<Button size="sm" variant="secondary" icon={RefreshCw} loading={busy} onClick={rescore}>Re-score</Button>}>
          {p ? (
            <>
              <RiskGauge score={p.risk_score} level={p.risk_level} confidence={p.confidence} />
              <p className="mt-3 text-center text-[11px] text-muted">Model v{p.model_version} · scored {fmtDate(p.created_at)}</p>
            </>
          ) : <EmptyState title="Not scored yet" action={<Button size="sm" onClick={rescore} loading={busy}>Run prediction</Button>} />}
        </Card>
        <Card title="Top risk drivers" subtitle="How much each factor adds versus a typical employee" className="lg:col-span-2">
          {p?.top_factors?.length ? (
            <ul className="space-y-3">
              {p.top_factors.map((f) => (
                <li key={f.feature}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{f.label}</span>
                    <span className="text-xs text-muted">value {f.value} · typical {f.baseline} · <b className="text-rose-500">+{f.impact} pts</b></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-500" style={{ width: `${Math.min(100, f.impact * 3)}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No significant risk drivers" description="This employee's profile is close to or better than the baseline." />}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-violet-500" />AI recommendations</span>}>
          {data.recommendations.length ? (
            <ul className="space-y-3">
              {data.recommendations.map((r) => (
                <li key={r.action_type} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><Badge tone={r.priority === 'HIGH' ? 'red' : r.priority === 'MEDIUM' ? 'amber' : 'gray'}>{r.priority}</Badge><span className="text-sm font-semibold">{titleCase(r.action_type)}</span></div>
                    <Button size="sm" variant="secondary" icon={HeartHandshake} onClick={() => setPreset(r)}>Plan</Button>
                  </div>
                  <p className="mt-1.5 text-sm text-muted">{r.recommendation}</p>
                  <p className="mt-1 text-[11px] text-muted">Driver: {r.factor} (+{r.impact} pts)</p>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No actions suggested" />}
        </Card>
        <Card title="Risk history">
          {data.history.length > 1
            ? <LinesChart data={data.history.map((h) => ({ ...h, date: fmtDate(h.created_at) }))} x="date" area height={200} lines={[{ key: 'risk_score', name: 'Risk %', color: '#ef4444' }]} />
            : <EmptyState title="Only one score so far" />}
          {data.interventions.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted">Interventions</p>
              {data.interventions.slice(0, 4).map((i) => (
                <div key={i.id} className="flex items-center justify-between py-1 text-sm"><span>{titleCase(i.action_type)}</span><StatusBadge status={i.status} /></div>
              ))}
            </div>
          )}
        </Card>
      </div>
      {!compact && <Simulator employeeId={employeeId} />}
      <InterventionModal open={!!preset} preset={preset} employeeId={employeeId} onClose={() => setPreset(null)} onSaved={reload} />
    </div>
  )
}
