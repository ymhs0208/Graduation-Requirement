import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ArrowRight, Bell, CalendarDays, ChevronDown, Clock, FileUp, ListChecks, Megaphone } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageSkeleton, PendingLabel, TableSkeleton } from '../components/feedback'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { conditionDescription } from '../lib/conditions'
import { showGraduationVerdict, type Progress } from '../lib/progress'
import { EmptyState, Ring, StatusPill } from '../components/shell'
import { CurriculumPlan } from './curriculum-plan'
import type { PlanCourse } from '../lib/plan'

type Dashboard = {
  profile: { nameZh: string; nameEn: string; cohortYear: number; classNameZh: string; classNameEn: string; onboardingCompleted: boolean; account: string }
  progress: Progress
}


export function StudentHome() {
  const { t, locale } = useI18n()
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/me/dashboard') })
  const client = useQueryClient()
  const [step, setStep] = useState(0)
  const [leaving, setLeaving] = useState(false)
  if (query.isLoading) return <PageSkeleton />
  if (!query.data) return (
    <section className="card p-5">
      <p role="alert" className="text-sm text-muted">{t('loadFailed')}</p>
      <button className="btn btn-ghost mt-3" type="button" onClick={() => void query.refetch()}>{t('tryAgain')}</button>
    </section>
  )
  const { profile, progress } = query.data
  const categories = progress.categories.flatMap((item) =>
    item.isPlaceholder || item.requiredCredits == null ? [] : [{ ...item, requiredCredits: item.requiredCredits }],
  )
  const thresholds = progress.thresholds.filter((item) => !item.isPlaceholder && item.state !== 'unpublished')
  const requiredTotal = progress.totalConfirmed && progress.requiredTotal != null && progress.requiredTotal > 0 ? progress.requiredTotal : null
  const showVerdict = showGraduationVerdict(progress.verdict)
  const name = (locale === 'en' ? profile.nameEn : profile.nameZh) || profile.account
  const className = locale === 'en' ? profile.classNameEn : profile.classNameZh
  const formatCredits = new Intl.NumberFormat(locale, { maximumFractionDigits: 8 })
  const steps = [t('onboarding1'), t('onboarding2'), t('onboarding3'), t('onboarding4')]
  return (
    <div className="space-y-6">
      {!profile.onboardingCompleted && (
        <div className="card border-teal/30 p-5 sm:p-6">
          <p className="text-sm font-semibold text-teal">{step + 1} / 4</p>
          <p className="mt-2 text-lg leading-8">{steps[step]}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {step < 3 ? (
              <button className="btn btn-ink" type="button" onClick={() => setStep(step + 1)}>
                {t('next')}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                type="button"
                disabled={leaving}
                onClick={async () => {
                  setLeaving(true)
                  try {
                    await api('/api/me/onboarding', { method: 'POST', body: {}, success: t('saved') })
                    await client.invalidateQueries({ queryKey: ['dashboard'] })
                  } finally {
                    setLeaving(false)
                  }
                }}
              >
                <PendingLabel pending={leaving}>{t('done')}</PendingLabel>
              </button>
            )}
            <button
              className="btn btn-ghost"
              type="button"
              disabled={leaving}
              onClick={async () => {
                setLeaving(true)
                try {
                  await api('/api/me/onboarding', { method: 'POST', body: {}, success: t('saved') })
                  await client.invalidateQueries({ queryKey: ['dashboard'] })
                } finally {
                  setLeaving(false)
                }
              }}
            >
              <PendingLabel pending={leaving}>{t('skip')}</PendingLabel>
            </button>
          </div>
        </div>
      )}
      <div className="student-overview">
        <section className="card student-profile">
          <header className="student-profile-main">
            <span className="student-profile-icon" aria-hidden="true">{Array.from(name)[0]}</span>
            <div className="min-w-0">
              <h2 className="text-3xl font-bold tracking-tight">{name}</h2>
              <p className="mt-1 text-sm text-muted">{[profile.account, className, profile.cohortYear ? `${profile.cohortYear} ${t('cohort')}` : ''].filter(Boolean).join(' · ')}</p>
            </div>
          </header>
          {(showVerdict || progress.delayed) && <section className="student-profile-status" aria-labelledby="graduation-status">
            <div className={showVerdict ? 'student-status-primary' : 'px-1'}>
              <h3 id="graduation-status" className="text-sm font-semibold text-muted">{t('overviewGraduationStatus')}</h3>
              {showVerdict && <StatusPill state={progress.verdict} prominent />}
            </div>
            {progress.delayed && (
              <ul className="student-status-notes">
                <li className="student-status-note"><Clock size={17} aria-hidden />{t('delayed')}</li>
              </ul>
            )}
          </section>}
          <div className="student-shortcuts">
            <Link to="/plan" className="btn btn-ghost"><CalendarDays size={17} aria-hidden />{t('plan')}<ArrowRight size={15} className="ml-auto" aria-hidden /></Link>
            <Link to="/evidence" className="btn btn-primary"><FileUp size={17} aria-hidden />{t('upload')}<ArrowRight size={15} className="ml-auto" aria-hidden /></Link>
          </div>
        </section>
        {requiredTotal !== null && <section className="card student-credit-summary">
          <div>
            <h2 className="section-title">{t('creditProgress')}</h2>
            <p className="student-credit-number">{progress.earnedTowardTotal}<span> / {requiredTotal} {t('creditUnit')}</span></p>
            <p className="text-sm text-muted">{progress.earnedTowardTotal >= requiredTotal
              ? t('overviewCreditMet')
              : `${t('overviewCreditGap')} ${Math.round((requiredTotal - progress.earnedTowardTotal) * 10) / 10} ${t('creditUnit')}`}</p>
          </div>
          <Ring value={progress.earnedTowardTotal / requiredTotal} accessibleLabel={t('creditProgress')} />
        </section>}
      </div>
      {progress.missing.length > 0 && (
        <section className="student-attention">
          <span className="student-attention-icon"><ListChecks size={22} aria-hidden /></span>
          <div className="min-w-0">
            <h2 className="section-title">{t('needsAttention')}</h2>
            <ul className="student-attention-list">
              {progress.missing.map((item) => <li key={item.nameZh}>{locale === 'en' ? item.nameEn : item.nameZh}</li>)}
            </ul>
          </div>
        </section>
      )}
      <div className="student-detail">
        {categories.length > 0 && <section className="card">
          <header className="panel-heading"><h2 className="section-title">{t('creditBreakdown')}</h2></header>
          <ul className="credit-category-list">
            {categories.map((category) => {
              const name = locale === 'en' ? category.nameEn : category.nameZh
              const remaining = Math.max(0, category.requiredCredits - category.earned)
              const completed = Math.max(0, Math.min(category.requiredCredits, category.earned))
              return (
                <li key={category.code} className="credit-category">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <h3 className="font-bold">{name}</h3>
                    <StatusPill state={category.met ? 'passed' : 'missing'} />
                  </div>
                  <dl className="credit-category-metrics">
                    {([
                      ['earned', category.earned],
                      ['required', category.requiredCredits],
                      ['creditCategoryRemaining', remaining],
                    ] as const).map(([label, value]) => (
                      <div key={label} className={`credit-category-metric ${label === 'creditCategoryRemaining' && value > 0 ? 'credit-category-gap' : ''}`}>
                        <dt>{t(label)}</dt>
                        <dd>{formatCredits.format(value)} <span>{t('creditUnit')}</span></dd>
                      </div>
                    ))}
                  </dl>
                  {category.requiredCredits > 0 && <progress className="credit-category-progress" data-complete={completed >= category.requiredCredits}
                    aria-label={`${name} · ${t('creditCategoryProgress')}`} value={completed} max={category.requiredCredits} />}
                  {(!!category.minDomains || !category.countsTowardTotal) && <div className="credit-category-notes">
                    {!!category.minDomains && <p>{t('ruleMinDomains')} <strong>{category.domains} / {category.minDomains}</strong></p>}
                    {!category.countsTowardTotal && <p>{t('ruleNotAdded')}</p>}
                  </div>}
                </li>
              )
            })}
          </ul>
        </section>}
          {thresholds.length > 0 && <section className="card">
            <header className="panel-heading"><h2 className="section-title">{t('graduationRequirements')}</h2></header>
            {thresholds.map((threshold) => (
              <details key={threshold.id} className="student-condition">
                <summary>
                  <span className="min-w-0 break-words font-semibold">{locale === 'en' ? threshold.nameEn : threshold.nameZh}</span>
                  <span className="student-condition-meta">
                  <StatusPill state={threshold.state} />
                  <ChevronDown size={16} className="shrink-0 text-muted" aria-hidden />
                  </span>
                </summary>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted">{conditionDescription(threshold, locale, t('recognizedRequirement'))}</p>
              </details>
            ))}
          </section>}
      </div>
    </div>
  )
}

