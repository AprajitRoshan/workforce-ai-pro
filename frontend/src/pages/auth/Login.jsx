import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn } from 'lucide-react'
import { Button, Field, Input } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import AuthShell from './AuthShell'

// Local demo accounts created by backend/seed.py — only offered in the dev server.
const DEMO = import.meta.env.DEV ? [
  ['Admin', 'admin@workforce.ai', 'Admin@123'], ['HR', 'hr@workforce.ai', 'Hr@12345'],
  ['Manager', 'manager@workforce.ai', 'Manager@123'], ['Employee', 'employee@workforce.ai', 'Employee@123'],
] : []

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(form.email.trim(), form.password)
      nav(loc.state?.from || '/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your workspace">
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">{error}</div>}
        <Field label="Work email">
          <Input type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" />
        </Field>
        <Field label="Password">
          <div className="relative">
            <Input type={show ? 'text' : 'password'} autoComplete="current-password" required value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} className="pr-10" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" aria-label="Toggle password visibility">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <div className="flex justify-end"><Link to="/forgot-password" className="text-xs font-medium text-indigo-500 hover:underline">Forgot password?</Link></div>
        <Button type="submit" loading={busy} icon={LogIn} className="w-full" size="lg">Sign in</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">New here? <Link to="/register" className="font-semibold text-indigo-500 hover:underline">Create an account</Link></p>
      {DEMO.length > 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-line p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Demo accounts (dev only)</p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO.map(([label, email, password]) => (
              <button key={label} type="button" onClick={() => setForm({ email, password })}
                className="rounded-lg border border-line px-3 py-2 text-left text-xs hover:border-indigo-400 hover:bg-brand-soft">
                <span className="block font-semibold">{label}</span><span className="block truncate text-muted">{email}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthShell>
  )
}
