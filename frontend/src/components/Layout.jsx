import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, Bell, BrainCircuit, Building2, CalendarDays, CheckCheck, ChevronDown, Clock, Database, FileBarChart, FileText,
  HeartHandshake, KeyRound, LayoutDashboard, ListChecks, LogOut, Menu, MessageSquare, Moon, ScrollText, Search,
  ShieldAlert, Sparkles, Sun, Target, TrendingDown, TrendingUp, User, Users, Wallet, Wifi, WifiOff, X,
} from 'lucide-react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useRealtime } from '../context/RealtimeContext'
import { useDebounced } from '../hooks/useApi'
import { Avatar, Badge, RiskBadge, cx, timeAgo } from './ui'

const MGMT = ['ADMIN', 'HR', 'MANAGER']
const HR = ['ADMIN', 'HR']

const NAV = [
  { section: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/monitoring', label: 'Live Monitor', icon: Activity, roles: MGMT },
  ] },
  { section: 'Workforce', items: [
    { to: '/employees', label: 'Employees', icon: Users, roles: MGMT },
    { to: '/departments', label: 'Departments', icon: Building2, roles: MGMT },
    { to: '/attendance', label: 'Attendance', icon: Clock },
    { to: '/leaves', label: 'Leave', icon: CalendarDays },
    { to: '/payroll', label: 'Payroll', icon: Wallet },
    { to: '/documents', label: 'Documents', icon: FileText },
  ] },
  { section: 'AI Intelligence', roles: MGMT, items: [
    { to: '/ai/risk', label: 'Risk Monitor', icon: ShieldAlert },
    { to: '/ai/attrition', label: 'Attrition Analytics', icon: TrendingDown },
    { to: '/ai/forecasting', label: 'Forecast & Stability', icon: TrendingUp },
    { to: '/ai/interventions', label: 'Interventions', icon: HeartHandshake },
    { to: '/ai/recommendations', label: 'Recommendations', icon: Sparkles },
    { to: '/ai/datasets', label: 'Datasets & Models', icon: Database, roles: HR },
  ] },
  { section: 'Collaborate', items: [
    { to: '/tasks', label: 'Tasks', icon: ListChecks },
    { to: '/performance', label: 'Performance', icon: Target },
    { to: '/chat', label: 'Messages', icon: MessageSquare, badge: 'chat' },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'notif' },
  ] },
  { section: 'Administration', roles: MGMT, items: [
    { to: '/reports', label: 'Reports & Export', icon: FileBarChart },
    { to: '/audit', label: 'Audit Logs', icon: ScrollText, roles: HR },
    { to: '/users', label: 'Users & Roles', icon: KeyRound, roles: ['ADMIN'] },
  ] },
]

