import { useEffect } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Inbox, Loader2, X } from 'lucide-react'

export const cx = (...c) => c.filter(Boolean).join(' ')

export const fmtMoney = (v, digits = 0) =>
  v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: digits })}`
export const fmtNum = (v, d = 0) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d }))
export const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
export const fmtTime = (v) => (v ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—')
export const fmtDateTime = (v) => (v ? `${fmtDate(v)}, ${fmtTime(v)}` : '—')
export function timeAgo(v) {
  if (!v) return ''
  const s = (Date.now() - new Date(v).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`
  return fmtDate(v)
}
export const titleCase = (s) => (s || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

// ------------------------------------------------------------------ primitives
const BTN = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  ghost: 'text-muted hover:text-ink hover:bg-surface-2',
  danger: 'bg-rose-600 text-white hover:bg-rose-500',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500',
}
export function Button({ variant = 'primary', size = 'md', loading, icon: Icon, className, children, ...p }) {
  const sz = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : size === 'lg' ? 'px-5 py-2.5 text-sm' : 'px-3.5 py-2 text-sm'
  return (
    <button
      {...p}
      disabled={loading || p.disabled}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60', BTN[variant], sz, className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      {children}
    </button>
  )
}

export function Card({ title, subtitle, actions, className, bodyClass, children }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClass)}>{children}</div>
    </section>
  )
}

