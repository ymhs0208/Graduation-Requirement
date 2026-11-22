import { useId, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { PendingLabel } from './feedback'
import { Check, Clock, Info, Minus } from 'lucide-react'

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

export function SkipLink() {
  const { t } = useI18n()
  return <a className="skip-link" href="#main">{t('skipToContent')}</a>
}

const FOOTER_TEXT = '國立臺中科技大學人工智慧應用工程學士學位學程 Copyright © NTCUST Bachelor Degree Program of Artificial Intelligence'

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white px-4 py-4 sm:px-6">
      <a
        className="mx-auto block max-w-4xl text-center text-sm font-medium leading-6 text-teal underline decoration-[#b7c3d6] underline-offset-4"
        href="http://www.nutc.edu.tw/files/11-1000-150.php"
        target="_blank"
        rel="noopener noreferrer"
      >
        {FOOTER_TEXT}
        <span className="sr-only">（另開新視窗）</span>
      </a>
    </footer>
  )
}

export function Shell({ user, onLocale, children }: { user: SessionUser; onLocale: (locale: 'zh-Hant' | 'en') => void; children: ReactNode }) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const [pending, setPending] = useState('')
  const name = locale === 'en' ? user.nameEn : user.nameZh
  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <div className="flex flex-1 flex-col md:grid md:grid-cols-[272px_1fr]">
      <aside className="bg-pine text-white" aria-label={t('nav')}>
        <div className="h-1 bg-gold" />
        <div className="flex items-center gap-3 px-4 py-4 md:px-5 md:py-5">
          <img src="/brand/program-mark.png" alt={t('program')} className="h-11 w-11 shrink-0 rounded-xl bg-white object-contain p-1 shadow-sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-wide">{t('app')}</p>
            <p className="text-xs leading-snug text-white/90">{t('program')}</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1 md:overflow-visible md:px-3 md:pb-6" aria-label={t('nav')}>
          {links[user.role].map(([to, key]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/' || to === '/admin' || to === '/teacher'}
              className={({ isActive }) =>
                `block whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-white text-pine shadow-sm' : 'text-white/90 hover:bg-white/10'
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
            <span className="max-w-[12rem] truncate rounded-full bg-[#eef1f6] px-3 py-1 text-sm font-medium text-ink">{name}</span>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={pending === 'locale'}
              onClick={async () => {
                const next = locale === 'en' ? 'zh-Hant' : 'en'
                setPending('locale')
                try {
                  await onLocale(next)
                  document.documentElement.lang = next === 'en' ? 'en' : 'zh-Hant-TW'
                } finally {
                  setPending('')
                }
              }}
            >
              <PendingLabel pending={pending === 'locale'}>{t('language')}</PendingLabel>
            </button>
            <button
              className="btn btn-ink"
              type="button"
              disabled={pending === 'logout'}
              onClick={async () => {
                setPending('logout')
                try {
                  await api('/api/auth/logout', { method: 'POST', body: {} })
                  navigate('/login')
                } finally {
                  setPending('')
                }
              }}
            >
              <PendingLabel pending={pending === 'logout'}>{t('logout')}</PendingLabel>
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 outline-none sm:px-6 sm:py-8">{children}</main>
      </div>
      </div>
      <SiteFooter />
    </div>
  )
}

const pillTone: Record<string, [string, 'passed' | 'underReview' | 'missing' | 'unpublished' | 'info' | 'canGraduate' | 'blocked' | 'pending' | 'office']> = {
  passed: ['bg-[#e5f6ee] text-[#0d6b45] ring-[#b7e0cc]', 'passed'],
  under_review: ['bg-[#fff6e0] text-[#8a5600] ring-[#f0d7a2]', 'underReview'],
  missing: ['bg-[#fdecee] text-[#9e1d22] ring-[#f4c7c8]', 'missing'],
  unpublished: ['bg-[#e8eef6] text-[#314e78] ring-[#c5d4ea]', 'unpublished'],
  info: ['bg-[#eef1f6] text-[#3e4a5c] ring-[#d2d6de]', 'info'],
  ready: ['bg-[#e5f6ee] text-[#0d6b45] ring-[#b7e0cc]', 'canGraduate'],
  blocked: ['bg-[#fdecee] text-[#9e1d22] ring-[#f4c7c8]', 'blocked'],
  pending_review: ['bg-[#fff6e0] text-[#8a5600] ring-[#f0d7a2]', 'pending'],
  needs_office: ['bg-[#e8eef6] text-[#314e78] ring-[#c5d4ea]', 'office'],
}

const pillIcon = {
  passed: Check,
  underReview: Clock,
  missing: Minus,
  unpublished: Info,
  info: Info,
  canGraduate: Check,
  blocked: Minus,
  pending: Clock,
  office: Info,
} as const

export function StatusPill({ state }: { state: string }) {
  const { t } = useI18n()
  const [color, key] = pillTone[state] ?? ['bg-[#eef1f6] text-[#3e4a5c] ring-[#d2d6de]', 'info']
  const Icon = pillIcon[key]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${color}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
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
    <div className="relative grid h-[8.5rem] w-[8.5rem] shrink-0 place-items-center" role="img" aria-label={`${label}, ${Math.round(clamped * 100)}%`}>
      <svg viewBox="0 0 100 100" className="h-[8.5rem] w-[8.5rem] -rotate-90" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4c7ed0" />
            <stop offset="100%" stopColor="#1f4e9c" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={radius} stroke="#e4e8f0" strokeWidth="9" fill="none" />
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
      <div className="absolute px-3 text-center" aria-hidden>
        <p className="text-sm font-bold leading-tight text-ink">{label}</p>
        <p className="text-[11px] font-medium text-muted">{Math.round(clamped * 100)}%</p>
      </div>
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}
