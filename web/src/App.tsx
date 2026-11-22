import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { BrowserRouter } from 'react-router-dom'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ConfirmProvider } from './components/confirm'
import { ConnectionBanner, LoadError, PageSkeleton, PendingButton, RouteProgress } from './components/feedback'
import { Toaster } from 'sonner'
import { Shell, SiteFooter, SkipLink, type SessionUser } from './components/shell'
import { ApiError, errorMessage, api, onSessionLost } from './lib/api'
import { authenticatePasskey, passkeyError, supportsPasskeys } from './lib/passkeys'
import { I18nProvider, useI18n } from './lib/i18n'
import { AdminStats } from './pages/admin'
import { AdminAudit } from './pages/admin-audit'
import { AdminReviews } from './pages/admin-reviews'
import { AdminRetention } from './pages/admin-retention'
import { AdminRecognized } from './pages/admin-recognized'
import { AdminRules } from './pages/admin-rules'
import { AdminPlan } from './pages/admin-plan'
import { AdminAnnouncements } from './pages/admin-announcements'
import { AdminUsers } from './pages/admin-users'
import { HelpPage } from './pages/help'
import { PlanPage, StudentHome } from './pages/student'
import { NotificationsPage } from './pages/notifications'
import { EvidencePage } from './pages/student-evidence'
import { TeacherHome } from './pages/teacher'
import { TeacherStudent } from './pages/teacher-student'
import { AdminPasskeys } from './pages/admin-passkeys'

const client = new QueryClient()

type Me = { user: SessionUser; csrfToken: string }
type LoginState = { reason?: 'required' | 'expired'; returnTo?: string }

function loginDestination(value: unknown) {
  if (typeof value !== 'string') return '/'
  try {
    const url = new URL(value, window.location.origin)
    return url.origin === window.location.origin && url.pathname !== '/login' && url.pathname !== '/reset' ? url.href : '/'
  } catch {
    return '/'
  }
}