export function PlanPage() {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: ['plan'],
    queryFn: () => api<{ items: PlanCourse[]; progress: Progress }>('/api/me/plan'),
  })
  if (query.isLoading) return <PageSkeleton />
  if (!query.data) return (
    <div className="card p-4">
      <p role="alert" className="text-sm text-muted">{t('loadFailed')}</p>
      <button type="button" className="btn btn-ghost mt-2" onClick={() => void query.refetch()}>{t('tryAgain')}</button>
    </div>
  )
  const { progress, items } = query.data
  const minimum = (code: string) => progress.categories.find((category) => category.code === code && !category.isPlaceholder)?.requiredCredits ?? null
  return (
    <CurriculumPlan key={progress.cohortYear} courses={items} cohort={progress.cohortYear}
      minimums={{ MAJOR_REQUIRED: minimum('MAJOR_REQUIRED'), MAJOR_ELECTIVE: minimum('ELECTIVE'), LIBERAL: minimum('LIBERAL') }} />
  )
}

export function NotificationsPage({ canPublish }: { canPublish: boolean }) {
  const { t, locale } = useI18n()
  const query = useQuery({
    queryKey: ['notes'],
    queryFn: () => api<{ notifications: { id: string; kind: string; titleZh: string; titleEn: string; bodyZh: string; bodyEn: string; readAt: string | null; createdAt: string }[] }>('/api/inbox'),
  })
  if (query.isLoading || !query.data) return query.isLoading ? <TableSkeleton /> : <p className="text-sm text-muted">{t('loading')}</p>
  return (
    <div className="space-y-3">
      {canPublish && <Link className="btn btn-primary" to="/admin/announcements"><Megaphone size={17} aria-hidden />{t('announcementCompose')}</Link>}
      {query.data.notifications.length === 0 && <EmptyState>{t('empty')}</EmptyState>}
      {query.data.notifications.map((item) => (
        <article key={item.id} className={`card workspace-event ${item.readAt ? '' : 'workspace-event-unread'}`}>
          <span className="workspace-event-icon">{item.kind === 'announcement' ? <Megaphone size={18} aria-hidden /> : <Bell size={18} aria-hidden />}</span>
          <div className="min-w-0">
            <time className="text-xs text-muted" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString(locale)}</time>
            {item.kind === 'announcement' && <span className="tag ml-2">{t('announcementBadge')}</span>}
            <h2 className="font-semibold">{locale === 'en' ? item.titleEn : item.titleZh}</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{locale === 'en' ? item.bodyEn : item.bodyZh}</p>
          </div>
        </article>
      ))}
    </div>
  )
}
