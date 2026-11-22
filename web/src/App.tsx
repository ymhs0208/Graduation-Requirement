import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { BrowserRouter } from 'react-router-dom'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ConfirmProvider } from './components/confirm'
import { ConnectionBanner, PageSkeleton, PendingButton, RouteProgress } from './components/feedback'
import { Toaster } from 'sonner'
import { Shell, SiteFooter, SkipLink, type SessionUser } from './components/shell'
import { errorMessage, api } from './lib/api'
import { I18nProvider, useI18n } from './lib/i18n'
import { AdminAudit, AdminRecognized, AdminRetention, AdminReviews, AdminRules, AdminStats, AdminUsers } from './pages/admin'
import { HelpPage } from './pages/help'
import { EvidencePage, NotificationsPage, PlanPage, StudentHome } from './pages/student'
import { TeacherHome, TeacherStudent } from './pages/teacher'

const client = new QueryClient()

type Me = { user: SessionUser; csrfToken: string }

function LoginPage() {
  const { t, locale } = useI18n()
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [forgot, setForgot] = useState(false)
  const schema = z.object({
    account: z.string().min(4),
    password: z.string().min(1),
    totp: z.string().optional(),
  })
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { account: '', password: '', totp: '' } })
  return (
    <>
    <SkipLink />
    <div className="flex min-h-screen flex-col">
    <main id="main" tabIndex={-1} className="grid flex-1 outline-none lg:grid-cols-[1.05fr_0.95fr]">
      <div className="relative hidden overflow-hidden bg-pine text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-x-0 top-0 h-1 bg-gold" />
        <img src="/brand/program-wordmark.png" alt={t('program')} className="h-16 w-fit rounded-xl bg-white object-contain p-2 shadow-md" />
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-white/75">NATIONAL TAICHUNG UNIVERSITY OF SCIENCE AND TECHNOLOGY</p>
          <p className="mt-4 text-4xl font-bold tracking-tight">國立臺中科技大學</p>
          <p className="mt-2 text-lg text-white/90">人工智慧應用工程學士學位學程</p>
          <p className="mt-6 max-w-md text-sm leading-7 text-white/80">從入學看到畢業，規則、學分與證明放在同一頁。</p>
        </div>
        <p className="text-xs text-white/70">畢業門檻追蹤</p>
      </div>
      <div className="flex items-center justify-center bg-paper px-5 py-12">
        <form
          className="card w-full max-w-md space-y-4 p-6 sm:p-8"
          onSubmit={form.handleSubmit(async (values) => {
            setMessage('')
            setPending(true)
            try {
              if (forgot) {
                await api('/api/auth/forgot', { method: 'POST', body: { account: values.account }, success: t('forgotSent') })
                setMessage(t('forgotSent'))
                return
              }
              await api('/api/auth/login', { method: 'POST', body: values })
              window.location.href = '/'
            } catch (error) {
              setMessage(errorMessage(error, locale, t('error')))
            } finally {
              setPending(false)
            }
          })}
        >
          <img src="/brand/program-mark.png" alt={t('program')} className="h-14 w-14 rounded-xl bg-white object-contain p-1 ring-1 ring-line lg:hidden" />
          <div>
            <p className="text-xs font-semibold tracking-wide text-teal lg:hidden">國立臺中科技大學</p>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{t('login')}</h1>
            <p className="mt-1 text-sm text-muted">{t('program')}</p>
          </div>
          <label className="block text-sm font-medium text-ink">
            {t('account')}
            <input className="field w-full" {...form.register('account')} />
          </label>
          {!forgot && (
            <label className="block text-sm font-medium text-ink">
              {t('password')}
              <input className="field w-full" type="password" {...form.register('password')} />
            </label>
          )}
          {!forgot && (
            <label className="block text-sm font-medium text-ink">
              {t('totp')}
              <input className="field w-full" inputMode="numeric" {...form.register('totp')} />
              <span className="mt-1 block text-xs font-normal text-muted">{t('totpHint')}</span>
            </label>
          )}
          {message && <p className="rounded-xl bg-[#fdecee] px-3 py-2 text-sm font-medium text-[#9e1d22]">{message}</p>}
          <PendingButton className="btn btn-primary w-full" type="submit" pending={pending}>
            {forgot ? t('forgot') : t('login')}
          </PendingButton>
          <button className="text-sm font-medium text-teal underline-offset-2 hover:underline" type="button" onClick={() => setForgot(!forgot)}>
            {t('forgot')}
          </button>
        </form>
      </div>
    </main>
    <SiteFooter />
    </div>
    </>
  )
}

