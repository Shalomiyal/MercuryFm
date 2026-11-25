import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import ProtectedRoute from './components/ProtectedRoute'
import DocumentTitle from './components/DocumentTitle'
import RouteFallback from './components/ui/RouteFallback'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const AdminPlaceholder = lazy(() => import('./pages/AdminPlaceholder'))
const CleanerPlaceholder = lazy(() => import('./pages/CleanerPlaceholder'))
const RoomStatusPage = lazy(() => import('./pages/RoomStatusPage'))
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'))
const DailyTasksPage = lazy(() => import('./pages/DailyTasksPage'))
const CleanerTasksPage = lazy(() => import('./pages/CleanerTasksPage'))
const CleanerHistoryPage = lazy(() => import('./pages/CleanerHistoryPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const PlatformPage = lazy(() => import('./pages/PlatformPage'))
const PlatformUsersPage = lazy(() => import('./pages/PlatformUsersPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const PlatformLoginPage = lazy(() => import('./pages/PlatformLoginPage'))
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'))
const SignupPage = lazy(() => import('./pages/SignupPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'))
const OrganizationRoomsPage = lazy(() => import('./pages/OrganizationRoomsPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

export default function App() {
  return (
    <>
      <DocumentTitle />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/platform-login" element={<PlatformLoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/change-password" element={<ChangePasswordPage />} />
          </Route>
          <Route element={<ProtectedRoute role="platform_admin" />}>
            <Route element={<AppShell role="platform" />}>
              <Route path="/platform" element={<PlatformPage />} />
              <Route path="/platform/users" element={<PlatformUsersPage />} />
            </Route>
          </Route>
          <Route element={<ProtectedRoute roles={['org_admin', 'admin']} />}>
            <Route element={<AppShell role="admin" />}>
              <Route path="/admin" element={<DashboardPage />} />
              <Route path="/admin/rooms" element={<RoomStatusPage />} />
              <Route path="/admin/tasks" element={<DailyTasksPage />} />
              <Route path="/admin/templates" element={<TemplatesPage />} />
              <Route element={<ProtectedRoute role="org_admin" />}>
                <Route path="/admin/users" element={<UsersPage />} />
                <Route path="/admin/rooms-setup" element={<OrganizationRoomsPage />} />
              </Route>
            </Route>
          </Route>
          <Route element={<ProtectedRoute role="cleaner" />}>
            <Route element={<AppShell role="cleaner" />}>
              <Route path="/cleaner/tasks" element={<CleanerTasksPage />} />
              <Route path="/cleaner/history" element={<CleanerHistoryPage />} />
            </Route>
          </Route>
          <Route path="/admin/placeholder" element={<AdminPlaceholder />} />
          <Route path="/cleaner/placeholder" element={<CleanerPlaceholder />} />
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  )
}
