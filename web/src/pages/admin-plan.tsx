import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useConfirm, useLock, useUnsaved } from '../components/confirm'
import { LoadError, PageSkeleton, PendingButton } from '../components/feedback'
import { EmptyState } from '../components/shell'
import { api, errorMessage } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { planRequirements, planTerms, sortPlan, type PlanCourse } from '../lib/plan'
import { BatchImportLink } from './admin-batch-import'

const blank = {
  studyYear: 1, term: 'FIRST' as PlanCourse['term'], requirementType: 'MAJOR_REQUIRED' as PlanCourse['requirementType'],
  nameZh: '', nameEn: '', moduleZh: '', moduleEn: '', credits: '', classHours: '', practiceHours: '', noteZh: '', noteEn: '',
}
const pageSize = 16
const numberOrNull = (value: string) => value === '' ? null : Number(value)

export function AdminPlan() {
  const { t, locale } = useI18n()
  const [cohort, setCohort] = useState<number | null>(null)
  const [editor, setEditor] = useState<'new' | PlanCourse | null>(null)
  const [form, setForm] = useState(blank)
  const [dirty, setDirty] = useState(false)
  const [search, setSearch] = useState('')
  const [year, setYear] = useState('')
  const [page, setPage] = useState(1)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const subjectInput = useRef<HTMLInputElement>(null)
  const { busy, run } = useLock()
  const confirm = useConfirm()
  const client = useQueryClient()
  useUnsaved(dirty)
  useEffect(() => { if (editor) subjectInput.current?.focus() }, [editor])

  const cohorts = useQuery({
    queryKey: ['plan-cohorts'],
    queryFn: () => api<{ cohorts: { cohortYear: number; courseCount: number }[] }>('/api/admin/plans'),
  })
  const selected = cohort ?? cohorts.data?.cohorts[0]?.cohortYear
  const endpoint = `/api/admin/plans/${selected}`
  const courseList = useQuery({
    queryKey: ['admin-plan', selected], enabled: selected !== undefined,
    queryFn: () => api<{ items: PlanCourse[] }>(endpoint),
  })
  const titleOf = (item: PlanCourse) => locale === 'en' ? item.nameEn || item.nameZh : item.nameZh
  const yearOf = (value: number) => value === 0 ? t('curriculumProgram') : locale === 'en' ? `Year ${value}` : `${'一二三四'[value - 1]}年級`
  const describeTerm = (item: PlanCourse) => !item.studyYear || item.term === 'YEAR_ONLY' ? yearOf(item.studyYear) : `${yearOf(item.studyYear)} · ${t(planTerms[item.term])}`
  const term = search.trim().toLowerCase()
  const items = sortPlan(courseList.data?.items ?? []).filter((item) =>
    (!year || item.studyYear === Number(year)) && [item.nameZh, item.nameEn, item.moduleZh, item.moduleEn].some((text) => text.toLowerCase().includes(term)),
  )
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(page, pages)
  const visible = items.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  function open(item: typeof editor) {
    setEditor(item)
    setForm(item && item !== 'new' ? {
      studyYear: item.studyYear, term: item.term, requirementType: item.requirementType,
      nameZh: item.nameZh, nameEn: item.nameEn === item.nameZh ? '' : item.nameEn,
      moduleZh: item.moduleZh, moduleEn: item.moduleEn === item.moduleZh ? '' : item.moduleEn,
      credits: String(item.credits ?? ''), classHours: String(item.classHours ?? ''), practiceHours: String(item.practiceHours ?? ''),
      noteZh: item.noteZh, noteEn: item.noteEn === item.noteZh ? '' : item.noteEn,
    } : { ...blank })
    setDirty(false)
    setMessage('')
    setNotice('')
  }

  function update(patch: Partial<typeof form>) {
    setDirty(true)
    setForm((previous) => ({ ...previous, ...patch }))
  }

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['admin-plan', selected] }),
      client.invalidateQueries({ queryKey: ['plan-cohorts'] }),
      client.invalidateQueries({ queryKey: ['plan'] }),
    ])
  }

  async function canDiscard() {
    return !dirty || await confirm({ title: t('ruleDiscard'), body: t('planDiscard'), confirm: t('ruleDiscard') })
  }

  if (cohorts.isLoading) return <PageSkeleton />
  if (cohorts.isError || !cohorts.data) return <LoadError pending={cohorts.isFetching} onRetry={() => void cohorts.refetch()} />
  if (selected === undefined) return <EmptyState>{t('noRules')}</EmptyState>

  return (
    <div className="space-y-4">
      <section className="card panel-heading flex flex-wrap items-end justify-between gap-3">
        <label className="block text-sm font-semibold">{t('cohort')}
          <select className="field block" value={selected} disabled={busy} onChange={(event) => {
            const next = Number(event.target.value)
            void run(async () => {
              if (!await canDiscard()) return
              open(null); setCohort(next); setPage(1); setYear(''); setSearch('')
            })
          }}>
            {cohorts.data.cohorts.map((item) => <option key={item.cohortYear} value={item.cohortYear}>{item.cohortYear}</option>)}
          </select>
        </label>
        {!editor && <div className="flex flex-wrap gap-2">
          <BatchImportLink kind="courses" cohort={selected} />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => open('new')}><Plus size={17} aria-hidden />{t('planAddCourse')}</button>
        </div>}
      </section>
      {notice && <p className="login-result login-result-success" role="status">{notice}</p>}
      {message && !editor && <p className="login-result" role="alert">{message}</p>}
      {editor && <form className="card space-y-4 p-4 sm:p-6" onSubmit={(event) => {
        event.preventDefault()
        void run(async () => {
          setMessage('')
          if (!form.nameZh.trim() || !form.moduleZh.trim()) { setMessage(t('formRequired')); return }
          const data = {
            ...form, credits: numberOrNull(form.credits), classHours: numberOrNull(form.classHours), practiceHours: numberOrNull(form.practiceHours),
          }
          try {
            await api(editor === 'new' ? endpoint : `${endpoint}/${editor.id}`, {
              method: editor === 'new' ? 'POST' : 'PATCH', body: data, silent: true,
            })
            open(null); setNotice(t('planSaved')); await refresh()
          } catch (error) { setMessage(errorMessage(error, locale, t('error'))) }
        })
      }}>
        <h2 className="section-title">{t(editor === 'new' ? 'planAddCourse' : 'planEditCourse')} · {selected}</h2>
        <fieldset className="grid gap-4 sm:grid-cols-2" disabled={busy}>
          <label className="text-sm font-semibold">{t('curriculumSubject')}<input ref={subjectInput} className="field w-full" required maxLength={160} value={form.nameZh} onChange={(event) => update({ nameZh: event.target.value })} /></label>
          <label className="text-sm font-semibold">{t('curriculumCategory')}<input className="field w-full" required maxLength={120} value={form.moduleZh} onChange={(event) => update({ moduleZh: event.target.value })} /></label>
          <label className="text-sm font-semibold">{t('curriculumYear')}
            <select className="field w-full" value={form.studyYear} onChange={(event) => {
              const studyYear = Number(event.target.value)
              update({ studyYear, term: studyYear === 0 ? 'PROGRAM' : form.term === 'PROGRAM' ? 'FIRST' : form.term })
            }}>
              {[1, 2, 3, 4, 0].map((value) => <option key={value} value={value}>{yearOf(value)}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">{t('curriculumTerm')}
            <select className="field w-full" value={form.term} onChange={(event) => update({ term: event.target.value as PlanCourse['term'] })}>
              {Object.entries(planTerms).filter(([value]) => (value === 'PROGRAM') === (form.studyYear === 0)).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">{t('curriculumRequirement')}
            <select className="field w-full" value={form.requirementType} onChange={(event) => update({ requirementType: event.target.value as PlanCourse['requirementType'] })}>
              {Object.entries(planRequirements).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
          </label>
          {([
            ['credits', 'creditUnit', 'any'],
            ['classHours', 'planClassHours', '1'],
            ['practiceHours', 'planPracticeHours', '1'],
          ] as const).map(([key, label, step]) => (
            <label key={key} className="text-sm font-semibold">{t(label)}<input className="field w-full" type="number" min="0" step={step}
              value={form[key]} onChange={(event) => update({ [key]: event.target.value })} /></label>
          ))}
        </fieldset>
        {form.term === 'FULL_YEAR' && <p className="text-sm text-muted">{t('planFullYearHint')}</p>}
        <label className="block text-sm font-semibold">{t('curriculumNotes')}<textarea className="field w-full" rows={2} maxLength={500} value={form.noteZh} disabled={busy} onChange={(event) => update({ noteZh: event.target.value })} /></label>
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-teal">{t('conditionEnglish')}</summary>
          <fieldset disabled={busy} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold">{t('planEnglishSubject')}<input className="field w-full" value={form.nameEn} maxLength={160} onChange={(event) => update({ nameEn: event.target.value })} /></label>
            <label className="text-sm font-semibold">{t('planEnglishCategory')}<input className="field w-full" value={form.moduleEn} maxLength={120} onChange={(event) => update({ moduleEn: event.target.value })} /></label>
            <label className="text-sm font-semibold sm:col-span-2">{t('planEnglishNotes')}<textarea className="field w-full" rows={2} value={form.noteEn} maxLength={500} onChange={(event) => update({ noteEn: event.target.value })} /></label>
          </fieldset>
        </details>
        {message && <p role="alert" className="login-result">{message}</p>}
        <div className="flex flex-wrap gap-2">
          <PendingButton type="submit" className="btn btn-primary" pending={busy}>{t('planSaveCourse')}</PendingButton>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(async () => { if (await canDiscard()) open(null) })}>{t('cancel')}</button>
        </div>
      </form>}
      <section className="card">
        <div className="panel-heading">
          <h2 className="section-title">{t('curriculumCourseList')}</h2>
          <div className="account-filters">
            <label className="text-sm font-semibold">{t('planSearch')}<input className="field w-full" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
            <label className="text-sm font-semibold">{t('curriculumYear')}
              <select className="field w-full" value={year} onChange={(event) => { setYear(event.target.value); setPage(1) }}>
                <option value="">{t('curriculumAll')}</option>
                {[1, 2, 3, 4, 0].map((value) => <option key={value} value={value}>{yearOf(value)}</option>)}
              </select>
            </label>
          </div>
          {courseList.data && !courseList.isError && <p className="mt-2 text-sm text-muted" role="status">{items.length} / {courseList.data.items.length}</p>}
        </div>
        {courseList.isLoading ? <div className="p-4"><PageSkeleton /></div> : courseList.isError || !courseList.data ? (
          <div className="p-4"><LoadError pending={courseList.isFetching} onRetry={() => void courseList.refetch()} /></div>
        ) : !items.length ? <EmptyState>{t('curriculumNoResults')}</EmptyState> : (
          <ul>
            {visible.map((item) => (
              <li key={item.id} className="advisor-item flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold">{titleOf(item)}</p>
                  <p className="text-sm text-muted">{describeTerm(item)} · {locale === 'en' ? item.moduleEn || item.moduleZh : item.moduleZh} · {t(planRequirements[item.requirementType])}{item.credits == null ? '' : ` · ${item.credits} ${t('creditUnit')}`}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-ghost" type="button" disabled={busy || Boolean(editor)} aria-label={`${t('planEditCourse')} · ${titleOf(item)}`} onClick={() => open(item)}><Pencil size={15} aria-hidden />{t('planEditCourse')}</button>
                  <button className="btn btn-ghost" type="button" disabled={busy || Boolean(editor)} aria-label={`${t('planRemoveCourse')} · ${titleOf(item)}`} onClick={() => run(async () => {
                    setMessage(''); setNotice('')
                    if (!await confirm({ title: t('planRemoveCourse'), body: `${selected} · ${titleOf(item)}\n${t('planRemoveConfirm')}`, confirm: t('planRemoveCourse'), danger: true })) return
                    try {
                      await api(`${endpoint}/${item.id}`, { method: 'DELETE', silent: true })
                      setNotice(t('planRemoved')); await refresh()
                    } catch (error) { setMessage(errorMessage(error, locale, t('error'))) }
                  })}><Trash2 size={15} aria-hidden />{t('planRemoveCourse')}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && <footer className="directory-results border-t border-line">
          <p className="text-sm text-muted">{currentPage} / {pages}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{t('directoryPrevious')}</button>
            <button type="button" className="btn btn-ghost" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>{t('directoryNext')}</button>
          </div>
        </footer>}
      </section>
    </div>
  )
}