function PasswordPage() {
  const { t, locale } = useI18n()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const schema = z.object({ currentPassword: z.string().min(1), nextPassword: z.string().min(12) })
  const form = useForm({ resolver: zodResolver(schema) })
  return (
    <>
    <SkipLink />
    <div className="flex min-h-screen flex-col bg-paper">
    <main id="main" tabIndex={-1} className="flex flex-1 items-center justify-center px-4 py-16 outline-none">
      <form
        className="card w-full max-w-md space-y-4 p-6 sm:p-8"
        onSubmit={form.handleSubmit(async (values) => {
          setPending(true)
          setMessage('')
          try {
            await api('/api/auth/password', { method: 'POST', body: values, success: t('saved') })
            window.location.href = '/'
          } catch (error) {
            setMessage(errorMessage(error, locale, t('error')))
          } finally {
            setPending(false)
          }
        })}
      >
        <img src="/brand/program-mark.png" alt={t('program')} className="h-12 w-12 rounded-xl object-contain" />
        <h1 className="text-2xl font-bold tracking-tight">{t('changePassword')}</h1>
        <p className="text-sm text-muted">{t('passwordRule')}</p>
        <input className="field w-full" type="password" aria-label={t('currentPassword')} placeholder={t('currentPassword')} {...form.register('currentPassword')} />
        <input className="field w-full" type="password" aria-label={t('nextPassword')} placeholder={t('nextPassword')} {...form.register('nextPassword')} />
        {message && <p className="text-sm font-medium text-[#9e1d22]">{message}</p>}
        <PendingButton className="btn btn-primary w-full" type="submit" pending={pending}>
          {t('save')}
        </PendingButton>
      </form>
    </main>
    <SiteFooter />
    </div>
    </>
  )
}

function ResetPage() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  return (
    <>
    <SkipLink />
    <div className="flex min-h-screen flex-col bg-paper">
    <main id="main" tabIndex={-1} className="flex flex-1 items-center justify-center px-4 py-16 outline-none">
      <form
        className="card w-full max-w-md space-y-4 p-6 sm:p-8"
        onSubmit={async (event) => {
          event.preventDefault()
          setPending(true)
          setMessage('')
          try {
            await api('/api/auth/reset', { method: 'POST', body: { token, password }, success: t('saved') })
            navigate('/login')
          } catch (error) {
            setMessage(errorMessage(error, locale, t('error')))
          } finally {
            setPending(false)
          }
        }}
      >
        <img src="/brand/program-mark.png" alt={t('program')} className="h-12 w-12 rounded-xl object-contain" />
        <h1 className="text-2xl font-bold tracking-tight">{t('changePassword')}</h1>
        <input className="field w-full" type="password" aria-label={t('nextPassword')} value={password} onChange={(event) => setPassword(event.target.value)} />
        {message && <p className="rounded-xl bg-[#fdecee] px-3 py-2 text-sm font-medium text-[#9e1d22]">{message}</p>}
        <PendingButton className="btn btn-primary w-full" type="submit" pending={pending}>
          {t('save')}
        </PendingButton>
      </form>
    </main>
    <SiteFooter />
    </div>
    </>
  )
}

function TotpPage() {
  const { t } = useI18n()
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => {
    api<{ secret: string }>('/api/auth/totp/setup', { method: 'POST', body: {} }).then((data) => setSecret(data.secret))
  }, [])
  return (
    <>
    <SkipLink />
    <div className="flex min-h-screen flex-col bg-paper">
    <main id="main" tabIndex={-1} className="flex flex-1 items-center justify-center px-4 py-16 outline-none">
      <form
        className="card w-full max-w-md space-y-4 p-6 sm:p-8"
      onSubmit={async (event) => {
        event.preventDefault()
        setPending(true)
        try {
          await api('/api/auth/totp/enable', { method: 'POST', body: { token }, success: t('saved') })
          window.location.href = '/'
        } finally {
          setPending(false)
        }
      }}
      >
        <img src="/brand/program-mark.png" alt={t('program')} className="h-12 w-12 rounded-xl object-contain" />
        <h1 className="text-2xl font-bold tracking-tight">{t('setupTotp')}</h1>
        <p className="break-all rounded-xl bg-[#eef1f6] p-3 font-mono text-sm text-ink">{secret}</p>
        <input className="field w-full" aria-label={t('totp')} value={token} onChange={(event) => setToken(event.target.value)} />
        <PendingButton className="btn btn-primary w-full" type="submit" pending={pending}>
          {t('save')}
        </PendingButton>
      </form>
    </main>
    <SiteFooter />
    </div>
    </>
  )
}

function Gate() {
  const { setLocale, t } = useI18n()
  const query = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/auth/me'), retry: false })
  const user = query.data?.user
  useEffect(() => {
    if (user?.locale === 'en' || user?.locale === 'zh-Hant') setLocale(user.locale)
  }, [user?.locale, setLocale])
  if (query.isLoading) return <div className="flex min-h-screen flex-col"><main id="main" className="flex-1 p-8"><PageSkeleton /></main><SiteFooter /></div>
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
        <ConfirmProvider>
        <BrowserRouter>
          <RouteProgress />
          <ConnectionBanner />
          <Toaster position="top-center" richColors closeButton containerAriaLabel="Notifications" />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset" element={<ResetPage />} />
            <Route path="*" element={<Gate />} />
          </Routes>
        </BrowserRouter>
        </ConfirmProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
}