function LoginPage() {
  const { t, locale, setLocale } = useI18n()
  const location = useLocation()
  const loginState = location.state as LoginState | null
  const reason = loginState?.reason
  useEffect(() => { client.clear() }, [])
  const [message, setMessage] = useState('')
  const [recoverySent, setRecoverySent] = useState(false)
  const [pending, setPending] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [verification, setVerification] = useState<{ account: string; password: string; canUsePasskey: boolean } | null>(null)
  const [verificationMethod, setVerificationMethod] = useState<'totp' | 'passkey'>('totp')
  const [code, setCode] = useState('')
  const schema = z.object({
    account: z.string().min(4),
    password: forgot ? z.string().optional() : z.string().min(1),
  })
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { account: '', password: '' } })
  const errors = form.formState.errors

  function toggleRecovery() {
    setForgot(!forgot)
    setMessage('')
    setRecoverySent(false)
    setShowPassword(false)
    form.clearErrors()
  }

  return (
    <>
      <SkipLink />
      <div className="login-layout">
        <header className="login-header">
          <div className="login-brand">
            <p>{t('university')}</p>
            <p>{t('program')}</p>
          </div>
          <button className="btn btn-ghost login-language" type="button" onClick={() => setLocale(locale === 'en' ? 'zh-Hant' : 'en')}>
            {t('language')}
          </button>
        </header>
        <main id="main" tabIndex={-1} className="login-main outline-none">
          <div className="login-hero">
            <img className="login-seal" src="/brand/university-seal.jpg" width="319" height="320" alt={t('universitySeal')} />
            <div className="login-hero-copy">
              <p className="login-hero-title">{t('loginHeroTitle')}</p>
              <p className="login-hero-summary">{t('loginHeroSummary')}</p>
            </div>
          </div>
          <div className="login-panel">
            {verification ? (
              <form
                key="verification"
                className="login-form"
                onSubmit={async (event) => {
                  event.preventDefault()
                  if (pending) return
                  setMessage('')
                  setPending(true)
                  try {
                    if (verificationMethod === 'passkey') {
                      await authenticatePasskey(verification.account, verification.password)
                    } else {
                      await api('/api/auth/login', {
                        body: { account: verification.account, password: verification.password, totp: code },
                        silent: true,
                      })
                    }
                    window.location.replace(loginDestination(loginState?.returnTo))
                  } catch (error) {
                    setMessage(verificationMethod === 'passkey'
                      ? passkeyError(error, locale, t('passkeyTryAgain'), t('passkeyInterrupted'))
                      : errorMessage(error, locale, t('error')))
                  } finally {
                    setPending(false)
                  }
                }}
              >
                <div className="login-intro">
                  <h1>{t('loginVerification')}</h1>
                  <p>{verification.account}</p>
                </div>
                {verification.canUsePasskey && (
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('verificationMethod')}>
                    {(['totp', 'passkey'] as const).map((method) => (
                      <button type="button" key={method}
                        className={`btn ${method === verificationMethod ? 'btn-ink' : 'btn-ghost'}`}
                        disabled={pending} aria-pressed={method === verificationMethod}
                        onClick={() => { setVerificationMethod(method); setCode(''); setMessage('') }}>
                        {t(method === 'totp' ? 'authenticatorApp' : 'passkey')}
                      </button>
                    ))}
                  </div>
                )}
                {verificationMethod === 'totp' ? <div className="login-control">
                  <label htmlFor="login-totp">{t('totp')}</label>
                  <div className="login-input">
                    <input
                      id="login-totp"
                      className="field font-mono tracking-[.25em]"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      aria-describedby="login-totp-hint"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                      pattern="[0-9]{6}"
                      autoFocus
                    />
                  </div>
                  <p id="login-totp-hint" className="mt-2 text-sm text-muted">{t('totpHint')}</p>
                </div> : <p className="text-sm text-muted">{t('passkeySignInHint')}</p>}
                {message && <p className="login-result" role="alert">{message}</p>}
                <PendingButton className="btn btn-primary login-submit" type="submit" pending={pending}>{t('verifyAndSignIn')}</PendingButton>
                <button className="login-recovery" type="button" disabled={pending} onClick={() => {
                  setVerification(null)
                  setCode('')
                  setMessage('')
                }}>
                  {t('backToLogin')}
                </button>
              </form>
            ) : (
              <form
                key="credentials"
                className="login-form"
                onSubmit={form.handleSubmit(async (values) => {
                  if (pending) return
                  setMessage('')
                  setRecoverySent(false)
                  setPending(true)
                  try {
                    if (forgot) {
                      await api('/api/auth/forgot', { method: 'POST', body: { account: values.account } })
                      setRecoverySent(true)
                      setMessage(t('forgotSent'))
                      return
                    }
                    await api('/api/auth/login', { method: 'POST', body: values, silent: true })
                    window.location.replace(loginDestination(loginState?.returnTo))
                  } catch (error) {
                    if (!forgot && values.password && error instanceof ApiError && error.code === 'TOTP_REQUIRED') {
                      setVerification({ account: values.account, password: values.password, canUsePasskey: error.passkeyAvailable && supportsPasskeys() })
                      setVerificationMethod('totp')
                      setShowPassword(false)
                      form.resetField('password')
                      return
                    }
                    setMessage(errorMessage(error, locale, t('error')))
                  } finally {
                    setPending(false)
                  }
                })}
              >
                <div className="login-intro">
                  <h1>{forgot ? t('forgot') : t('loginHeading')}</h1>
                  <p>{forgot ? t('recoveryIntro') : t('loginIntro')}</p>
                </div>
                {!forgot && reason && <p className="inset-panel text-sm" role="status">{t(reason === 'expired' ? 'sessionExpired' : 'signInRequired')}</p>}
                <div className="login-control">
                  <label htmlFor="login-account">{t('account')}</label>
                  <div className="login-input">
                    <input id="login-account" className="field" autoComplete="username" aria-invalid={!!errors.account} aria-describedby={errors.account ? 'login-account-error' : undefined} {...form.register('account')} />
                  </div>
                  {errors.account && <p id="login-account-error" className="login-error">{t('loginAccountError')}</p>}
                </div>
                {!forgot && (
                  <div className="login-control">
                    <label htmlFor="login-password">{t('password')}</label>
                    <div className="login-input login-input-password">
                      <input id="login-password" className="field" type={showPassword ? 'text' : 'password'} autoComplete="current-password" aria-invalid={!!errors.password} aria-describedby={errors.password ? 'login-password-error' : undefined} {...form.register('password')} />
                      <button className="login-visibility" type="button" onClick={() => setShowPassword(!showPassword)}>
                        {t(showPassword ? 'hidePassword' : 'showPassword')}
                      </button>
                    </div>
                    {errors.password && <p id="login-password-error" className="login-error">{t('loginPasswordError')}</p>}
                  </div>
                )}
                {message && <p className={recoverySent ? 'login-result login-result-success' : 'login-result'} role={recoverySent ? 'status' : 'alert'}>{message}</p>}
                <PendingButton className="btn btn-primary login-submit" type="submit" pending={pending}>
                  {forgot ? t('sendRecovery') : t('login')}
                </PendingButton>
                <button className="login-recovery" type="button" disabled={pending} onClick={toggleRecovery}>
                  {forgot ? t('backToLogin') : t('forgot')}
                </button>
              </form>
            )}
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
    <AccountFrame title={t('changePassword')} description={t('passwordRule')}>
      <form
        className="space-y-4"
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
        <label className="block text-sm font-semibold">{t('currentPassword')}<input className="field w-full" type="password" autoComplete="current-password" required {...form.register('currentPassword')} /></label>
        <label className="block text-sm font-semibold">{t('nextPassword')}<input className="field w-full" type="password" autoComplete="new-password" minLength={12} required {...form.register('nextPassword')} /></label>
        {message && <p className="login-result" role="alert">{message}</p>}
        <PendingButton className="btn btn-primary w-full" type="submit" pending={pending}>
          {t('savePassword')}
        </PendingButton>
      </form>
    </AccountFrame>
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
    <AccountFrame title={t('resetPasswordHeading')} description={t('passwordRule')}>
      <form
        className="space-y-4"
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
        <label className="block text-sm font-semibold">{t('nextPassword')}<input className="field w-full" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {message && <p className="login-result" role="alert">{message}</p>}
        <PendingButton className="btn btn-primary w-full" type="submit" pending={pending}>
          {t('savePassword')}
        </PendingButton>
      </form>
    </AccountFrame>
  )
}

