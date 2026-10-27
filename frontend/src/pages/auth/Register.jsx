import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { Button, Field, Input } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import AuthShell from './AuthShell'

export default function Register() {
  const { register } = useAuth()
  const nav = useNavigate()
  const [form, setForm] = useState({ full_name: '', email: '', password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pwOk = form.password.length >= 8 && /\d/.test(form.password) && /[a-z]/i.test(form.password)

  const submit = async (e) => {
    e.preventDefault()
    if (form.password !== form.confirm) return setError('Passwords do not match')
    if (!pwOk) return setError('Password must be at least 8 characters with letters and numbers')
    setBusy(true)
    setError('')
    try {
      await register({ full_name: form.full_name, email: form.email, password: form.password })
      nav('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <AuthShell title="Create your account" subtitle="If your HR record uses the same email, it will be linked automatically.">
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">{error}</div>}
        <Field label="Full name"><Input required value={form.full_name} onChange={set('full_name')} /></Field>
        <Field label="Work email"><Input type="email" required value={form.email} onChange={set('email')} /></Field>
        <Field label="Password" hint="Min. 8 characters, letters and numbers"
          error={form.password && !pwOk ? 'Too weak' : ''}>
          <Input type="password" required value={form.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" error={form.confirm && form.confirm !== form.password ? 'Does not match' : ''}>
          <Input type="password" required value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
        </Field>
        <Button type="submit" loading={busy} icon={UserPlus} className="w-full" size="lg">Create account</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">Already registered? <Link to="/login" className="font-semibold text-indigo-500 hover:underline">Sign in</Link></p>
    </AuthShell>
  )
}