const TONES = {
  gray: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300',
  green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  red: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  blue: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  purple: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
}
export function Badge({ tone = 'gray', children, className, dot }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

const STATUS_TONE = {
  ACTIVE: 'green', PRESENT: 'green', APPROVED: 'green', PAID: 'green', DONE: 'green', COMPLETED: 'green', ACHIEVED: 'green', TRAINED: 'green', VALIDATED: 'blue',
  PENDING: 'amber', LATE: 'amber', IN_PROGRESS: 'blue', OPEN: 'indigo', TODO: 'gray', GENERATED: 'indigo', HALF_DAY: 'amber', ON_LEAVE: 'purple',
  REJECTED: 'red', ABSENT: 'red', TERMINATED: 'red', BLOCKED: 'red', CANCELLED: 'gray', RESIGNED: 'gray', MISSED: 'red', REJECTED_DS: 'red',
  LOW: 'green', MEDIUM: 'amber', HIGH: 'red', CRITICAL: 'red', STABLE: 'green', WATCH: 'amber', UNSTABLE: 'red',
  ADMIN: 'purple', HR: 'indigo', MANAGER: 'blue', EMPLOYEE: 'gray',
}
export const StatusBadge = ({ status, label }) => status ? <Badge tone={STATUS_TONE[status] || 'gray'}>{label || titleCase(status)}</Badge> : <span className="text-muted">—</span>

export function RiskBadge({ level, score }) {
  if (!level) return <span className="text-xs text-muted">Not scored</span>
  const tone = { LOW: 'green', MEDIUM: 'amber', HIGH: 'red', CRITICAL: 'red' }[level]
  return (
    <Badge tone={tone} className={level === 'CRITICAL' ? 'ring-1 ring-rose-500/40' : ''} dot>
      {titleCase(level)}{score !== undefined && score !== null ? ` · ${Math.round(score)}%` : ''}
    </Badge>
  )
}

export function Avatar({ name = '?', size = 'md', online }) {
  const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  const hues = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-sky-500', 'bg-violet-500', 'bg-teal-500']
  const hue = hues[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length]
  const sz = size === 'sm' ? 'h-7 w-7 text-[10px]' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-9 w-9 text-xs'
  return (
    <span className="relative inline-flex shrink-0">
      <span className={cx('inline-flex items-center justify-center rounded-full font-semibold text-white', hue, sz)}>{initials}</span>
      {online !== undefined && (
        <span className={cx('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface', online ? 'bg-emerald-500' : 'bg-slate-400')} />
      )}
    </span>
  )
}

export function Spinner({ className }) {
  return <Loader2 className={cx('h-5 w-5 animate-spin text-indigo-500', className)} />
}

export function PageLoader() {
  return <div className="flex h-64 items-center justify-center"><Spinner className="h-7 w-7" /></div>
}

export function EmptyState({ icon: Icon = Inbox, title = 'Nothing here yet', description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <div className="mb-3 rounded-full bg-surface-2 p-3"><Icon className="h-6 w-6 text-muted" /></div>
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400">
      {message}
      {onRetry && <button onClick={onRetry} className="ml-2 font-semibold underline">Retry</button>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, icon: Icon }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && <div className="rounded-xl bg-brand-soft p-2.5 text-brand"><Icon className="h-5 w-5" /></div>}
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

const STAT_TONES = {
  indigo: 'bg-indigo-500/10 text-indigo-500', green: 'bg-emerald-500/10 text-emerald-500', amber: 'bg-amber-500/10 text-amber-500',
  red: 'bg-rose-500/10 text-rose-500', blue: 'bg-sky-500/10 text-sky-500', purple: 'bg-violet-500/10 text-violet-500',
}
export function StatCard({ label, value, sub, icon: Icon, tone = 'indigo', trend, loading }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">{label}</p>
          {loading ? <div className="skeleton mt-2 h-7 w-20" /> : <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>}
        </div>
        {Icon && <div className={cx('rounded-lg p-2', STAT_TONES[tone])}><Icon className="h-5 w-5" /></div>}
      </div>
      {(sub || trend !== undefined) && (
        <p className="mt-2 text-xs text-muted">
          {trend !== undefined && <span className={cx('mr-1 font-semibold', trend >= 0 ? 'text-emerald-500' : 'text-rose-500')}>{trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}%</span>}
          {sub}
        </p>
      )}
    </div>
  )
}

export function ProgressBar({ value = 0, tone = 'indigo', className }) {
  const c = { indigo: 'bg-indigo-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500' }[tone]
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-line', className)}>
      <div className={cx('h-full rounded-full transition-all', c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

// ------------------------------------------------------------------ forms
export function Field({ label, error, hint, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] text-rose-500">{error}</span>}
    </label>
  )
}
export const Input = (p) => <input {...p} className={cx('input', p.className)} />
export const Textarea = (p) => <textarea rows={3} {...p} className={cx('input', p.className)} />
export function Select({ options = [], placeholder, className, ...p }) {
  return (
    <select {...p} className={cx('input pr-8', className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'object'
        ? <option key={o.value} value={o.value}>{o.label}</option>
        : <option key={o} value={o}>{titleCase(o)}</option>))}
    </select>
  )
}

// ------------------------------------------------------------------ overlays
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size]
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-[2px] sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={cx('card animate-slide-in my-8 w-full shadow-2xl', w)} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, loading, onConfirm, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.filter(Boolean).map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={cx('-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            value === t.value ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300' : 'border-transparent text-muted hover:text-ink')}>
          {t.icon && <t.icon className="h-4 w-4" />}
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-[10px] ring-1 ring-line">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ advanced table
export function DataTable({ columns, rows, loading, rowKey = 'id', sort, onSort, onRowClick, empty, page, onPage, dense, footer }) {
  const items = rows || []
  return (
    <div className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
              {columns.map((c) => (
                <th key={c.key} className={cx('whitespace-nowrap px-4 py-2.5 font-semibold', c.align === 'right' && 'text-right', c.className)}>
                  {c.sortable && onSort ? (
                    <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => onSort(c.sortKey || c.key)}>
                      {c.label}
                      {sort?.by === (c.sortKey || c.key) ? (sort.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ChevronDown className="h-3 w-3 opacity-30" />}
                    </button>
                  ) : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !items.length
              ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {columns.map((c) => <td key={c.key} className="px-4 py-3"><div className="skeleton h-4 w-3/4" /></td>)}
                </tr>
              ))
              : items.map((r, i) => (
                <tr key={r[rowKey] ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cx('border-b border-line last:border-0 transition-colors', onRowClick && 'cursor-pointer hover:bg-surface-2', loading && 'opacity-60')}>
                  {columns.map((c) => (
                    <td key={c.key} className={cx(dense ? 'px-4 py-2' : 'px-4 py-3', c.align === 'right' && 'text-right tabular-nums', c.tdClass)}>
                      {c.render ? c.render(r) : (r[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!loading && !items.length && (empty || <EmptyState />)}
      {footer}
      {page && page.pages > 1 && <Pagination page={page.page} pages={page.pages} total={page.total} onPage={onPage} />}
    </div>
  )
}

export function Pagination({ page, pages, total, onPage }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-muted">
      <span>{fmtNum(total)} result{total === 1 ? '' : 's'}</span>
      <div className="flex items-center gap-1">
        <button className="rounded-md p-1.5 hover:bg-surface-2 disabled:opacity-30" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
        <span className="px-2">Page {page} of {pages}</span>
        <button className="rounded-md p-1.5 hover:bg-surface-2 disabled:opacity-30" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  )
}

export function KeyValue({ items }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{k}</dt>
          <dd className="mt-0.5 truncate text-sm">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
