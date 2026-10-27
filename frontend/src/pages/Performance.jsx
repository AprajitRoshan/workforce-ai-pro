import { useState } from 'react'
import { Plus, Star, Target } from 'lucide-react'
import api from '../api/client'
import { BarsChart, LinesChart } from '../components/charts'
import {
  Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, ProgressBar, Select, StatCard, StatusBadge, Tabs, Textarea, fmtDate,
} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useApi } from '../hooks/useApi'

const Stars = ({ value }) => (
  <span className="inline-flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={`h-3.5 w-3.5 ${i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-line'}`} />)}
    <span className="ml-1 text-xs font-semibold">{value}</span>
  </span>
)

export default function Performance() {
  const { isMgmt, user } = useAuth()
  const [tab, setTab] = useState(isMgmt ? 'reviews' : 'mine')
  return (
    <>
      <PageHeader title="Performance Reviews" icon={Target} subtitle="Ratings, review history and goal tracking" />
      <Tabs value={tab} onChange={setTab} tabs={[user.employee_id && { value: 'mine', label: 'My performance' }, isMgmt && { value: 'reviews', label: 'Team reviews' }, isMgmt && { value: 'insights', label: 'Insights' }]} />
      {tab === 'mine' && <Mine />}
      {tab === 'reviews' && <Reviews />}
      {tab === 'insights' && <Insights />}
    </>
  )
}

