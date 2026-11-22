import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useState } from 'react'
import { LoadError, TableSkeleton } from '../components/feedback'
import { EmptyState } from '../components/shell'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'

type AuditLog = {
  id: string
  action: string
  summaryZh: string
  summaryEn: string
  createdAt: string
  actor: { account: string; nameZh?: string } | null
}

const categoryLabels = {
  account: 'auditAccounts',
  academics: 'auditAcademics',
  evidence: 'auditEvidence',
  system: 'auditOperations',
} as const
type Category = keyof typeof categoryLabels
const categoryByPrefix: Record<string, Category> = {
  user: 'account', password: 'account', passkey: 'account', totp: 'account',
  class: 'academics', rules: 'academics', plan: 'academics', credit: 'academics', recognized: 'academics',
  submission: 'evidence', comment: 'evidence',
}
const pageSize = 12

function getCategory(action: string): Category {
  const prefix = action.split('.')[0]
  return Object.hasOwn(categoryByPrefix, prefix) ? categoryByPrefix[prefix] : 'system'
}

export function AdminAudit() {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<Category | ''>('')
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['audit'],
    queryFn: () => api<{ logs: AuditLog[] }>('/api/admin/audit', { silent: true }),
  })

  if (query.isLoading) return <TableSkeleton />
  if (query.isError || !query.data) return <LoadError pending={query.isFetching} onRetry={() => void query.refetch()} />

  const { logs } = query.data
  const term = search.trim().toLocaleLowerCase(locale)
  const filtered = logs.filter((log) =>
    (!category || getCategory(log.action) === category) &&
    [log.summaryZh, log.summaryEn, log.action, log.actor?.nameZh ?? '', log.actor?.account ?? 'system', log.actor ? '' : t('auditSystemActor')]
      .some((value) => value.toLocaleLowerCase(locale).includes(term)),
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pageCount)
  const start = (current - 1) * pageSize
  const visible = filtered.slice(start, start + pageSize)
  const date = new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Taipei', dateStyle: 'medium' })
  const time = new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Taipei', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <section className="card audit-log" aria-labelledby="audit-log-title">
      <div className="audit-toolbar">
        <div className="audit-toolbar-heading">
          <h2 className="section-title" id="audit-log-title">{t('auditRecords')}</h2>
          <p className="text-sm text-muted">{t('auditRecent')}</p>
        </div>
        <div className="audit-filters">
          <label className="text-sm font-semibold">
            {t('auditSearch')}
            <span className="account-search">
              <Search size={17} aria-hidden />
              <input className="field w-full" type="search" value={search} placeholder={t('auditSearchHint')}
                onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
            </span>
          </label>
          <label className="text-sm font-semibold">
            {t('auditCategory')}
            <select className="field w-full" value={category}
              onChange={(event) => { setCategory(event.target.value as Category | ''); setPage(1) }}>
              <option value="">{t('auditAllCategories')}</option>
              {(Object.keys(categoryLabels) as Category[]).map((kind) => <option key={kind} value={kind}>{t(categoryLabels[kind])}</option>)}
            </select>
          </label>
        </div>
        <div className="audit-results">
          <p role="status" className="text-sm text-muted tabular-nums">{t('auditResults')} {filtered.length} / {logs.length}</p>
          {(search || category) && <button type="button" className="btn btn-ghost" onClick={() => { setSearch(''); setCategory(''); setPage(1) }}>{t('directoryClear')}</button>}
        </div>
      </div>

      {visible.length === 0 ? <EmptyState>{t(term || category ? 'noAuditMatches' : 'auditEmpty')}</EmptyState> : (
        <table className="audit-table" role="table" aria-labelledby="audit-log-title">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">{t('auditEvent')}</th>
              <th role="columnheader" scope="col">{t('auditActor')}</th>
              <th role="columnheader" scope="col">{t('auditTime')}</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {visible.map((log) => {
              const kind = getCategory(log.action)
              const summary = (locale === 'en' ? log.summaryEn || log.summaryZh : log.summaryZh || log.summaryEn) || log.action
              const actor = log.actor?.nameZh || log.actor?.account || t('auditSystemActor')
              const createdAt = new Date(log.createdAt)
              return <tr key={log.id} role="row">
                <td role="cell" className="audit-event-cell">
                  <span className="audit-category" data-category={kind}>{t(categoryLabels[kind])}</span>
                  <p className="audit-event-summary">{summary}</p>
                </td>
                <td role="cell" className="audit-actor-cell">
                  <span className="audit-mobile-label" aria-hidden="true">{t('auditActor')}</span>
                  <strong>{actor}</strong>
                  {log.actor?.account && log.actor.account !== actor && <span className="audit-meta">{log.actor.account}</span>}
                </td>
                <td role="cell" className="audit-time-cell">
                  <span className="audit-mobile-label" aria-hidden="true">{t('auditTime')}</span>
                  <time dateTime={log.createdAt}><strong>{date.format(createdAt)}</strong><span className="audit-meta">{time.format(createdAt)}</span></time>
                </td>
              </tr>
            })}
          </tbody>
        </table>
      )}
      {pageCount > 1 && <footer className="audit-pagination">
        <p className="text-sm text-muted tabular-nums">{start + 1}–{start + visible.length} / {filtered.length}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" disabled={current <= 1} onClick={() => setPage(current - 1)}><ChevronLeft size={16} aria-hidden />{t('directoryPrevious')}</button>
          <button type="button" className="btn btn-ghost" disabled={current >= pageCount} onClick={() => setPage(current + 1)}>{t('directoryNext')}<ChevronRight size={16} aria-hidden /></button>
        </div>
      </footer>}
    </section>
  )
}
