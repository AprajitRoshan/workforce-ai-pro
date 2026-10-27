import { useEffect, useState } from 'react'
import { Clock, LogIn, LogOut } from 'lucide-react'
import api from '../api/client'
import { useApi } from '../hooks/useApi'
import { useToast } from '../context/ToastContext'
import { Button, StatusBadge, fmtTime } from './ui'

export default function CheckInCard({ onChange }) {
  const { data, reload, loading } = useApi('/attendance/today')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])

  if (loading && !data) return <div className="card h-40 p-5"><div className="skeleton h-full w-full" /></div>
  if (!data?.linked) return null
  const rec = data.record
  const act = async (kind) => {
    setBusy(true)
    try {
      const r = await api.post(`/attendance/${kind}`)
      toast.success(kind === 'check-in' ? 'Checked in' : 'Checked out',
        kind === 'check-in' ? `Status: ${r.data.status.toLowerCase()} · ${fmtTime(r.data.check_in)}` : `${r.data.hours_worked}h worked today`)
      reload()
      onChange?.()
    } catch (e) {
      toast.error('Attendance', e.message)
    } finally {
      setBusy(false)
    }
  }
  const elapsed = rec?.check_in && !rec.check_out ? (now - new Date(rec.check_in)) / 3600000 : null

  return (
    <div className="card overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-indigo-100">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
            <p className="mt-1 text-xs text-indigo-100"><Clock className="mr-1 inline h-3.5 w-3.5" />{data.shift.name} shift · {data.shift.start}–{data.shift.end}</p>
          </div>
          {!rec?.check_in && <Button variant="secondary" size="lg" loading={busy} icon={LogIn} onClick={() => act('check-in')} className="!bg-white !text-indigo-700">Check in</Button>}
          {rec?.check_in && !rec.check_out && <Button variant="secondary" size="lg" loading={busy} icon={LogOut} onClick={() => act('check-out')} className="!bg-white !text-indigo-700">Check out</Button>}
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-line text-center">
        <div className="p-3"><p className="text-[11px] text-muted">Check in</p><p className="font-semibold">{fmtTime(rec?.check_in)}</p></div>
        <div className="p-3"><p className="text-[11px] text-muted">Check out</p><p className="font-semibold">{fmtTime(rec?.check_out)}</p></div>
        <div className="p-3"><p className="text-[11px] text-muted">{elapsed !== null ? 'Elapsed' : 'Status'}</p>
          {elapsed !== null ? <p className="font-semibold tabular-nums">{Math.floor(elapsed)}h {Math.floor((elapsed % 1) * 60)}m</p>
            : rec ? <StatusBadge status={rec.status} /> : <p className="text-sm text-muted">Not in</p>}
        </div>
      </div>
    </div>
  )
}
