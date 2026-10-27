import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

const ToastContext = createContext(null)
const STYLES = {
  success: ['border-l-emerald-500', CheckCircle2, 'text-emerald-500'],
  error: ['border-l-rose-500', XCircle, 'text-rose-500'],
  warning: ['border-l-amber-500', AlertTriangle, 'text-amber-500'],
  info: ['border-l-indigo-500', Info, 'text-indigo-500'],
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback((type, title, message, ms = 4500) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t.slice(-4), { id, type, title, message }])
    if (ms) setTimeout(() => dismiss(id), ms)
  }, [dismiss])

  const api = useMemo(() => ({
    success: (title, msg) => push('success', title, msg),
    error: (title, msg) => push('error', title, msg, 7000),
    warning: (title, msg) => push('warning', title, msg),
    info: (title, msg) => push('info', title, msg),
  }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
        {toasts.map((t) => {
          const [border, Icon, color] = STYLES[t.type]
          return (
            <div key={t.id} className={`card animate-slide-in flex items-start gap-3 border-l-4 ${border} p-3 shadow-lg`}>
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${color}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.message && <p className="mt-0.5 text-xs text-muted break-words">{t.message}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-muted hover:text-ink" aria-label="Dismiss"><X className="h-4 w-4" /></button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
