import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck, Send } from 'lucide-react'
import api from '../../api/client'
import { Button, Field, Input } from '../../components/ui'
import AuthShell from './AuthShell'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { data } = await api.post('/auth/forgot-password', { email })
      setDone(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Reset your password" subtitle="We'll send a reset link to your email.">
      {done ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
            <MailCheck className="h-5 w-5 shrink-0 text-emerald-500" />
            <p>{done.message}</p>
          </div>
          {done.dev_reset_token && (
            <div className="rounded-xl border border-dashed border-line p-4 text-sm">
              <p className="font-semibold">Development mode</p>
              <p className="mt-1 text-xs text-muted">No mail server is configured, so here is the reset link directly:</p>
              <Link className="mt-2 inline-block font-semibold text-indigo-500 hover:underline" to={`/reset-password?token=${encodeURIComponent(done.dev_reset_token)}`}>Open reset link →</Link>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-500">{error}</div>}
          <Field label="Work email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button type="submit" loading={busy} icon={Send} className="w-full" size="lg">Send reset link</Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm"><Link to="/login" className="font-semibold text-indigo-500 hover:underline">Back to sign in</Link></p>
    </AuthShell>
  )
}
