import { useId, type ReactNode } from 'react'
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
    <div className="min-h-screen md:grid md:grid-cols-[272px_1fr]">
      <aside className="bg-pine text-white md:min-h-screen">
        <div className="h-1 bg-gold" />
        <div className="flex items-center gap-3 px-4 py-4 md:px-5 md:py-5">
          <img src="/brand/program-mark.png" alt="" className="h-11 w-11 shrink-0 rounded-xl bg-white object-contain p-1 shadow-sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-wide">{t('app')}</p>
            <p className="text-[11px] leading-snug text-emerald-50/75">{t('program')}</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1 md:overflow-visible md:px-3 md:pb-6">
          {links[user.role].map(([to, key]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/' || to === '/admin' || to === '/teacher'}
              className={({ isActive }) =>
                `block whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-white text-pine shadow-sm' : 'text-emerald-50/90 hover:bg-white/10'
                }`
              }
            >
              {t(key)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
          <img src="/brand/program-wordmark.png" alt={t('program')} className="hidden h-14 max-w-[320px] object-contain object-left md:block" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="max-w-[12rem] truncate rounded-full bg-[#eef5f1] px-3 py-1 text-sm font-medium text-ink">{name}</span>
            <button
              className="btn btn-ghost"
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
              className="btn btn-ink"
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
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  )
}

const pillTone: Record<string, [string, 'passed' | 'underReview' | 'missing' | 'unpublished' | 'info' | 'canGraduate' | 'blocked' | 'pending' | 'office']> = {
  passed: ['bg-[#e7f6ee] text-[#08663a] ring-[#b7e4cc]', 'passed'],
  under_review: ['bg-[#fff4dc] text-[#7a4e00] ring-[#f0d7a2]', 'underReview'],
  missing: ['bg-[#fdeceb] text-[#9b1c16] ring-[#f4c7c2]', 'missing'],
  unpublished: ['bg-[#e7f3fa] text-[#0f5f8a] ring-[#c5dff0]', 'unpublished'],
  info: ['bg-[#f3f5f4] text-[#3f514c] ring-[#d5deda]', 'info'],
  ready: ['bg-[#e7f6ee] text-[#08663a] ring-[#b7e4cc]', 'canGraduate'],
  blocked: ['bg-[#fdeceb] text-[#9b1c16] ring-[#f4c7c2]', 'blocked'],
  pending_review: ['bg-[#fff4dc] text-[#7a4e00] ring-[#f0d7a2]', 'pending'],
  needs_office: ['bg-[#e7f3fa] text-[#0f5f8a] ring-[#c5dff0]', 'office'],
}

export function StatusPill({ state }: { state: string }) {
  const { t } = useI18n()
  const [color, key] = pillTone[state] ?? ['bg-[#f3f5f4] text-[#3f514c] ring-[#d5deda]', 'info']
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${color}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {t(key)}
    </span>
  )
}

export function Ring({ value, label }: { value: number; label: string }) {
  const radius = 40
  const length = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(1, value))
  const offset = length * (1 - clamped)
  const gradientId = useId().replace(/:/g, '')
  return (
    <div className="relative grid h-[8.5rem] w-[8.5rem] shrink-0 place-items-center">
      <svg viewBox="0 0 100 100" className="h-[8.5rem] w-[8.5rem] -rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1aa37a" />
            <stop offset="100%" stopColor="#0e6b56" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={radius} stroke="#e3eee8" strokeWidth="9" fill="none" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth="9"
          fill="none"
          strokeDasharray={length}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute px-3 text-center">
        <p className="text-sm font-bold leading-tight text-ink">{label}</p>
        <p className="text-[11px] font-medium text-muted">{Math.round(clamped * 100)}%</p>
      </div>
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}