function Mine() {
  const toast = useToast()
  const { user } = useAuth()
  const { data: reviews } = useApi('/reviews', { employee_id: user.employee_id, size: 20 })
  const { data: goals, reload } = useApi('/goals')
  const [goal, setGoal] = useState(null)
  const saveGoal = async () => {
    try {
      if (goal.id) await api.patch(`/goals/${goal.id}`, { title: goal.title, progress: Number(goal.progress), target_date: goal.target_date || null, status: goal.status })
      else await api.post('/goals', { ...goal, employee_id: user.employee_id, progress: Number(goal.progress), target_date: goal.target_date || null })
      toast.success('Goal saved'); setGoal(null); reload()
    } catch (e) { toast.error('Could not save goal', e.message) }
  }
  const items = reviews?.items || []
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {items.length > 1 && <Card title="Rating trend"><LinesChart data={[...items].reverse()} x="period" height={180} lines={[{ key: 'rating', name: 'Rating' }]} /></Card>}
        <Card title="Review history" bodyClass="p-0">
          {!items.length ? <EmptyState icon={Star} title="No reviews yet" /> : (
            <ul className="divide-y divide-line">
              {items.map((r) => (
                <li key={r.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{r.period}</p><Stars value={r.rating} /></div>
                  <p className="text-xs text-muted">Reviewed by {r.reviewer} · {fmtDate(r.created_at)}</p>
                  <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    <p><span className="text-xs font-semibold uppercase text-emerald-600">Strengths</span><br />{r.strengths || '—'}</p>
                    <p><span className="text-xs font-semibold uppercase text-amber-600">Improve</span><br />{r.improvements || '—'}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="My goals" actions={<Button size="sm" icon={Plus} onClick={() => setGoal({ title: '', description: '', progress: 0, target_date: '' })}>Add</Button>}>
        {!goals?.length ? <EmptyState icon={Target} title="No goals yet" /> : goals.map((g) => (
          <button key={g.id} onClick={() => setGoal({ ...g })} className="mb-3 block w-full rounded-lg p-2 text-left hover:bg-surface-2">
            <div className="mb-1 flex items-center justify-between gap-2 text-sm"><span className="font-medium">{g.title}</span><StatusBadge status={g.status} /></div>
            <ProgressBar value={g.progress} tone={g.progress === 100 ? 'green' : 'indigo'} />
            <p className="mt-1 text-[11px] text-muted">{g.progress}% · target {fmtDate(g.target_date)}</p>
          </button>
        ))}
      </Card>
      <Modal open={!!goal} onClose={() => setGoal(null)} title={goal?.id ? 'Update goal' : 'New goal'} footer={<><Button variant="secondary" onClick={() => setGoal(null)}>Cancel</Button><Button onClick={saveGoal} disabled={!goal?.title}>Save</Button></>}>
        {goal && (
          <div className="space-y-3">
            <Field label="Goal"><Input value={goal.title} onChange={(e) => setGoal({ ...goal, title: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Progress: ${goal.progress}%`}><input type="range" min={0} max={100} step={5} value={goal.progress} onChange={(e) => setGoal({ ...goal, progress: e.target.value })} className="w-full accent-indigo-600" /></Field>
              <Field label="Target date"><Input type="date" value={goal.target_date || ''} onChange={(e) => setGoal({ ...goal, target_date: e.target.value })} /></Field>
            </div>
            {goal.id && <Field label="Status"><Select value={goal.status} onChange={(e) => setGoal({ ...goal, status: e.target.value })} options={['ACTIVE', 'ACHIEVED', 'MISSED']} /></Field>}
          </div>
        )}
      </Modal>
    </div>
  )
}

function Reviews() {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [period, setPeriod] = useState('')
  const { data, loading, reload } = useApi('/reviews', { period, page, size: 15 })
  const { data: people } = useApi('/employees/options')
  const [form, setForm] = useState(null)
  const save = async () => {
    try {
      await api.post('/reviews', { ...form, employee_id: Number(form.employee_id), rating: Number(form.rating), quality: Number(form.quality), productivity: Number(form.productivity), teamwork: Number(form.teamwork) })
      toast.success('Review published', 'The employee has been notified.'); setForm(null); reload()
    } catch (e) { toast.error('Could not save review', e.message) }
  }
  const score = (k) => <Field label={k[0].toUpperCase() + k.slice(1)}><Select value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} options={[1, 2, 3, 4, 5].map((v) => ({ value: v, label: `${v}` }))} /></Field>
  return (
    <Card bodyClass="p-0" actions={<><Input className="w-32" placeholder="Period" value={period} onChange={(e) => setPeriod(e.target.value)} /><Button size="sm" icon={Plus} onClick={() => setForm({ employee_id: '', period: `${new Date().getFullYear()}-H${new Date().getMonth() < 6 ? 1 : 2}`, rating: 3, quality: 3, productivity: 3, teamwork: 3, strengths: '', improvements: '', comments: '' })}>New review</Button></>} title="Reviews">
      <DataTable loading={loading} rows={data?.items} page={data} onPage={setPage} columns={[
        { key: 'employee', label: 'Employee', render: (r) => <span className="font-medium">{r.employee}</span> }, { key: 'period', label: 'Period' },
        { key: 'rating', label: 'Rating', render: (r) => <Stars value={r.rating} /> }, { key: 'reviewer', label: 'Reviewer' },
        { key: 'strengths', label: 'Strengths', render: (r) => <span className="line-clamp-1 text-xs">{r.strengths}</span> }, { key: 'created_at', label: 'Date', render: (r) => fmtDate(r.created_at) }]} />
      <Modal open={!!form} onClose={() => setForm(null)} size="lg" title="New performance review" footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button onClick={save} disabled={!form?.employee_id}>Publish</Button></>}>
        {form && (
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Employee" className="sm:col-span-3"><Select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} placeholder="Select…" options={(people || []).map((p) => ({ value: p.id, label: p.label }))} /></Field>
            <Field label="Period"><Input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} /></Field>
            <Field label="Overall rating"><Select value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} options={[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((v) => ({ value: v, label: `${v}` }))} /></Field>
            {score('quality')}{score('productivity')}{score('teamwork')}
            <Field label="Strengths" className="sm:col-span-2"><Textarea value={form.strengths} onChange={(e) => setForm({ ...form, strengths: e.target.value })} /></Field>
            <Field label="Areas to improve" className="sm:col-span-2"><Textarea value={form.improvements} onChange={(e) => setForm({ ...form, improvements: e.target.value })} /></Field>
            <Field label="Comments" className="sm:col-span-4"><Textarea value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Card>
  )
}

function Insights() {
  const { data } = useApi('/reviews/stats')
  if (!data) return null
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active goals" value={data.goals.ACTIVE || 0} />
        <StatCard label="Achieved goals" value={data.goals.ACHIEVED || 0} tone="green" />
        <StatCard label="Avg goal progress" value={`${data.avg_goal_progress}%`} tone="purple" />
        <StatCard label="Review periods" value={data.by_period.length} tone="blue" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Rating distribution"><BarsChart data={data.distribution} x="rating" height={220} bars={[{ key: 'count', name: 'Reviews', color: '#f59e0b' }]} /></Card>
        <Card title="Average rating by department"><BarsChart data={data.by_department} x="department" layout="vertical" height={220} bars={[{ key: 'avg_rating', name: 'Avg rating' }]} /></Card>
      </div>
    </>
  )
}
