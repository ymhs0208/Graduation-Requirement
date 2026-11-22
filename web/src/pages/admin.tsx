import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Award, CalendarClock, GraduationCap, History, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { useConfirm, useLock } from '../components/confirm'
import { EmptyState, StatusPill } from '../components/shell'
import { api, downloadCsv, errorMessage } from '../lib/api'
import { LoadError, PageSkeleton, PendingLabel, StepStatus } from '../components/feedback'
import { useI18n } from '../lib/i18n'

export function AdminStats() {
  const { t, locale } = useI18n()
  const confirm = useConfirm()
  const [cohort, setCohort] = useState<number | ''>('')
  const query = useQuery({
    queryKey: ['stats', cohort],
    queryFn: () => api<{ cohortYear: number; cohorts: number[]; stats: { students: number; englishPassRate: number; certificationRate: number; atRisk: number; delayed: number; ready: number; blocked: number; needsOffice: number } | null; students: { account: string; nameZh: string; nameEn: string; verdict: string; atRisk: boolean; english: string }[] }>(`/api/admin/stats${cohort ? `?cohort=${cohort}` : ''}`),
  })
  const client = useQueryClient()
  const { busy, run } = useLock()
  const [job, setJob] = useState<'export' | 'preaudit' | ''>('')
  const [step, setStep] = useState(-1)
  const [message, setMessage] = useState('')
  if (query.isLoading) return <PageSkeleton />
  if (query.isError || !query.data) return <LoadError pending={query.isFetching} onRetry={() => void query.refetch()} />
  const stats = query.data.stats
  return (
    <div className="space-y-5">
      <div className="workspace-toolbar">
        <label className="text-sm font-medium">
          {t('cohort')}
          <select className="field ml-2 mt-0 w-auto" value={query.data.cohortYear} onChange={(event) => setCohort(Number(event.target.value))}>
            {query.data.cohorts.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={busy}
          onClick={() => run(async () => {
            setMessage('')
            setJob('export')
            setStep(0)
            try {
              await downloadCsv(`/api/admin/export?cohort=${query.data?.cohortYear}`, `graduation-${query.data?.cohortYear}.csv`)
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
          <PendingLabel pending={busy && job === 'export'}>{t('export')}</PendingLabel>
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy}
          onClick={() => run(async () => {
            if (!await confirm({ title: t('preaudit'), body: t('preauditConfirm'), confirm: t('preaudit') })) return
            setMessage('')
            setJob('preaudit')
            setStep(0)
            try {
              await api('/api/admin/preaudit', { method: 'POST', body: { cohortYear: query.data?.cohortYear }, success: t('preauditDone'), timeout: 60000, silent: true })
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
          <PendingLabel pending={busy && job === 'preaudit'}>{t('preaudit')}</PendingLabel>
        </button>
      </div>
      {message && <p role="alert" className="login-result">{message}</p>}
      {job === 'export' && step >= 0 && <StepStatus steps={[t('stepExport'), t('stepDownload'), t('stepDone')]} current={step} />}
      {job === 'preaudit' && step >= 0 && <StepStatus steps={[t('stepScan'), t('stepNotify'), t('stepDone')]} current={step} />}
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([
            [t('englishRate'), `${Math.round(stats.englishPassRate * 100)}%`, GraduationCap],
            [t('certRate'), `${Math.round(stats.certificationRate * 100)}%`, Award],
            [t('atRisk'), String(stats.atRisk), TriangleAlert],
            [t('delayed'), String(stats.delayed), CalendarClock],
          ] as const).map(([label, value, Icon]) => (
            <article key={label} className="card metric-card">
              <span className="workspace-event-icon"><Icon size={20} aria-hidden /></span>
              <div>
                <p className="text-sm text-muted">{label}</p>
                <p className="mt-1 text-3xl font-bold tracking-tight">{value}</p>
              </div>
            </article>
          ))}
        </div>
      )}
      <section className="card">
        <header className="panel-heading flex items-center justify-between gap-2">
          <h2 className="section-title">{t('studentList')}</h2>
          <span className="tag tabular-nums">{query.data.students.length}</span>
        </header>
        {query.data.students.length === 0 ? <EmptyState>{t('empty')}</EmptyState> : (
        <div className="table-panel">
        <table className="data-table">
          <caption className="sr-only">{t('stats')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('account')}</th>
              <th scope="col">{locale === 'en' ? 'Name' : '姓名'}</th>
              <th scope="col">{t('overview')}</th>
              <th scope="col">{t('englishRate')}</th>
            </tr>
          </thead>
          <tbody>
            {query.data.students.map((student) => (
              <tr key={student.account}>
                <td className="font-medium">{student.account}</td>
                <td>{locale === 'en' ? student.nameEn : student.nameZh}</td>
                <td>
                  <StatusPill state={student.verdict} />
                </td>
                <td>
                  <StatusPill state={student.english} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        )}
      </section>
    </div>
  )
}

export function AdminAudit() {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState('')
  const query = useQuery({
    queryKey: ['audit'],
    queryFn: () => api<{ logs: { id: string; action: string; summaryZh: string; summaryEn: string; createdAt: string; actor: { account: string } | null }[] }>('/api/admin/audit'),
  })
  if (query.isLoading) return <PageSkeleton />
  if (query.isError || !query.data) return <LoadError pending={query.isFetching} onRetry={() => void query.refetch()} />
  const term = search.trim().toLowerCase()
  const logs = query.data.logs.filter((log) =>
    [log.summaryZh, log.summaryEn, log.action, log.actor?.account ?? 'system'].some((value) => value.toLowerCase().includes(term)),
  )
  return (
    <div className="space-y-4">
      <label className="card block p-4 text-sm font-semibold">
        {t('auditSearch')}
        <input className="field block w-full max-w-xl" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {logs.length === 0 && <EmptyState>{term ? t('noAuditMatches') : t('empty')}</EmptyState>}
      <ul className="space-y-2">
      {logs.map((log) => (
        <li key={log.id} className="card workspace-event text-sm">
          <span className="workspace-event-icon"><History size={18} aria-hidden /></span>
          <div className="min-w-0">
            <p className="text-xs text-muted"><time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString(locale)}</time> · {log.actor?.account ?? 'system'}</p>
            <p className="mt-1">{locale === 'en' ? log.summaryEn : log.summaryZh}</p>
            <span className="tag mt-2 break-all">{log.action}</span>
          </div>
        </li>
      ))}
      </ul>
    </div>
  )
}