function TotpPage({ userId }: { userId: string }) {
  const { t, locale } = useI18n()
  const setup = useQuery({
    queryKey: ['totp-setup', userId],
    queryFn: async () => {
      const data = await api<{ secret: string }>('/api/auth/totp/setup', { method: 'POST', body: {}, silent: true })
      if (!data.secret) throw new ApiError('SERVER')
      return data
    },
    networkMode: 'always',
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const secret = setup.data?.secret
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  return (
    <AccountFrame title={t('setupTotp')} description={t('totpSetupGuide')}>
      <form
        className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setPending(true)
        setMessage('')
        try {
          await api('/api/auth/totp/enable', { method: 'POST', body: { token }, silent: true })
          window.location.href = '/'
        } catch (error) {
          setMessage(errorMessage(error, locale, t('error')))
        } finally {
          setPending(false)
        }
      }}
      >
        {setup.isPending && setup.isFetching && <p role="status">{t('loading')}</p>}
        {setup.isError && <LoadError pending={setup.isFetching} onRetry={() => void setup.refetch()} />}
        {secret && !setup.isError && <div className="inset-panel">
          <p className="text-xs font-semibold text-muted">{t('verificationKey')}</p>
          <p className="mt-1 break-all font-mono text-sm">{secret}</p>
        </div>}
        <label className="block text-sm font-semibold">{t('totp')}<input className="field w-full" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" value={token} onChange={(event) => setToken(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
        {message && <p className="login-result" role="alert">{message}</p>}
        <PendingButton className="btn btn-primary w-full" type="submit" pending={pending} disabled={!secret || setup.isError || setup.isFetching}>
          {t('enableVerification')}
        </PendingButton>
      </form>
    </AccountFrame>
  )
}

