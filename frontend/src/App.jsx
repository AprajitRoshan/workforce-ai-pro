import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { PageLoader } from './components/ui'
import { useAuth } from './context/AuthContext'

const Login = lazy(() => import('./pages/auth/Login'))
const Register = lazy(() => import('./pages/auth/Register'))
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Employees = lazy(() => import('./pages/Employees'))
const EmployeeDetail = lazy(() => import('./pages/EmployeeDetail'))
const Departments = lazy(() => import('./pages/Departments'))
const Attendance = lazy(() => import('./pages/Attendance'))
const Leaves = lazy(() => import('./pages/Leaves'))
const Payroll = lazy(() => import('./pages/Payroll'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Chat = lazy(() => import('./pages/Chat'))
const Documents = lazy(() => import('./pages/Documents'))
const Datasets = lazy(() => import('./pages/ai/Datasets'))
const RiskMonitor = lazy(() => import('./pages/ai/RiskMonitor'))
const Forecasting = lazy(() => import('./pages/ai/Forecasting'))
const AttritionAnalytics = lazy(() => import('./pages/ai/AttritionAnalytics'))
const Interventions = lazy(() => import('./pages/ai/Interventions'))
const Recommendations = lazy(() => import('./pages/ai/Recommendations'))
const Monitoring = lazy(() => import('./pages/Monitoring'))
const Reports = lazy(() => import('./pages/Reports'))
const Audit = lazy(() => import('./pages/Audit'))
const Tasks = lazy(() => import('./pages/Tasks'))
const Performance = lazy(() => import('./pages/Performance'))
const Users = lazy(() => import('./pages/Users'))
const Profile = lazy(() => import('./pages/Profile'))

const MGMT = ['ADMIN', 'HR', 'MANAGER']
const HR = ['ADMIN', 'HR']

function Protected({ roles, children }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="flex h-screen items-center justify-center"><PageLoader /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="card mx-auto mt-16 max-w-md p-8 text-center">
        <p className="text-lg font-semibold">Access restricted</p>
        <p className="mt-1 text-sm text-muted">Your role ({user.role}) does not have permission to view this page.</p>
      </div>
    )
  }
  return children
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  return user ? <Navigate to="/" replace /> : children
}

const guard = (el, roles) => <Protected roles={roles}>{el}</Protected>

export default function App() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><PageLoader /></div>}>
      <Routes>
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
        <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<Protected><Layout /></Protected>}>
          <Route index element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
          <Route path="employees" element={guard(<Employees />, MGMT)} />
          <Route path="employees/:id" element={guard(<EmployeeDetail />, MGMT)} />
          <Route path="departments" element={guard(<Departments />, MGMT)} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="leaves" element={<Leaves />} />
          <Route path="payroll" element={<Payroll />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="chat" element={<Chat />} />
          <Route path="documents" element={<Documents />} />
          <Route path="ai/datasets" element={guard(<Datasets />, HR)} />
          <Route path="ai/risk" element={guard(<RiskMonitor />, MGMT)} />
          <Route path="ai/forecasting" element={guard(<Forecasting />, MGMT)} />
          <Route path="ai/attrition" element={guard(<AttritionAnalytics />, MGMT)} />
          <Route path="ai/interventions" element={guard(<Interventions />, MGMT)} />
          <Route path="ai/recommendations" element={guard(<Recommendations />, MGMT)} />
          <Route path="monitoring" element={guard(<Monitoring />, MGMT)} />
          <Route path="reports" element={guard(<Reports />, MGMT)} />
          <Route path="audit" element={guard(<Audit />, HR)} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="performance" element={<Performance />} />
          <Route path="users" element={guard(<Users />, ['ADMIN'])} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<div className="card p-10 text-center"><p className="text-lg font-semibold">Page not found</p></div>} />
        </Route>
      </Routes>
    </Suspense>
  )
}
