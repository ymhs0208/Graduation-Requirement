import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { BrowserRouter } from 'react-router-dom'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Shell, type SessionUser } from './components/shell'
import { ApiError, api } from './lib/api'
import { I18nProvider, useI18n } from './lib/i18n'
import { AdminAudit, AdminRecognized, AdminRetention, AdminReviews, AdminRules, AdminStats, AdminUsers } from './pages/admin'
import { HelpPage } from './pages/help'
import { EvidencePage, NotificationsPage, PlanPage, StudentHome } from './pages/student'
import { TeacherHome, TeacherStudent } from './pages/teacher'

const client = new QueryClient()

type Me = { user: SessionUser; csrfToken: string }

function LoginPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [message, setMessage] = useState('')
  const [forgot, setForgot] = useState(false)
  const schema = z.object({
    account: z.string().min(4),
    password: z.string().min(1),
    totp: z.string().optional(),
  })
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { account: '', password: '', totp: '' } })
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden bg-ink text-stone-100 lg:flex lg:flex-col lg:justify-between lg:p-10">
        <img src="/brand/program-wordmark.png" alt="" className="h-16 w-auto bg-white object-contain p-2" />
        <div>
          <p className="text-3xl font-semibold">國立臺中科技大學</p>
          <p className="mt-2 text-stone-300">人工智慧應用工程學士學位學程</p>
        </div>
        <p className="text-sm text-stone-400">從入學看到畢業，規則、學分與證明放在同一頁。</p>
      </div>
      <form
        className="mx-auto flex w-full max-w-md flex-col justify-center gap-3 px-6 py-12"
        onSubmit={form.handleSubmit(async (values) => {
          setMessage('')
          try {
            if (forgot) {
              await api('/api/auth/forgot', { method: 'POST', body: { account: values.account } })
              setMessage(t('forgotSent'))
              return
            }
            await api('/api/auth/login', { method: 'POST', body: values })
            window.location.href = '/'
          } catch (error) {
            setMessage(error instanceof ApiError ? error.code : t('error'))
          }
        })}
      >
        <img src="/brand/program-mark.png" alt="" className="h-16 w-16 lg:hidden" />
        <h1 className="text-2xl font-semibold">{t('login')}</h1>
        <label className="text-sm">
          {t('account')}
          <input className="mt-1 w-full rounded-xl border px-3 py-2" {...form.register('account')} />
        </label>
        {!forgot && (
          <label className="text-sm">
            {t('password')}
            <input className="mt-1 w-full rounded-xl border px-3 py-2" type="password" {...form.register('password')} />
          </label>
        )}
        {!forgot && (
          <label className="text-sm">
            {t('totp')}
            <input className="mt-1 w-full rounded-xl border px-3 py-2" inputMode="numeric" {...form.register('totp')} />
            <span className="text-xs text-stone-500">{t('totpHint')}</span>
          </label>
        )}
        {message && <p className="text-sm text-rose-700">{message}</p>}
        <button className="rounded-xl bg-teal px-4 py-2 text-white" type="submit">
          {forgot ? t('forgot') : t('login')}
        </button>
        <button className="text-sm underline" type="button" onClick={() => setForgot(!forgot)}>
          {t('forgot')}
        </button>
      </form>
    </div>
  )
}

function PasswordPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const schema = z.object({ currentPassword: z.string().min(1), nextPassword: z.string().min(12) })
  const form = useForm({ resolver: zodResolver(schema) })
  return (
    <form
      className="mx-auto max-w-md space-y-3 py-16"
      onSubmit={form.handleSubmit(async (values) => {
        await api('/api/auth/password', { method: 'POST', body: values })
        window.location.href = '/'
      })}
    >
      <h1 className="text-2xl font-semibold">{t('changePassword')}</h1>
      <p className="text-sm text-stone-600">{t('passwordRule')}</p>
      <input className="w-full rounded-xl border px-3 py-2" type="password" placeholder={t('currentPassword')} {...form.register('currentPassword')} />
      <input className="w-full rounded-xl border px-3 py-2" type="password" placeholder={t('nextPassword')} {...form.register('nextPassword')} />
      <button className="rounded-xl bg-ink px-4 py-2 text-white" type="submit">
        {t('save')}
      </button>
    </form>
  )
}

function ResetPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  return (
    <form
      className="mx-auto max-w-md space-y-3 py-16"
      onSubmit={async (event) => {
        event.preventDefault()
        try {
          await api('/api/auth/reset', { method: 'POST', body: { token, password } })
          navigate('/login')
        } catch (error) {
          setMessage(error instanceof ApiError ? error.code : t('error'))
        }
      }}
    >
      <h1 className="text-2xl font-semibold">{t('changePassword')}</h1>
      <input className="w-full rounded-xl border px-3 py-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      {message && <p className="text-sm text-rose-700">{message}</p>}
      <button className="rounded-xl bg-ink px-4 py-2 text-white" type="submit">
        {t('save')}
      </button>
    </form>
  )
}

function TotpPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  useEffect(() => {
    api<{ secret: string }>('/api/auth/totp/setup', { method: 'POST', body: {} }).then((data) => setSecret(data.secret))
  }, [])
  return (
    <form
      className="mx-auto max-w-md space-y-3 py-16"
      onSubmit={async (event) => {
        event.preventDefault()
        await api('/api/auth/totp/enable', { method: 'POST', body: { token } })
        window.location.href = '/'
      }}
    >
      <h1 className="text-2xl font-semibold">{t('setupTotp')}</h1>
      <p className="break-all rounded-xl bg-stone-100 p-3 font-mono text-sm">{secret}</p>
      <input className="w-full rounded-xl border px-3 py-2" value={token} onChange={(event) => setToken(event.target.value)} />
      <button className="rounded-xl bg-ink px-4 py-2 text-white" type="submit">
        {t('save')}
      </button>
    </form>
  )
}

function Gate() {
  const { setLocale } = useI18n()
  const query = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/auth/me'), retry: false })
  const user = query.data?.user
  useEffect(() => {
    const saved = localStorage.getItem('theme')
    if (saved === 'dark') document.documentElement.classList.add('dark')
  }, [])
  useEffect(() => {
    if (user?.locale === 'en' || user?.locale === 'zh-Hant') setLocale(user.locale)
  }, [user?.locale, setLocale])
  if (query.isLoading) return <p className="p-8">…</p>
  if (query.isError || !query.data || !user) return <LoginPage />
  if (user.mustChangePassword) return <PasswordPage />
  if (user.role === 'ADMIN' && !user.totpEnabled) return <TotpPage />
  const home = user.role === 'ADMIN' ? '/admin' : user.role === 'TEACHER' ? '/teacher' : '/'
  return (
    <Shell
      user={user}
      onLocale={async (locale) => {
        setLocale(locale)
        await api('/api/auth/locale', { method: 'PATCH', body: { locale } })
      }}
    >
      <Routes>
        <Route path="/" element={user.role === 'STUDENT' ? <StudentHome /> : <Navigate to={home} replace />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/evidence" element={<EvidencePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/help" element={<HelpPage role={user.role} />} />
        <Route path="/teacher" element={user.role === 'TEACHER' ? <TeacherHome /> : <Navigate to={home} replace />} />
        <Route path="/teacher/:id" element={user.role === 'TEACHER' ? <TeacherStudent /> : <Navigate to={home} replace />} />
        <Route path="/admin" element={user.role === 'ADMIN' ? <AdminStats /> : <Navigate to={home} replace />} />
        <Route path="/admin/reviews" element={user.role === 'ADMIN' ? <AdminReviews /> : <Navigate to={home} replace />} />
        <Route path="/admin/users" element={user.role === 'ADMIN' ? <AdminUsers /> : <Navigate to={home} replace />} />
        <Route path="/admin/rules" element={user.role === 'ADMIN' ? <AdminRules /> : <Navigate to={home} replace />} />
        <Route path="/admin/recognized" element={user.role === 'ADMIN' ? <AdminRecognized /> : <Navigate to={home} replace />} />
        <Route path="/admin/audit" element={user.role === 'ADMIN' ? <AdminAudit /> : <Navigate to={home} replace />} />
        <Route path="/admin/retention" element={user.role === 'ADMIN' ? <AdminRetention /> : <Navigate to={home} replace />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </Shell>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset" element={<ResetPage />} />
            <Route path="*" element={<Gate />} />
          </Routes>
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  )
}
