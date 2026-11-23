import { useId, useRef, useState, type ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { NavLink, useLocation, useNavigate, matchPath } from 'react-router-dom'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { PendingLabel } from './feedback'
import { Bell, BookOpen, CalendarDays, ChartNoAxesColumnIncreasing, Check, ChevronDown, CircleHelp, ClipboardCheck, Clock, FileUp, Globe2, History, Info, KeyRound, LayoutDashboard, LogOut, Megaphone, Menu, Minus, Shield, Trash2, UserRound, UsersRound, X } from 'lucide-react'

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
    ['/admin/plan', 'managePlan'],
    ['/admin/recognized', 'recognized'],
    ['/admin/announcements', 'announcements'],
    ['/admin/audit', 'audit'],
    ['/admin/retention', 'retention'],
    ['/notifications', 'notifications'],
    ['/help', 'help'],
  ],
} as const

const navIcons = {
  overview: LayoutDashboard, plan: CalendarDays, evidence: FileUp, notifications: Bell,
  help: CircleHelp, classes: UsersRound, stats: ChartNoAxesColumnIncreasing, reviews: ClipboardCheck,
  users: UsersRound, rules: BookOpen, managePlan: CalendarDays, recognized: Shield, announcements: Megaphone, audit: History, retention: Trash2, passkeySettings: KeyRound, importTitle: FileUp,
}

const pageTitles = [...links.STUDENT, ...links.TEACHER, ...links.ADMIN, ['/admin/security', 'passkeySettings'] as const, ['/admin/import/:kind', 'importTitle'] as const]
const roleLabels = { STUDENT: 'studentRole', TEACHER: 'teacherRole', ADMIN: 'adminRole' } as const

export function SkipLink() {
  const { t } = useI18n()
  return <a className="skip-link" href="#main">{t('skipToContent')}</a>
}

const FOOTER_TEXT = '國立臺中科技大學人工智慧應用工程學士學位學程 Copyright © NTCUST Bachelor Degree Program of Artificial Intelligence'

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <a
        className="mx-auto block max-w-4xl text-center text-xs leading-6 text-muted underline-offset-4 hover:underline"
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