function Sidebar({ open, onClose }) {
  const { user } = useAuth()
  const { unread, chatUnread } = useRealtime()
  const allowed = (roles) => !roles || roles.includes(user.role)
  return (
    <>
      <div className={cx('fixed inset-0 z-30 bg-slate-950/40 lg:hidden', open ? 'block' : 'hidden')} onClick={onClose} />
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-surface transition-transform lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-16 items-center gap-2.5 border-b border-line px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md">
            <BrainCircuit className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold">WorkForce AI Pro</p>
            <p className="text-[10px] font-medium uppercase tracking-widest text-muted">Workforce Intelligence</p>
          </div>
          <button className="ml-auto lg:hidden" onClick={onClose} aria-label="Close menu"><X className="h-5 w-5 text-muted" /></button>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV.filter((s) => allowed(s.roles)).map((s) => (
            <div key={s.section}>
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted/80">{s.section}</p>
              <div className="space-y-0.5">
                {s.items.filter((i) => allowed(i.roles)).map((i) => {
                  const count = i.badge === 'chat' ? chatUnread : i.badge === 'notif' ? unread : 0
                  return (
                    <NavLink key={i.to} to={i.to} end={i.end} onClick={onClose}
                      className={({ isActive }) => cx('group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-2 hover:text-ink')}>
                      <i.icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="flex-1 truncate">{i.label}</span>
                      {count > 0 && <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{count > 99 ? '99+' : count}</span>}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <Link to="/profile" onClick={onClose} className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-2">
            <Avatar name={user.full_name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user.full_name}</p>
              <p className="truncate text-[11px] text-muted">{user.email}</p>
            </div>
            <Badge tone={{ ADMIN: 'purple', HR: 'indigo', MANAGER: 'blue', EMPLOYEE: 'gray' }[user.role]}>{user.role}</Badge>
          </Link>
        </div>
      </aside>
    </>
  )
}

function useClickOutside(ref, fn) {
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && fn()
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [ref, fn])
}

function GlobalSearch() {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [open, setOpen] = useState(false)
  const dq = useDebounced(q, 250)
  const ref = useRef(null)
  const nav = useNavigate()
  const { isMgmt } = useAuth()
  useClickOutside(ref, () => setOpen(false))
  useEffect(() => {
    if (dq.trim().length < 2) { setRes(null); return }
    api.get('/search', { params: { q: dq } }).then((r) => setRes(r.data)).catch(() => setRes(null))
  }, [dq])
  const go = (to) => { setOpen(false); setQ(''); nav(to) }
  const empty = res && !res.employees.length && !res.departments.length && !res.documents.length && !res.tasks.length
  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        placeholder="Search employees, departments, documents…" className="input h-9 pl-9" aria-label="Global search" />
      {open && res && (
        <div className="card absolute left-0 right-0 top-11 z-50 max-h-96 overflow-y-auto p-2 shadow-xl">
          {empty && <p className="p-3 text-center text-sm text-muted">No matches for “{dq}”</p>}
          {res.employees.length > 0 && <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase text-muted">Employees</p>}
          {res.employees.map((e) => (
            <button key={e.id} onClick={() => go(isMgmt ? `/employees/${e.id}` : '/profile')} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-2">
              <Avatar name={e.full_name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{e.full_name}</p>
                <p className="truncate text-xs text-muted">{e.employee_code} · {e.job_title} · {e.department}</p>
              </div>
              {isMgmt && e.risk_level && <RiskBadge level={e.risk_level} />}
            </button>
          ))}
          {res.departments.length > 0 && <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase text-muted">Departments</p>}
          {res.departments.map((d) => (
            <button key={d.id} onClick={() => go('/departments')} className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-surface-2">
              <Building2 className="h-4 w-4 text-muted" /> {d.name} <span className="text-xs text-muted">{d.code}</span>
            </button>
          ))}
          {res.documents.length > 0 && <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase text-muted">Documents</p>}
          {res.documents.map((d) => (
            <button key={d.id} onClick={() => go('/documents')} className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-surface-2">
              <FileText className="h-4 w-4 text-muted" /> {d.title}
            </button>
          ))}
          {res.tasks.length > 0 && <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase text-muted">Tasks</p>}
          {res.tasks.map((t) => (
            <button key={t.id} onClick={() => go('/tasks')} className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-surface-2">
              <ListChecks className="h-4 w-4 text-muted" /> {t.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NotificationBell() {
  const { unread, setUnread, subscribe } = useRealtime()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const ref = useRef(null)
  const nav = useNavigate()
  useClickOutside(ref, () => setOpen(false))
  const load = () => api.get('/notifications', { params: { size: 8 } }).then((r) => setItems(r.data.items)).catch(() => {})
  useEffect(() => { if (open) load() }, [open])
  useEffect(() => subscribe('notification', (n) => setItems((l) => [n, ...l].slice(0, 8))), [subscribe])
  const readAll = async () => { await api.post('/notifications/read-all'); setUnread(0); load() }
  const openItem = async (n) => {
    if (!n.is_read) { await api.post(`/notifications/${n.id}/read`); setUnread((c) => Math.max(0, c - 1)) }
    setOpen(false)
    if (n.link) nav(n.link)
  }
  const prioColor = { CRITICAL: 'bg-rose-600', HIGH: 'bg-rose-500', MEDIUM: 'bg-amber-500', LOW: 'bg-sky-500' }
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="card absolute right-0 top-12 z-50 w-[22rem] max-w-[calc(100vw-2rem)] shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <button onClick={readAll} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-500 hover:underline"><CheckCheck className="h-3.5 w-3.5" />Mark all read</button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!items.length && <p className="p-6 text-center text-sm text-muted">You're all caught up</p>}
            {items.map((n) => (
              <button key={n.id} onClick={() => openItem(n)} className={cx('flex w-full gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-surface-2', !n.is_read && 'bg-brand-soft/50')}>
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', prioColor[n.priority])} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium">{n.is_ai && <Sparkles className="h-3.5 w-3.5 text-violet-500" />}<span className="truncate">{n.title}</span></p>
                  <p className="line-clamp-2 text-xs text-muted">{n.message}</p>
                  <p className="mt-1 text-[10px] text-muted">{timeAgo(n.created_at)}</p>
                </div>
              </button>
            ))}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-line py-2.5 text-center text-xs font-semibold text-indigo-500 hover:bg-surface-2">View all</Link>
        </div>
      )}
    </div>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useClickOutside(ref, () => setOpen(false))
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-surface-2">
        <Avatar name={user.full_name} size="sm" />
        <ChevronDown className="hidden h-4 w-4 text-muted sm:block" />
      </button>
      {open && (
        <div className="card absolute right-0 top-12 z-50 w-56 p-1.5 shadow-xl">
          <div className="border-b border-line px-3 py-2">
            <p className="truncate text-sm font-semibold">{user.full_name}</p>
            <p className="truncate text-xs text-muted">{user.role}</p>
          </div>
          <Link to="/profile" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-surface-2"><User className="h-4 w-4" />My profile</Link>
          <button onClick={() => logout()} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-rose-500 hover:bg-surface-2"><LogOut className="h-4 w-4" />Sign out</button>
          <button onClick={() => logout(true)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-muted hover:bg-surface-2">Sign out of all devices</button>
        </div>
      )}
    </div>
  )
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = () => {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('wf_theme', next ? 'dark' : 'light') } catch { /* ignore */ }
    setDark(next)
  }
  return (
    <button onClick={toggle} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Toggle theme">
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  )
}

export default function Layout() {
  const [open, setOpen] = useState(false)
  const { connected } = useRealtime()
  const loc = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  return (
    <div className="min-h-full">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <span title={connected ? 'Real-time connected' : 'Reconnecting…'}
              className={cx('mr-1 hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex',
                connected ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-slate-500/10 text-muted')}>
              {connected ? <><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-500" /><Wifi className="h-3.5 w-3.5" />Live</> : <><WifiOff className="h-3.5 w-3.5" />Offline</>}
            </span>
            <ThemeToggle />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
