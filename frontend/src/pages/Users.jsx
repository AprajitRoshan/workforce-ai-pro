import { useState } from 'react'
import { KeyRound, Plus, ShieldCheck } from 'lucide-react'
import api from '../api/client'
import { Avatar, Badge, Button, Card, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, fmtDateTime } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useApi, useDebounced } from '../hooks/useApi'

export default function Users() {
  const { user: me } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState('users')
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [page, setPage] = useState(1)
  const [edit, setEdit] = useState(null)
  const dq = useDebounced(q)
  const { data, loading, reload } = useApi('/users', { q: dq, role, page, size: 20 })
  const { data: roles } = useApi('/users/roles')
  const { data: people } = useApi('/employees/options', { active_only: false })

  const save = async () => {
    try {
      const body = { full_name: edit.full_name, role: edit.role, employee_id: edit.employee_id ? Number(edit.employee_id) : null }
      if (edit.id) await api.patch(`/users/${edit.id}`, { ...body, is_active: edit.is_active })
      else await api.post('/users', { ...body, email: edit.email, password: edit.password })
      toast.success('User saved', edit.id && 'Role changes force the user to sign in again.'); setEdit(null); reload()
    } catch (e) { toast.error('Could not save user', e.message) }
  }
  return (
    <>
      <PageHeader title="Users & Roles" icon={KeyRound} subtitle="Role-based access control (RBAC)" actions={<Button icon={Plus} onClick={() => setEdit({ full_name: '', email: '', password: '', role: 'EMPLOYEE', employee_id: '', is_active: true })}>New user</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'users', label: 'Users' }, { value: 'roles', label: 'Role permissions', icon: ShieldCheck }]} />
      {tab === 'users' ? (
        <Card bodyClass="p-0">
          <div className="flex flex-wrap gap-2 border-b border-line p-3">
            <Input className="w-60" placeholder="Search name or email…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
            <Select className="w-auto" value={role} onChange={(e) => { setRole(e.target.value); setPage(1) }} placeholder="All roles" options={['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE']} />
          </div>
          <DataTable loading={loading} rows={data?.items} page={data} onPage={setPage} onRowClick={(u) => setEdit({ ...u, employee_id: u.employee_id || '' })} columns={[
            { key: 'full_name', label: 'User', render: (u) => <div className="flex items-center gap-2"><Avatar name={u.full_name} size="sm" /><div><p className="font-medium">{u.full_name}{u.id === me.id && <span className="text-xs text-muted"> (you)</span>}</p><p className="text-xs text-muted">{u.email}</p></div></div> },
            { key: 'role', label: 'Role', render: (u) => <StatusBadge status={u.role} label={u.role} /> },
            { key: 'employee_id', label: 'Linked employee', render: (u) => (u.employee_id ? <Badge tone="green">#{u.employee_id}</Badge> : <span className="text-xs text-muted">—</span>) },
            { key: 'is_active', label: 'Status', render: (u) => <StatusBadge status={u.is_active ? 'ACTIVE' : 'CANCELLED'} label={u.is_active ? 'Active' : 'Disabled'} /> },
            { key: 'last_login', label: 'Last login', render: (u) => <span className="text-xs">{fmtDateTime(u.last_login)}</span> }]} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(roles || []).map((r) => (
            <Card key={r.role} title={<StatusBadge status={r.role} label={r.role} />}>
              <div className="flex flex-wrap gap-1.5">{r.permissions.map((p) => <code key={p} className="rounded bg-surface-2 px-2 py-0.5 text-xs">{p}</code>)}</div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit user' : 'New user'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name"><Input value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={edit.email} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            {!edit.id && <Field label="Initial password" hint="Min. 8 chars with letters and numbers" className="sm:col-span-2"><Input type="password" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>}
            <Field label="Role"><Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} options={['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE']} disabled={edit.id === me.id} /></Field>
            <Field label="Linked employee"><Select value={edit.employee_id} onChange={(e) => setEdit({ ...edit, employee_id: e.target.value })} placeholder="None" options={(people || []).map((p) => ({ value: p.id, label: p.label }))} /></Field>
            {edit.id && edit.id !== me.id && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="accent-indigo-600" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Account active</label>}
          </div>
        )}
      </Modal>
    </>
  )
}
