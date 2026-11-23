import { BookOpen, GraduationCap } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '../components/shell'
import { planTerms, sortPlan, type PlanCourse } from '../lib/plan'
import { useI18n } from '../lib/i18n'

const pageSize = 20
const years = ['1', '2', '3', '4']
const creditsIn = (courses: PlanCourse[]) => courses.length && courses.every((item) => item.credits != null)
  ? courses.reduce((total, item) => total + (item.credits ?? 0) * (item.term === 'FULL_YEAR' ? 2 : 1), 0)
  : null

export function CurriculumPlan({ courses, cohort, minimums }: {
  courses: PlanCourse[]
  cohort: number | null
  minimums: Record<'MAJOR_REQUIRED' | 'MAJOR_ELECTIVE' | 'LIBERAL', number | null>
}) {
  const { t, locale } = useI18n()
  const [year, setYear] = useState('')
  const [category, setCategory] = useState('')
  const [requirement, setRequirement] = useState('')
  const [page, setPage] = useState(1)
  const title = (course: PlanCourse) => locale === 'en' ? course.nameEn || course.nameZh : course.nameZh
  const categoryLabel = (course: PlanCourse) => locale === 'en' ? course.moduleEn || course.moduleZh : course.moduleZh
  const categories = new Map(courses.map((course) => [course.moduleZh, categoryLabel(course)]))
  const totals = ([
    ['MAJOR_REQUIRED', 'curriculumRequiredCredits'],
    ['MAJOR_ELECTIVE', 'curriculumElectiveCredits'],
    ['LIBERAL', 'curriculumLiberalCredits'],
  ] as const).flatMap(([key, label]) => {
    const value = creditsIn(courses.filter((course) => course.requirementType === key))
    return value === null ? [] : [{ key, label, value }]
  })
  const filtered = sortPlan(courses).map((course, index) => ({ ...course, number: index + 1 })).filter((course) =>
    (!year || String(course.studyYear || 'PROGRAM') === year) &&
    (!category || course.moduleZh === category) &&
    (!requirement || (course.requirementType === 'MAJOR_REQUIRED') === (requirement === 'required')),
  )
  const count = filtered.length
  const credits = creditsIn(filtered)
  const pages = Math.max(1, Math.ceil(count / pageSize))
  const start = (page - 1) * pageSize
  const visible = filtered.slice(start, start + pageSize)
  const yearLabel = (value: number) => locale === 'en' ? `Year ${value}` : `${'一二三四'[value - 1]}年級`
  const termLabel = (course: PlanCourse) => {
    if (!course.studyYear) return t('curriculumProgram')
    return !course.term || course.term === 'YEAR_ONLY' ? yearLabel(course.studyYear) : `${yearLabel(course.studyYear)} · ${t(planTerms[course.term])}`
  }
  const noteOf = (course: PlanCourse) => locale === 'en' ? course.noteEn || course.noteZh : course.noteZh
  const repeat = (course: PlanCourse) => course.term === 'FULL_YEAR' ? ' (×2)' : ''
  const creditLabel = (course: PlanCourse) => course.credits == null ? '—' : `${course.credits}${repeat(course)}`
  const hoursLabel = (course: PlanCourse) => course.classHours == null && course.practiceHours == null
    ? '—' : `${course.classHours ?? '—'} / ${course.practiceHours ?? '—'}${repeat(course)}`
  const heading = cohort == null ? t('curriculumCourseList') : `${cohort} ${t('curriculumCohortTitle')}`

  return (
    <div className="space-y-4">
      <section className="curriculum-banner">
        <div className="curriculum-banner-heading">
          <GraduationCap size={27} aria-hidden />
          <div>
            <h2 className="profile-title curriculum-title">{heading}</h2>
            <p className="mt-1 text-sm text-slate-200">{t('program')}</p>
          </div>
        </div>
        {totals.length > 0 && <>
        <p className="mt-4 text-sm font-semibold text-slate-100">{t('curriculumCreditsLegend')}</p>
        <dl className="curriculum-metrics">
          {totals.map(({ key, label, value }) => (
            <div key={key}>
              <dt>{t(label)}</dt>
              <dd>{value}{minimums[key] !== null && <span> / {minimums[key]}</span>}</dd>
            </div>
          ))}
        </dl>
        </>}
      </section>

      <section className="card">
        <header className="panel-heading">
          <h2 className="flex items-center gap-2 section-title"><BookOpen size={19} aria-hidden />{t('curriculumCourseList')}</h2>
          <div className="curriculum-filters">
            <div>
              <label htmlFor="curriculum-year">{t('curriculumYear')}</label>
              <select id="curriculum-year" className="field w-full" value={year} onChange={(event) => { setYear(event.target.value); setPage(1) }}>
                <option value="">{t('curriculumAll')}</option>
                {years.map((value) => <option key={value} value={value}>{yearLabel(Number(value))}</option>)}
                <option value="PROGRAM">{t('curriculumProgram')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="curriculum-category">{t('curriculumCategory')}</label>
              <select id="curriculum-category" className="field w-full" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }}>
                <option value="">{t('curriculumAll')}</option>
                {Array.from(categories, ([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="curriculum-requirement">{t('curriculumRequirement')}</label>
              <select id="curriculum-requirement" className="field w-full" value={requirement} onChange={(event) => { setRequirement(event.target.value); setPage(1) }}>
                <option value="">{t('curriculumAll')}</option>
                <option value="required">{t('curriculumRequired')}</option>
                <option value="elective">{t('curriculumElective')}</option>
              </select>
            </div>
          </div>
        </header>
        <div className="directory-results border-t border-line">
          <p className="text-sm text-muted" role="status">{locale === 'en' ? `${count} courses${credits === null ? '' : ` · ${credits} credits`}` : `共 ${count} 筆課程${credits === null ? '' : `，合計 ${credits} 學分`}。`}</p>
          {(year || category || requirement) && <button type="button" className="btn btn-ghost" onClick={() => { setYear(''); setCategory(''); setRequirement(''); setPage(1) }}>{t('directoryClear')}</button>}
        </div>
        {!count ? <EmptyState>{t('curriculumNoResults')}</EmptyState> : <>
          <div className="table-panel curriculum-desktop">
            <table className="data-table curriculum-table">
              <caption className="sr-only">{heading}</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">{t('curriculumTerm')}</th>
                  <th scope="col">{t('curriculumSubject')}</th>
                  <th scope="col">{t('curriculumCategory')}</th>
                  <th scope="col">{t('curriculumRequirement')}</th>
                  <th scope="col">{t('creditUnit')}</th>
                  <th scope="col">{t('curriculumHours')}</th>
                  <th scope="col">{t('curriculumNotes')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((course) => (
                  <tr key={course.number}>
                    <td className="text-muted">{course.number}</td>
                    <td>{termLabel(course)}</td>
                    <td className="font-semibold">{title(course)}</td>
                    <td>{categoryLabel(course)}</td>
                    <td><span className={`curriculum-kind ${course.requirementType === 'MAJOR_REQUIRED' ? 'curriculum-kind-required' : ''}`}>{t(course.requirementType === 'MAJOR_REQUIRED' ? 'curriculumRequired' : 'curriculumElective')}</span></td>
                    <td className="whitespace-nowrap tabular-nums">{creditLabel(course)}</td>
                    <td className="whitespace-nowrap tabular-nums">{hoursLabel(course)}</td>
                    <td>{noteOf(course) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="curriculum-mobile">
            {visible.map((course) => (
              <li key={course.number}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="text-xs font-semibold text-muted">#{course.number} · {termLabel(course)}</p><h3 className="item-title">{title(course)}</h3></div>
                  <span className={`curriculum-kind ${course.requirementType === 'MAJOR_REQUIRED' ? 'curriculum-kind-required' : ''}`}>{t(course.requirementType === 'MAJOR_REQUIRED' ? 'curriculumRequired' : 'curriculumElective')}</span>
                </div>
                <p className="text-sm text-muted">{categoryLabel(course)}{noteOf(course) ? ` · ${noteOf(course)}` : ''}</p>
                <dl><div><dt>{t('creditUnit')}</dt><dd>{creditLabel(course)}</dd></div><div><dt>{t('curriculumHours')}</dt><dd>{hoursLabel(course)}</dd></div></dl>
              </li>
            ))}
          </ul>
        </>}
        {pages > 1 && <footer className="directory-results border-t border-line">
          <p className="text-sm text-muted">{start + 1}–{start + visible.length} / {count}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>{t('directoryPrevious')}</button>
            <button type="button" className="btn btn-ghost" disabled={page === pages} onClick={() => setPage(page + 1)}>{t('directoryNext')}</button>
          </div>
        </footer>}
      </section>
    </div>
  )
}
