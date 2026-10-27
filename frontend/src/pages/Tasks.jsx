import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlarmClock, CalendarClock, LayoutGrid, List, ListChecks, Plus, Trash2 } from 'lucide-react'
import api from '../api/client'
import {
  Badge, Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, StatCard, StatusBadge, Textarea, cx, fmtDate, titleCase,
} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useApi } from '../hooks/useApi'

const COLS = [['TODO', 'To do', 'border-t-slate-400'], ['IN_PROGRESS', 'In progress', 'border-t-sky-500'], ['BLOCKED', 'Blocked', 'border-t-rose-500'], ['DONE', 'Done', 'border-t-emerald-500']]
const PRIO = { LOW: 'gray', MEDIUM: 'blue', HIGH: 'amber', CRITICAL: 'red' }

export default function Tasks() {
  const { isMgmt, user } = useAuth()
  const toast = useToast()
  const [params] = useSearchParams()
  const [view, setView] = useState('board')
  const [f, setF] = useState({ workflow: '', priority: '', overdue: params.get('overdue') === '1', mine: !isMgmt, q: '' })
  const [form, setForm] = useState(null)
  const { data: stats, reload: reloadStats } = useApi('/tasks/stats')
  const { data, loading, reload } = useApi('/tasks', { ...f, overdue: f.overdue || undefined, mine: f.mine || undefined, size: 200 })
  const { data: people } = useApi(isMgmt ? '/employees/options' : null)
  const items = data?.items || []

  const move = async (t, status) => {
    try { await api.patch(`/tasks/${t.id}`, { status }); reload(); reloadStats() } catch (e) { toast.error('Update failed', e.message) }
  }
  const save = async () => {
    try {
      const body = { ...form, assignee_id: Number(form.assignee_id), due_date: form.due_date || null }
      if (form.id) await api.patch(`/tasks/${form.id}`, body)
      else await api.post('/tasks', body)
      toast.success('Task saved'); setForm(null); reload(); reloadStats()
    } catch (e) { toast.error('Could not save task', e.message) }
  }
  const remove = async () => { try { await api.delete(`/tasks/${form.id}`); setForm(null); reload(); reloadStats() } catch (e) { toast.error('Delete failed', e.message) } }
  const openTask = (t) => setForm(isMgmt ? { ...t } : null)

  return (
    <>
      <PageHeader title="Workflow & Task Management" icon={ListChecks} subtitle="HR tasks, onboarding/offboarding workflows and due-date monitoring"
        actions={<>
          <div className="flex rounded-lg border border-line p-0.5">
            <button onClick={() => setView('board')} className={cx('rounded-md p-1.5', view === 'board' && 'bg-surface-2')} aria-label="Board view"><LayoutGrid className="h-4 w-4" /></button>
            <button onClick={() => setView('list')} className={cx('rounded-md p-1.5', view === 'list' && 'bg-surface-2')} aria-label="List view"><List className="h-4 w-4" /></button>
          </div>
          {isMgmt && <Button icon={Plus} onClick={() => setForm({ title: '', description: '', assignee_id: '', priority: 'MEDIUM', workflow: 'GENERAL', due_date: '' })}>New task</Button>}
        </>} />
      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Open" value={(stats.by_status.TODO || 0) + (stats.by_status.IN_PROGRESS || 0) + (stats.by_status.BLOCKED || 0)} icon={ListChecks} />
          <StatCard label="Overdue" value={stats.overdue} icon={AlarmClock} tone="red" />
          <StatCard label="Due this week" value={stats.due_this_week} icon={CalendarClock} tone="amber" />
          <StatCard label="Completed" value={stats.by_status.DONE || 0} tone="green" />
        </div>
      )}
      <div className="my-4 flex flex-wrap items-center gap-2">
        <Input className="w-56" placeholder="Search tasks…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select className="w-auto" value={f.workflow} onChange={(e) => setF({ ...f, workflow: e.target.value })} placeholder="All workflows" options={['GENERAL', 'ONBOARDING', 'OFFBOARDING', 'REVIEW', 'RETENTION']} />
        <Select className="w-auto" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} placeholder="Any priority" options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']} />
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-indigo-600" checked={f.overdue} onChange={(e) => setF({ ...f, overdue: e.target.checked })} />Overdue</label>
        {isMgmt && user.employee_id && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-indigo-600" checked={f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked })} />Assigned to me</label>}
      </div>
      {view === 'board' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLS.map(([status, label, border]) => {
            const col = items.filter((t) => t.status === status)
            return (
              <div key={status} className={cx('card flex min-h-[300px] flex-col border-t-4', border)}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = Number(e.dataTransfer.getData('task')); const t = items.find((x) => x.id === id); if (t && t.status !== status) move(t, status) }}>
                <div className="flex items-center justify-between px-4 py-3"><p className="text-sm font-semibold">{label}</p><Badge>{col.length}</Badge></div>
                <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
                  {col.map((t) => (
                    <div key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData('task', String(t.id))} onClick={() => openTask(t)}
                      className={cx('cursor-grab rounded-lg border border-line bg-surface-2 p-3 shadow-sm hover:border-indigo-400', t.overdue && 'border-l-4 border-l-rose-500')}>
                      <p className="text-sm font-medium">{t.title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge tone={PRIO[t.priority]}>{t.priority}</Badge>
                        {t.workflow !== 'GENERAL' && <Badge tone="purple">{titleCase(t.workflow)}</Badge>}
                        {t.due_date && <span className={cx('text-[11px]', t.overdue ? 'font-semibold text-rose-500' : 'text-muted')}>{t.overdue ? 'Overdue · ' : 'Due '}{fmtDate(t.due_date)}</span>}
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted">{t.assignee}</p>
                      {!isMgmt && (
                        <Select className="mt-2 !py-1 text-xs" value={t.status} onClick={(e) => e.stopPropagation()} onChange={(e) => move(t, e.target.value)} options={COLS.map(([v, l]) => ({ value: v, label: l }))} />
                      )}
                    </div>
                  ))}
                  {!col.length && <p className="py-8 text-center text-xs text-muted">Drop tasks here</p>}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Card bodyClass="p-0">
          <DataTable loading={loading} rows={items} onRowClick={isMgmt ? openTask : undefined} empty={<EmptyState icon={ListChecks} title="No tasks" />} columns={[
            { key: 'title', label: 'Task', render: (t) => <span className="font-medium">{t.title}</span> }, { key: 'assignee', label: 'Assignee' },
            { key: 'workflow', label: 'Workflow', render: (t) => titleCase(t.workflow) }, { key: 'priority', label: 'Priority', render: (t) => <Badge tone={PRIO[t.priority]}>{t.priority}</Badge> },
            { key: 'due_date', label: 'Due', render: (t) => <span className={t.overdue ? 'font-semibold text-rose-500' : ''}>{fmtDate(t.due_date)}</span> },
            { key: 'status', label: 'Status', render: (t) => <StatusBadge status={t.status} /> }]} />
        </Card>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit task' : 'New task'}
        footer={<>{form?.id && <Button variant="ghost" icon={Trash2} onClick={remove} className="mr-auto text-rose-500">Delete</Button>}<Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button onClick={save} disabled={!form?.title || !form?.assignee_id}>Save</Button></>}>
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" className="sm:col-span-2"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Assignee"><Select value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })} placeholder="Select…" options={(people || []).map((p) => ({ value: p.id, label: p.label }))} /></Field>
            <Field label="Due date"><Input type="date" value={form.due_date || ''} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
            <Field label="Priority"><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']} /></Field>
            {form.id ? <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={COLS.map(([v]) => v)} /></Field>
              : <Field label="Workflow"><Select value={form.workflow} onChange={(e) => setForm({ ...form, workflow: e.target.value })} options={['GENERAL', 'ONBOARDING', 'OFFBOARDING', 'REVIEW', 'RETENTION']} /></Field>}
            <Field label="Description" className="sm:col-span-2"><Textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </>
  )
}
