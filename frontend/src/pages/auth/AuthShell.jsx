import { BrainCircuit, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react'

export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-violet-400/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="rounded-xl bg-white/15 p-2.5"><BrainCircuit className="h-6 w-6" /></div>
          <span className="text-lg font-bold">WorkForce AI Pro</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <h2 className="text-3xl font-bold leading-tight">Predict attrition before it happens.</h2>
          <p className="mt-3 text-indigo-100">One platform for HR operations and AI workforce intelligence: risk scores, forecasting, and retention actions.</p>
          <ul className="mt-8 space-y-4 text-sm">
            {[[Sparkles, 'Explainable AI risk scores with confidence and top drivers'], [TrendingUp, '12-month workforce & retention forecasting'],
              [ShieldCheck, 'Role-based access, audit trails and secure JWT sessions']].map(([Icon, t]) => (
              <li key={t} className="flex items-center gap-3"><span className="rounded-lg bg-white/15 p-1.5"><Icon className="h-4 w-4" /></span>{t}</li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-indigo-200">© {new Date().getFullYear()} WorkForce AI Pro</p>
      </div>
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="rounded-lg bg-indigo-600 p-2 text-white"><BrainCircuit className="h-5 w-5" /></div>
            <span className="font-bold">WorkForce AI Pro</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  )
}
