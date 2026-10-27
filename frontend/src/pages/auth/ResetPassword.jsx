import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import api from '../../api/client'
import { Button, Field, Input } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import AuthShell from './AuthShell'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const toast = useToast()
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const token = params.get('token') || ''

  const submit = async (e) => {
    e.preventDefault()
    if (form.password !== form.confirm) return setError('Passwords do not match')
    setBusy(true)
    setError('')
    try {
      await api.post('/auth/reset-password', { token, new_password: form.password })
      toast.success('Password updated', 'Please sign in with your new password.')
      nav('/login')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Reset links expire after 30 minutes.">
      {!token ? (
        <p className="text-sm text-rose-500">This reset link is missing its token. <Link className="underline" to="/forgot-password">Request a new one</Link>.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-500">{error}</div>}
          <Field label="New password" hint="Min. 8 characters, letters and numbers">
            <Input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" />
          </Field>
          <Button type="submit" loading={busy} icon={KeyRound} className="w-full" size="lg">Update password</Button>
        </form>
      )}
    </AuthShell>
  )
}