function AccountFrame({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="login-layout">
      <SkipLink />
      <main id="main" tabIndex={-1} className="account-main outline-none">
        <section className="card account-card">
          <header className="account-heading">
            <img src="/brand/program-mark.png" alt="" width="36" height="36" />
            <p>{t('university')}</p>
            <h1>{title}</h1>
          </header>
          <div className="account-content">
            {description && <p className="mb-4 text-sm text-muted">{description}</p>}
            {children}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}

function Gate() {
  const { setLocale, t } = useI18n()
  const location = useLocation()
  const [sessionLost, setSessionLost] = useState(false)
  const query = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/auth/me', { silent: true }), retry: false })
  const user = query.data?.user
  useEffect(() => onSessionLost(() => setSessionLost(true)), [])
  useEffect(() => {
    if (user?.locale === 'en' || user?.locale === 'zh-Hant') setLocale(user.locale)
  }, [user?.locale, setLocale])
  if (query.isLoading) return <div className="flex min-h-screen flex-col"><main id="main" className="flex-1 p-8"><PageSkeleton /></main><SiteFooter /></div>
  if (sessionLost || (query.error instanceof ApiError && query.error.code === 'UNAUTHENTICATED')) {
    return <Navigate replace to="/login" state={{
      reason: sessionLost || user ? 'expired' : 'required',
      returnTo: `${location.pathname}${location.search}${location.hash}`,
    } satisfies LoginState} />
  }
  if (!user) return (
    <AccountFrame title={t('loadFailed')}>
      <PendingButton type="button" className="btn btn-primary" pending={query.isFetching} onClick={() => void query.refetch()}>{t('tryAgain')}</PendingButton>
    </AccountFrame>
  )
  if (user.mustChangePassword) return <PasswordPage />
  if (user.role === 'ADMIN' && !user.totpEnabled) return <TotpPage userId={user.id} />
  const home = user.role === 'ADMIN' ? '/admin' : user.role === 'TEACHER' ? '/teacher' : '/'
  return (
    <Shell
      user={user}
      onLocale={async (locale) => {
        await api('/api/auth/locale', { method: 'PATCH', body: { locale } })
        client.setQueryData<Me>(['me'], (current) => current && { ...current, user: { ...current.user, locale } })
        setLocale(locale)
      }}
    >
      <Routes>
        <Route path="/" element={user.role === 'STUDENT' ? <StudentHome /> : <Navigate to={home} replace />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/evidence" element={<EvidencePage />} />
        <Route path="/notifications" element={<NotificationsPage canPublish={user.role === 'ADMIN'} />} />
        <Route path="/help" element={<HelpPage role={user.role} />} />
        <Route path="/teacher" element={user.role === 'TEACHER' ? <TeacherHome /> : <Navigate to={home} replace />} />
        <Route path="/teacher/:id" element={user.role === 'TEACHER' ? <TeacherStudent /> : <Navigate to={home} replace />} />
        <Route path="/admin" element={user.role === 'ADMIN' ? <AdminStats /> : <Navigate to={home} replace />} />
        <Route path="/admin/reviews" element={user.role === 'ADMIN' ? <AdminReviews /> : <Navigate to={home} replace />} />
        <Route path="/admin/users" element={user.role === 'ADMIN' ? <AdminUsers /> : <Navigate to={home} replace />} />
        <Route path="/admin/rules" element={user.role === 'ADMIN' ? <AdminRules /> : <Navigate to={home} replace />} />
        <Route path="/admin/plan" element={user.role === 'ADMIN' ? <AdminPlan /> : <Navigate to={home} replace />} />
        <Route path="/admin/announcements" element={user.role === 'ADMIN' ? <AdminAnnouncements /> : <Navigate to={home} replace />} />
        <Route path="/admin/recognized" element={user.role === 'ADMIN' ? <AdminRecognized /> : <Navigate to={home} replace />} />
        <Route path="/admin/audit" element={user.role === 'ADMIN' ? <AdminAudit /> : <Navigate to={home} replace />} />
        <Route path="/admin/retention" element={user.role === 'ADMIN' ? <AdminRetention /> : <Navigate to={home} replace />} />
        <Route path="/admin/security" element={user.role === 'ADMIN' ? <AdminPasskeys /> : <Navigate to={home} replace />} />
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
