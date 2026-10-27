import { useEffect, useState } from 'react'
import { KeyRound, Save, User } from 'lucide-react'
import api, { setTokens } from '../api/client'
import { Avatar, Badge, Button, Card, Field, Input, KeyValue, PageHeader, Select, fmtDate, fmtMoney } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useApi } from '../hooks/useApi'

export default function Profile() {
  const { user } = useAuth()
  const toast = useToast()
  const { data: emp, reload } = useApi(user.employee_id ? `/employees/${user.employee_id}` : null)
  const [form, setForm] = useState({ phone: '', address: '', marital_status: '' })
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' })
  useEffect(() => { if (emp) setForm({ phone: emp.phone || '', address: emp.address || '', marital_status: emp.marital_status || 'Single' }) }, [emp])

  const saveProfile = async () => {
    try { await api.patch('/employees/me/profile', form); toast.success('Profile updated'); reload() } catch (e) { toast.error('Update failed', e.message) }
  }
  const changePw = async () => {
    if (pw.new_password !== pw.confirm) return toast.error('Passwords do not match')
    try {
      const r = await api.post('/auth/change-password', { current_password: pw.current_password, new_password: pw.new_password })
      setTokens(r.data)
      setPw({ current_password: '', new_password: '', confirm: '' })
      toast.success('Password changed', 'Other sessions have been signed out.')
    } catch (e) { toast.error('Could not change password', e.message) }
  }
  return (
    <>
      <PageHeader title="My Profile" icon={User} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-5 flex items-center gap-4">
            <Avatar name={user.full_name} size="lg" />
            <div>
              <p className="text-lg font-bold">{user.full_name}</p>
              <p className="text-sm text-muted">{user.email}</p>
              <Badge tone="indigo" className="mt-1">{user.role}</Badge>
            </div>
          </div>
          {emp ? (
            <>
              <KeyValue items={[['Employee code', emp.employee_code], ['Department', emp.department], ['Job title', emp.job_title], ['Manager', emp.manager],
                ['Hire date', fmtDate(emp.hire_date)], ['Tenure', `${emp.tenure_years} years`], ['Monthly CTC', fmtMoney(emp.salary)], ['Status', emp.status]]} />
              <div className="mt-6 border-t border-line pt-4">
                <p className="mb-3 text-sm font-semibold">Editable details</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                  <Field label="Marital status"><Select value={form.marital_status} onChange={(e) => setForm({ ...form, marital_status: e.target.value })} options={['Single', 'Married', 'Divorced'].map((v) => ({ value: v, label: v }))} /></Field>
                  <Field label="Address"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
                </div>
                <Button className="mt-3" icon={Save} onClick={saveProfile}>Save changes</Button>
              </div>
            </>
          ) : <p className="text-sm text-muted">Your account is not linked to an employee record.</p>}
        </Card>
        <Card title="Change password" subtitle="Changing your password signs out other devices">
          <div className="space-y-3">
            <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
            <Field label="New password" hint="Min. 8 characters, letters and numbers"><Input type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
            <Field label="Confirm new password"><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
            <Button icon={KeyRound} className="w-full" onClick={changePw} disabled={!pw.current_password || !pw.new_password}>Update password</Button>
          </div>
        </Card>
      </div>
    </>
  )
}
