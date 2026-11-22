import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, CircleCheck, Search, UsersRound } from 'lucide-react'
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
const rosterClassKey = (year: number | null | undefined, name: string) => JSON.stringify([year ?? null, name])

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
  if (!query.data) return (
    <section className="card p-5">
      <p className="text-sm text-muted" role="alert">{t('loadFailed')}</p>
      <button type="button" className="btn btn-ghost mt-3" onClick={() => void query.refetch()}>{t('tryAgain')}</button>
    </section>
  )

  const { students, classes } = query.data
  const counts = new Map<string, number>()
  for (const student of students) {
    const key = rosterClassKey(student.cohortYear, student.classNameZh)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const selectedClass = classes.find((item) => rosterClassKey(item.cohortYear, item.nameZh) === classFilter)
  const classTitle = (item: { nameZh: string; nameEn: string }) => locale === 'en' ? item.nameEn || item.nameZh : item.nameZh
  const scope = selectedClass ? students.filter((student) => rosterClassKey(student.cohortYear, student.classNameZh) === classFilter) : students
  const scopeTitle = selectedClass ? classTitle(selectedClass) : t('rosterAllClasses')
  const term = search.trim().toLowerCase()
  const filtered = scope.filter((student) =>
    [student.account, student.nameZh, student.nameEn].some((value) => value.toLowerCase().includes(term)),
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / rosterPageSize))
  const currentPage = Math.min(page, pageCount)
  const start = (currentPage - 1) * rosterPageSize
  const visible = filtered.slice(start, start + rosterPageSize)
  const hasFilters = Boolean(search)
  return (
    <div className="roster-workspace">
      <aside className="card roster-class-panel" aria-label={t('rosterClass')}>
        <div className="roster-class-heading">
          <BookOpen size={19} aria-hidden />
          <h2 className="section-title">{t('rosterClass')}</h2>
        </div>
        <div className="roster-class-picker" role="group" aria-label={t('rosterClass')}>
          <button type="button" aria-pressed={!selectedClass} onClick={() => { setClassFilter(''); setPage(1) }}>
            <span className="font-semibold">{t('rosterAllClasses')}</span><span className="roster-class-count">{students.length}</span>
          </button>
          {classes.map((item) => {
            const key = rosterClassKey(item.cohortYear, item.nameZh)
            return (
              <button type="button" key={item.id} aria-pressed={selectedClass?.id === item.id} onClick={() => { setClassFilter(key); setPage(1) }}>
                <span className="min-w-0">
                  <span className="block font-semibold">{classTitle(item)}</span>
                  <span className="roster-class-year">{item.cohortYear}</span>
                </span>
                <span className="roster-class-count">{counts.get(key) ?? 0}</span>
              </button>
            )
          })}
        </div>
      </aside>
      <div className="min-w-0 space-y-4">
      <section className="roster-overview">
        <h2 className="text-xl font-bold">{scopeTitle}</h2>
        <dl className="roster-metrics">
          {([
            ['rosterStudents', scope.length, UsersRound],
            ['rosterEligible', scope.filter((student) => student.verdict === 'ready').length, CircleCheck],
          ] as const).map(([label, count, Icon]) => (
            <div key={label} className="roster-metric">
              <dt><Icon size={16} aria-hidden />{t(label)}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card roster-results">
        <header className="panel-heading">
          <div className="roster-filters">
            <label className="text-sm font-semibold">{t('rosterSearch')}
              <span className="account-search">
                <Search size={17} aria-hidden />
                <input className="field w-full" type="search" placeholder={t('rosterSearchHint')} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
              </span>
            </label>
          </div>
        </header>
        <div className="directory-results">
          <p className="text-sm text-muted" role="status">{t('rosterResults')} {filtered.length} / {scope.length}</p>
          {hasFilters && <button type="button" className="btn btn-ghost" onClick={() => {
            setSearch(''); setPage(1)
          }}>{t('directoryClear')}</button>}
        </div>
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
                      <h3 className="font-bold">{name}</h3>
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
      </div>
    </div>
  )
}