export function Shell({ user, onLocale, children }: { user: SessionUser; onLocale: (locale: 'zh-Hant' | 'en') => Promise<void>; children: ReactNode }) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [pending, setPending] = useState('')
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const navigationButton = useRef<HTMLButtonElement>(null)
  const main = useRef<HTMLElement>(null)
  const navigationId = useId()
  const name = (locale === 'en' ? user.nameEn : user.nameZh)?.trim() || user.account
  const initial = Array.from(name)[0]
  const studentDetail = matchPath('/teacher/:id', pathname)
  const page = pageTitles.find(([path]) => matchPath(path, pathname))?.[1] ?? (studentDetail ? 'classes' : 'overview')
  const PageIcon = navIcons[page]
  const home = links[user.role][0][0]
  return (
    <div className="workspace-shell flex min-h-screen flex-col" data-role={user.role}>
      <SkipLink />
      <header className="workspace-header">
        <div className="workspace-header-inner">
          <button ref={navigationButton} className="workspace-nav-toggle" type="button" aria-label={t('nav')}
            aria-expanded={mobileNavigationOpen} aria-controls={navigationId}
            onClick={() => setMobileNavigationOpen((open) => !open)}>
            {mobileNavigationOpen ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
          </button>
          <NavLink className="workspace-brand" to={home} end onClick={() => setMobileNavigationOpen(false)}>
            <img src="/brand/university-seal.jpg" alt="" width="48" height="48" />
            <span className="min-w-0">
              <span className="workspace-brand-title">{t('loginHeroTitle')}</span>
              <span className="workspace-brand-university">{t('university')}</span>
            </span>
          </NavLink>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger className="workspace-account-trigger" aria-label={`${name} ${t(roleLabels[user.role])} ${t('accountMenu')}`} title={t('accountMenu')}>
              <span className="workspace-avatar" aria-hidden="true"><UserRound size={17} /></span>
              <span className="workspace-account-copy" aria-hidden="true">
                <span>{name}</span>
                <span>{t(roleLabels[user.role])}</span>
              </span>
              <ChevronDown size={14} aria-hidden />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="workspace-account-menu" aria-label={t('accountMenu')} align="end" sideOffset={8} collisionPadding={10}>
                <DropdownMenu.Label className="workspace-identity">
                  <span className="workspace-avatar" aria-hidden="true">{initial}</span>
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-bold">{name}</span>
                    <span className="block text-xs text-muted">{t(roleLabels[user.role])}</span>
                  </span>
                </DropdownMenu.Label>
                <DropdownMenu.Separator className="workspace-account-separator" />
                {user.role === 'ADMIN' && (
                  <DropdownMenu.Item className="workspace-account-item" onSelect={() => { setMobileNavigationOpen(false); navigate('/admin/security') }}>
                    <KeyRound size={16} aria-hidden />{t('passkeySettings')}
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item className="workspace-account-item" disabled={Boolean(pending)} onSelect={() => {
                  const next = locale === 'en' ? 'zh-Hant' : 'en'
                  setPending('locale')
                  void onLocale(next).catch(() => undefined).finally(() => setPending(''))
                }}>
                  <PendingLabel pending={pending === 'locale'}><Globe2 size={16} aria-hidden />{t('language')}</PendingLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Item className="workspace-account-item" disabled={Boolean(pending)} onSelect={() => {
                  setPending('logout')
                  void api('/api/auth/logout', { method: 'POST', body: {} })
                    .then(() => navigate('/login', { replace: true }))
                    .catch(() => undefined)
                    .finally(() => setPending(''))
                }}>
                  <PendingLabel pending={pending === 'logout'}><LogOut size={16} aria-hidden />{t('logout')}</PendingLabel>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>
      <div className="workspace-layout">
        <div className="app-sidebar" data-mobile-open={mobileNavigationOpen}>
          <nav id={navigationId} className="workspace-nav" aria-label={t('nav')} onKeyDown={(event) => {
            if (event.key !== 'Escape' || !mobileNavigationOpen) return
            setMobileNavigationOpen(false)
            navigationButton.current?.focus()
          }}>
            {links[user.role].map(([to, key]) => {
              const Icon = navIcons[key]
              return (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/' || to === '/admin'}
                  className="workspace-nav-link"
                  onClick={(event) => {
                    if (!mobileNavigationOpen || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
                    setMobileNavigationOpen(false)
                    requestAnimationFrame(() => main.current?.focus())
                  }}
                >
                  <Icon size={17} aria-hidden />
                  {t(key)}
                </NavLink>
              )
            })}
          </nav>
        </div>
        <div className="workspace-body">
          <main id="main" ref={main} tabIndex={-1} className="workspace-main outline-none">
            <header className="workspace-heading">
              <span className="workspace-symbol"><PageIcon size={26} aria-hidden /></span>
              <div className="workspace-heading-copy">
                <h1>{t(studentDetail ? 'studentDetail' : page)}</h1>
                <p className="workspace-guide">{t(studentDetail ? 'studentDetailGuide' : `${page}Guide`)}</p>
              </div>
            </header>
            {children}
          </main>
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}

const pillTone: Record<string, [string, 'passed' | 'underReview' | 'missing' | 'info' | 'canGraduate' | 'blocked' | 'pending' | 'office']> = {
  passed: ['bg-[#e5f6ee] text-[#0d6b45] ring-[#b7e0cc]', 'passed'],
  under_review: ['bg-[#fff6e0] text-[#8a5600] ring-[#f0d7a2]', 'underReview'],
  missing: ['bg-[#fdecee] text-[#9e1d22] ring-[#f4c7c8]', 'missing'],
  info: ['bg-[#eef1f6] text-[#3e4a5c] ring-[#d2d6de]', 'info'],
  ready: ['bg-[#e5f6ee] text-[#0d6b45] ring-[#b7e0cc]', 'canGraduate'],
  blocked: ['bg-[#fdecee] text-[#9e1d22] ring-[#f4c7c8]', 'blocked'],
  pending_review: ['bg-[#fff6e0] text-[#8a5600] ring-[#f0d7a2]', 'pending'],
  needs_office: ['bg-[#e8eef6] text-[#314e78] ring-[#c5d4ea]', 'office'],
  no_rules: ['bg-[#e8eef6] text-[#314e78] ring-[#c5d4ea]', 'office'],
}

const pillIcon = {
  passed: Check,
  underReview: Clock,
  missing: Minus,
  info: Info,
  canGraduate: Check,
  blocked: Minus,
  pending: Clock,
  office: Info,
} as const

export function StatusPill({ state, prominent = false, plain = false }: { state: string; prominent?: boolean; plain?: boolean }) {
  const { t } = useI18n()
  const [color, key] = pillTone[state] ?? ['bg-[#eef1f6] text-[#3e4a5c] ring-[#d2d6de]', 'info']
  const Icon = pillIcon[key]
  if (plain) return <span className="inline-flex items-start gap-1.5 text-sm font-semibold"><Icon size={15} className="mt-1 shrink-0" aria-hidden />{t(key)}</span>
  return (
    <span className={`inline-flex items-center ring-1 ${prominent ? 'gap-2 rounded-lg px-3 py-2 text-base font-bold' : 'gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold'} ${color}`}>
      <Icon className={prominent ? 'h-5 w-5 shrink-0' : 'h-3.5 w-3.5'} aria-hidden />
      {t(key)}
    </span>
  )
}

export function Ring({ value, accessibleLabel }: { value: number; accessibleLabel: string }) {
  const radius = 40
  const length = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(1, value))
  const offset = length * (1 - clamped)
  const gradientId = useId().replace(/:/g, '')
  return (
    <div className="student-credit-gauge" role="img" aria-label={`${accessibleLabel} ${Math.round(clamped * 100)}%`}>
      <svg viewBox="0 0 100 100" className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4688d5" />
            <stop offset="100%" stopColor="#244f99" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={radius} stroke="#dfe9f8" strokeWidth="8" fill="none" />
        {clamped > 0 && <circle
          cx="50"
          cy="50"
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth="8"
          fill="none"
          strokeDasharray={length}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />}
      </svg>
      <div className="absolute px-3 text-center" aria-hidden>
        <p className="text-xl font-bold leading-tight text-pine tabular-nums">{Math.round(clamped * 100)}%</p>
      </div>
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty"><Info size={20} aria-hidden /><p>{children}</p></div>
}
