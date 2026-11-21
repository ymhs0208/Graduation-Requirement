import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'

export type SessionUser = {
  id: string
  account: string
  nameZh: string
  nameEn: string
  role: 'STUDENT' | 'TEACHER' | 'ADMIN'
  locale: string
  mustChangePassword: boolean
  totpEnabled: boolean
  onboardingCompleted: boolean
}

const links = {
  STUDENT: [
    ['/', 'overview'],
    ['/plan', 'plan'],
    ['/evidence', 'evidence'],
    ['/notifications', 'notifications'],
    ['/help', 'help'],
  ],
  TEACHER: [
    ['/teacher', 'classes'],
    ['/notifications', 'notifications'],
    ['/help', 'help'],
  ],
  ADMIN: [
    ['/admin', 'stats'],
    ['/admin/reviews', 'reviews'],
    ['/admin/users', 'users'],
    ['/admin/rules', 'rules'],
    ['/admin/recognized', 'recognized'],
    ['/admin/audit', 'audit'],
    ['/admin/retention', 'retention'],
    ['/notifications', 'notifications'],
    ['/help', 'help'],
  ],
} as const

export function Shell({ user, onLocale, children }: { user: SessionUser; onLocale: (locale: 'zh-Hant' | 'en') => void; children: ReactNode }) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const name = locale === 'en' ? user.nameEn : user.nameZh
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-ink text-stone-100 md:min-h-screen md:border-b-0 dark:border-zinc-800">
        <div className="flex items-center gap-3 px-4 py-4">
          <img src="/brand/program-mark.png" alt="" className="h-10 w-10 rounded-lg bg-white object-contain p-1" />
          <div>
            <p className="text-sm font-semibold">{t('app')}</p>
            <p className="text-xs text-stone-300">{t('program')}</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-auto px-2 pb-3 md:block md:px-3">
          {links[user.role].map(([to, key]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/' || to === '/admin' || to === '/teacher'}
              className={({ isActive }) =>
                `block whitespace-nowrap rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-white text-ink' : 'text-stone-200 hover:bg-white/10'}`
              }
            >
              {t(key)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-card px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <img src="/brand/program-wordmark.png" alt={t('program')} className="h-10 max-w-[240px] object-contain object-left dark:invert" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{name}</span>
            <button
              className="rounded-lg border border-line px-3 py-1.5 dark:border-zinc-700"
              type="button"
              onClick={() => {
                const next = locale === 'en' ? 'zh-Hant' : 'en'
                onLocale(next)
                document.documentElement.lang = next === 'en' ? 'en' : 'zh-Hant'
              }}
            >
              {t('language')}
            </button>
            <button
              className="rounded-lg border border-line px-3 py-1.5 dark:border-zinc-700"
              type="button"
              onClick={() => {
                document.documentElement.classList.toggle('dark')
                localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light')
              }}
            >
              {t('theme')}
            </button>
            <button
              className="rounded-lg bg-ink px-3 py-1.5 text-white dark:bg-stone-100 dark:text-ink"
              type="button"
              onClick={async () => {
                await api('/api/auth/logout', { method: 'POST', body: {} })
                navigate('/login')
              }}
            >
              {t('logout')}
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </div>
    </div>
  )
}

export function StatusPill({ state }: { state: string }) {
  const { t } = useI18n()
  const map: Record<string, [string, 'passed' | 'underReview' | 'missing' | 'unpublished' | 'info' | 'canGraduate' | 'blocked' | 'pending' | 'office']> = {
    passed: ['bg-emerald-100 text-emerald-900', 'passed'],
    under_review: ['bg-amber-100 text-amber-950', 'underReview'],
    missing: ['bg-rose-100 text-rose-900', 'missing'],
    unpublished: ['bg-sky-100 text-sky-950', 'unpublished'],
    info: ['bg-stone-200 text-stone-800', 'info'],
    ready: ['bg-emerald-100 text-emerald-900', 'canGraduate'],
    blocked: ['bg-rose-100 text-rose-900', 'blocked'],
    pending_review: ['bg-amber-100 text-amber-950', 'pending'],
    needs_office: ['bg-sky-100 text-sky-950', 'office'],
  }
  const [color, key] = map[state] ?? ['bg-stone-200', 'info']
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>{t(key)}</span>
}

export function Ring({ value, label }: { value: number; label: string }) {
  const radius = 42
  const length = 2 * Math.PI * radius
  const offset = length * (1 - Math.max(0, Math.min(1, value)))
  return (
    <div className="relative h-28 w-28">
      <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
        <circle cx="50" cy="50" r={radius} className="stroke-stone-200 dark:stroke-zinc-700" strokeWidth="8" fill="none" />
        <circle cx="50" cy="50" r={radius} stroke="#1f6f6a" strokeWidth="8" fill="none" strokeDasharray={length} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center text-xs font-medium">
        <span>{label}</span>
      </div>
    </div>
  )
}
