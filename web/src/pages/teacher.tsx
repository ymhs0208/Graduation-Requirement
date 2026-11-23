import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Search } from 'lucide-react'
import { TableSkeleton } from '../components/feedback'
import { EmptyState, StatusPill } from '../components/shell'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { showGraduationVerdict } from '../lib/progress'

type Row = {
  id: string
  account: string
  nameZh: string
  nameEn: string
  classNameZh: string
  classNameEn?: string
  cohortYear?: number | null
  verdict: string
  earnedTowardTotal: number
  requiredTotal: number | null
  missing: { nameZh: string; nameEn: string }[]
}

const rosterPageSize = 12

export function TeacherHome() {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['roster'],
    queryFn: async () => {
      const [{ students }, { classes }] = await Promise.all([
        api<{ students: Row[] }>('/api/teacher/students'),
        api<{ classes: { id: string; cohortYear: number; nameZh: string; nameEn: string }[] }>('/api/teacher/classes'),
      ])
      return { students, classes }
    },
  })
  if (query.isLoading) return <TableSkeleton />
  if (query.isError || !query.data) return (
    <section className="card p-5">
      <p className="text-sm text-muted" role="alert">{t('loadFailed')}</p>
      <button type="button" className="btn btn-ghost mt-3" onClick={() => void query.refetch()}>{t('tryAgain')}</button>
    </section>
  )

  const { students, classes } = query.data
  const selectedClass = classes.find((item) => item.id === classFilter)
  const scope = selectedClass
    ? students.filter((student) => student.cohortYear === selectedClass.cohortYear && student.classNameZh === selectedClass.nameZh)
    : students
  const term = search.trim().toLowerCase()
  const filtered = scope.filter((student) =>
    [student.account, student.nameZh, student.nameEn].some((value) => value.toLowerCase().includes(term)),
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / rosterPageSize))
  const currentPage = Math.min(page, pageCount)
  const start = (currentPage - 1) * rosterPageSize
  const visible = filtered.slice(start, start + rosterPageSize)
  const hasFilters = Boolean(term)
  return (
    <section className="card" aria-labelledby="roster-heading">
      <header className="panel-heading">
        <div className="roster-heading">
          <h2 id="roster-heading" className="section-title">{t('studentList')}</h2>
          <dl className="roster-totals">
            <div><dt>{t('rosterStudents')}</dt><dd>{scope.length}</dd></div>
            <div><dt>{t('rosterEligible')}</dt><dd>{scope.filter((student) => student.verdict === 'ready').length}</dd></div>
          </dl>
        </div>
        <div className="roster-filters">
          <label className="text-sm font-semibold">{t('rosterClass')}
            <select className="field w-full" value={selectedClass?.id ?? ''} onChange={(event) => { setClassFilter(event.target.value); setPage(1) }}>
              <option value="">{t('rosterAllClasses')}</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {locale === 'en' ? item.nameEn || item.nameZh : item.nameZh} ({item.cohortYear})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">{t('rosterSearch')}
            <span className="account-search">
              <Search size={17} aria-hidden />
              <input className="field w-full" type="search" placeholder={t('rosterSearchHint')} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
            </span>
          </label>
        </div>
        {hasFilters && <div className="roster-search-results">
          <p className="text-sm text-muted" role="status">{t('rosterResults')} {filtered.length} / {scope.length}</p>
          <button type="button" className="btn btn-ghost" onClick={() => { setSearch(''); setPage(1) }}>{t('rosterClearSearch')}</button>
        </div>}
      </header>
      {visible.length === 0 ? <EmptyState>{t(hasFilters ? 'rosterNoMatch' : 'rosterEmpty')}</EmptyState> : (
        <ul className="roster-list">
          {visible.map((student) => {
            const name = (locale === 'en' ? student.nameEn : student.nameZh) || student.account
            const group = locale === 'en' ? student.classNameEn || student.classNameZh : student.classNameZh
            const target = student.requiredTotal
            const width = target && target > 0 ? Math.max(0, Math.min(100, student.earnedTowardTotal / target * 100)) : null
            return (
              <li key={student.id} className="roster-row">
                <div className="roster-person">
                  <span className="workspace-avatar" aria-hidden="true">{Array.from(name)[0]}</span>
                  <div className="min-w-0">
                    <h3 className="item-title">{name}</h3>
                    <p className="text-sm text-muted">{[student.account, group].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>
                {showGraduationVerdict(student.verdict) && <StatusPill state={student.verdict} plain />}
                <div className="roster-credits">
                  <p className="text-xs text-muted">{t('creditProgress')}</p>
                  <p className="font-bold tabular-nums">{student.earnedTowardTotal}{width !== null && <span className="text-sm font-medium text-muted"> / {target}</span>} <span className="text-xs font-medium text-muted">{t('creditUnit')}</span></p>
                  {width !== null && <div className="credit-track mt-1.5" aria-hidden="true"><div className="h-full rounded-full bg-teal" style={{ width: `${width}%` }} /></div>}
                </div>
                {student.missing.length > 0 && (
                  <p className="roster-missing text-xs text-muted"><strong className="text-ink">{t('needsAttention')}</strong> · {student.missing.map((item) => locale === 'en' ? item.nameEn : item.nameZh).join(locale === 'en' ? ', ' : '、')}</p>
                )}
                <Link className="roster-open" to={`/teacher/${student.id}`} aria-label={`${t('rosterViewProgress')} · ${name} · ${student.account}`}>
                  {t('rosterViewProgress')}<ArrowRight size={15} aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {pageCount > 1 && <footer className="directory-results border-t border-line">
        <p className="text-sm text-muted">{start + 1}–{start + visible.length} / {filtered.length}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{t('directoryPrevious')}</button>
          <button type="button" className="btn btn-ghost" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>{t('directoryNext')}</button>
        </div>
      </footer>}
    </section>
  )
}
