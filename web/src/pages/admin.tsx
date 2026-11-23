import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Award, CalendarClock, CalendarDays, ClipboardCheck, Download, GraduationCap, TriangleAlert, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { useConfirm, useLock } from '../components/confirm'
import { EmptyState, StatusPill } from '../components/shell'
import { api, downloadCsv, errorMessage } from '../lib/api'
import { LoadError, PageSkeleton, PendingLabel, StepStatus } from '../components/feedback'
import { useI18n } from '../lib/i18n'

type StatsResponse = {
  cohortYear?: number
  cohorts: number[]
  stats: { englishPassRate: number; certificationRate: number; atRisk: number; delayed: number } | null
  students: { account: string; nameZh: string; nameEn: string; classNameZh: string; verdict: string; english: string }[]
}

export function AdminStats() {
  const { t, locale } = useI18n()
  const confirm = useConfirm()
  const [cohort, setCohort] = useState<number | ''>('')
  const query = useQuery({
    queryKey: ['stats', cohort],
    queryFn: () => api<StatsResponse>(`/api/admin/stats${cohort ? `?cohort=${cohort}` : ''}`),
    placeholderData: keepPreviousData,
  })
  const client = useQueryClient()
  const { busy, run } = useLock()
  const [job, setJob] = useState<'export' | 'preaudit' | ''>('')
  const [step, setStep] = useState(-1)
  const [message, setMessage] = useState('')
  if (query.isLoading) return <PageSkeleton />
  if (query.isError || !query.data) return <LoadError pending={query.isFetching} onRetry={() => void query.refetch()} />
  const { stats, students, cohortYear, cohorts } = query.data
  const actionsDisabled = busy || query.isPlaceholderData || !cohortYear
  return (
    <div className="stats-page">
      <div className="card stats-toolbar">
        <div className="stats-cohort">
          <span className="stats-icon"><CalendarDays size={20} aria-hidden /></span>
          <label className="stats-cohort-field">
            <span>{t('cohort')}</span>
            <select className="field" value={cohort || cohortYear || ''} disabled={busy || !cohorts.length} onChange={(event) => setCohort(Number(event.target.value))}>
              {!cohorts.length && <option value="">—</option>}
              {cohorts.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="stats-toolbar-actions">
          <button
            className="btn btn-ghost"
            type="button"
            disabled={actionsDisabled}
            onClick={() => run(async () => {
              setMessage('')
              setJob('export')
              setStep(0)
              try {
                await downloadCsv(`/api/admin/export?cohort=${cohortYear}`, `graduation-${cohortYear}.csv`)
                setStep(2)
                toast.success(t('exportDone'))
              } catch (error) {
                setMessage(errorMessage(error, locale, t('exportFailed')))
                setStep(-1)
              } finally {
                window.setTimeout(() => { setJob(''); setStep(-1) }, 900)
              }
            })}
          >
            <PendingLabel pending={busy && job === 'export'}><Download size={16} aria-hidden />{t('export')}</PendingLabel>
          </button>
          <button
            className="btn btn-primary stats-primary"
            type="button"
            disabled={actionsDisabled}
            onClick={() => run(async () => {
              if (!await confirm({ title: t('preaudit'), body: t('preauditConfirm'), confirm: t('preaudit') })) return
              setMessage('')
              setJob('preaudit')
              setStep(0)
              try {
                await api('/api/admin/preaudit', { method: 'POST', body: { cohortYear }, success: t('preauditDone'), timeout: 60000, silent: true })
                setStep(1)
                await client.invalidateQueries({ queryKey: ['notes'] })
                setStep(2)
              } catch (error) {
                setMessage(errorMessage(error, locale, t('error')))
                setStep(-1)
              } finally {
                window.setTimeout(() => { setJob(''); setStep(-1) }, 900)
              }
            })}
          >
            <PendingLabel pending={busy && job === 'preaudit'}><ClipboardCheck size={16} aria-hidden />{t('preaudit')}</PendingLabel>
          </button>
        </div>
      </div>
      {message && <p role="alert" className="login-result">{message}</p>}
      {job === 'export' && step >= 0 && <StepStatus steps={[t('stepExport'), t('stepDownload'), t('stepDone')]} current={step} />}
      {job === 'preaudit' && step >= 0 && <StepStatus steps={[t('stepScan'), t('stepNotify'), t('stepDone')]} current={step} />}
      {query.isPlaceholderData ? <PageSkeleton /> : <>
        {stats && (
          <div className="stats-summary">
            <section className="card stats-metric-panel" aria-labelledby="stats-rates-title">
              <header className="stats-panel-heading">
                <h2 className="section-title" id="stats-rates-title">{t('statsRequirementRates')}</h2>
                <p className="text-sm text-muted">{t('statsActiveOnly')}</p>
              </header>
              <div className="stats-rate-list">
                {([
                  ['englishRate', stats.englishPassRate, GraduationCap, 'english'],
                  ['certRate', stats.certificationRate, Award, 'certification'],
                ] as const).map(([label, rate, Icon, tone]) => {
                  const percent = Math.round(rate * 100)
                  return (
                    <div key={label} className="stats-rate" data-tone={tone}>
                      <span className="stats-icon"><Icon size={19} aria-hidden /></span>
                      <div className="stats-rate-copy">
                        <div className="stats-rate-label">
                          <h3 className="metric-title">{t(label)}</h3>
                          <p className="stats-value">{percent}%</p>
                        </div>
                        <progress className="stats-rate-bar" value={percent} max={100} aria-hidden />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
            <section className="card stats-metric-panel" aria-labelledby="stats-tracking-title">
              <header className="stats-panel-heading">
                <h2 className="section-title" id="stats-tracking-title">{t('statsProgressTracking')}</h2>
              </header>
              <div className="stats-counts">
                {([
                  ['atRisk', stats.atRisk, TriangleAlert, 'risk'],
                  ['delayed', stats.delayed, CalendarClock, 'delayed'],
                ] as const).map(([label, count, Icon, tone]) => (
                  <div key={label} className="stats-count" data-tone={tone}>
                    <span className="stats-icon"><Icon size={19} aria-hidden /></span>
                    <h3 className="metric-title">{t(label)}</h3>
                    <p className="stats-value">{count.toLocaleString(locale)}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
        <section className="card stats-roster" aria-labelledby="stats-roster-title">
          <header className="panel-heading stats-roster-heading">
            <span className="stats-icon"><UsersRound size={20} aria-hidden /></span>
            <h2 className="section-title" id="stats-roster-title">{t('studentList')}</h2>
            <span className="stats-roster-count">{students.length.toLocaleString(locale)} {t(students.length === 1 ? 'statsStudentUnitOne' : 'statsStudentUnit')}</span>
          </header>
          {!students.length ? <div className="stats-empty"><EmptyState>{t('empty')}</EmptyState></div> : (
            <table className="stats-table" role="table" aria-labelledby="stats-roster-title">
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">{t('directoryIdentity')}</th>
                  <th scope="col" role="columnheader">{t('overviewGraduationStatus')}</th>
                  <th scope="col" role="columnheader">{t('statsEnglishStatus')}</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {students.map((student) => {
                  const name = (locale === 'en' ? student.nameEn || student.nameZh : student.nameZh) || student.account
                  return (
                    <tr key={student.account} role="row">
                      <th scope="row" role="rowheader" className="stats-identity-cell">
                        <div className="stats-identity">
                          <span className="stats-avatar" aria-hidden>{Array.from(name)[0]}</span>
                          <div>
                            <p className="item-title">{name}</p>
                            <p className="stats-identity-meta">
                              <span className="stats-id">{student.account}</span>
                              {student.classNameZh && <span>{student.classNameZh}</span>}
                            </p>
                          </div>
                        </div>
                      </th>
                      <td role="cell">
                        <span className="stats-mobile-label" aria-hidden>{t('overviewGraduationStatus')}</span>
                        <StatusPill state={student.verdict} />
                      </td>
                      <td role="cell">
                        <span className="stats-mobile-label" aria-hidden>{t('statsEnglishStatus')}</span>
                        <StatusPill state={student.english} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </>}
    </div>
  )
}
