import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { DocumentPreview } from '../components/preview'
import { Ring, StatusPill } from '../components/shell'

type Dashboard = {
  profile: { nameZh: string; nameEn: string; cohortYear: number; classNameZh: string; classNameEn: string; onboardingCompleted: boolean; account: string }
  progress: Progress
  recognized: { id: string; type: string; nameZh: string; nameEn: string; minScore: number | null }[]
  submissions: Submission[]
}

type Progress = {
  verdict: string
  studyYear: number | null
  earnedTowardTotal: number
  requiredTotal: number | null
  totalConfirmed: boolean
  atRisk: boolean
  delayed: boolean
  categories: { code: string; nameZh: string; nameEn: string; earned: number; requiredCredits: number | null; isPlaceholder: boolean; countsTowardTotal: boolean; met: boolean; noteZh: string; noteEn: string }[]
  thresholds: { id: string; code: string; nameZh: string; nameEn: string; descriptionZh: string; descriptionEn: string; state: string; sourceUrl: string | null; deadlineYear: number | null; overdue: boolean }[]
  missing: { nameZh: string; nameEn: string }[]
  office: { nameZh: string; nameEn: string }[]
}

type Submission = {
  id: string
  status: string
  scoreText: string | null
  reviewComment: string | null
  createdAt: string
  threshold?: { nameZh: string; nameEn: string }
  recognizedItem?: { nameZh: string; nameEn: string } | null
  files: { id: string; originalName: string }[]
}

export function StudentHome() {
  const { t, locale } = useI18n()
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/me/dashboard') })
  const client = useQueryClient()
  const [step, setStep] = useState(0)
  if (query.isLoading) return <p>{t('loading')}</p>
  if (query.isError || !query.data) return <p>{t('error')}</p>
  const { profile, progress } = query.data
  const ratio = progress.requiredTotal ? progress.earnedTowardTotal / progress.requiredTotal : 0
  const steps = [t('onboarding1'), t('onboarding2'), t('onboarding3'), t('onboarding4')]
  return (
    <div className="space-y-6">
      {!profile.onboardingCompleted && (
        <div className="rounded-3xl border border-teal/30 bg-white p-5 shadow-sm dark:bg-zinc-900">
          <p className="text-sm text-teal">{step + 1} / 4</p>
          <p className="mt-2 text-lg">{steps[step]}</p>
          <div className="mt-4 flex gap-2">
            {step < 3 ? (
              <button className="rounded-xl bg-ink px-4 py-2 text-white" type="button" onClick={() => setStep(step + 1)}>
                {t('next')}
              </button>
            ) : (
              <button
                className="rounded-xl bg-teal px-4 py-2 text-white"
                type="button"
                onClick={async () => {
                  await api('/api/me/onboarding', { method: 'POST', body: {} })
                  await client.invalidateQueries({ queryKey: ['dashboard'] })
                }}
              >
                {t('done')}
              </button>
            )}
            <button
              className="rounded-xl border px-4 py-2"
              type="button"
              onClick={async () => {
                await api('/api/me/onboarding', { method: 'POST', body: {} })
                await client.invalidateQueries({ queryKey: ['dashboard'] })
              }}
            >
              {t('skip')}
            </button>
          </div>
        </div>
      )}
      <section className="grid gap-4 rounded-3xl bg-white p-5 shadow-sm md:grid-cols-[auto_1fr] dark:bg-zinc-900">
        <Ring value={ratio} label={progress.requiredTotal ? `${progress.earnedTowardTotal}/${progress.requiredTotal}` : '—'} />
        <div>
          <p className="text-sm text-stone-500">
            {profile.account} · {locale === 'en' ? profile.classNameEn : profile.classNameZh} · {profile.cohortYear}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{locale === 'en' ? profile.nameEn : profile.nameZh}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusPill state={progress.verdict} />
            {progress.atRisk && <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-900">{t('atRisk')}</span>}
            {progress.delayed && <span className="rounded-full bg-stone-800 px-2.5 py-1 text-xs text-white">{t('delayed')}</span>}
          </div>
          <ul className="mt-4 space-y-1 text-sm">
            {progress.missing.map((item) => (
              <li key={item.nameZh}>· {locale === 'en' ? item.nameEn : item.nameZh}</li>
            ))}
            {progress.office.map((item) => (
              <li key={item.nameZh} className="text-sky-800 dark:text-sky-200">
                · {locale === 'en' ? item.nameEn : item.nameZh}（{t('placeholder')}）
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="grid gap-3 md:grid-cols-2">
        {progress.categories.map((category) => (
          <article key={category.code} className="rounded-2xl border border-line bg-card p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">{locale === 'en' ? category.nameEn : category.nameZh}</h2>
              {category.isPlaceholder ? <StatusPill state="unpublished" /> : <StatusPill state={category.met ? 'passed' : 'missing'} />}
            </div>
            <p className="mt-2 text-2xl font-semibold">
              {category.earned}
              <span className="text-base font-normal text-stone-500"> / {category.requiredCredits ?? '—'}</span>
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-zinc-700">
              <div
                className="h-full bg-teal"
                style={{ width: `${Math.min(100, category.requiredCredits ? (category.earned / category.requiredCredits) * 100 : 0)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-stone-500">{locale === 'en' ? category.noteEn : category.noteZh}</p>
          </article>
        ))}
      </section>
      <section className="space-y-2">
        {progress.thresholds.map((threshold) => (
          <article key={threshold.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div>
              <h2 className="font-medium">{locale === 'en' ? threshold.nameEn : threshold.nameZh}</h2>
              <p className="text-sm text-stone-500">{locale === 'en' ? threshold.descriptionEn : threshold.descriptionZh}</p>
              {threshold.overdue && <p className="text-sm text-rose-700">{t('atRisk')}</p>}
            </div>
            <StatusPill state={threshold.state} />
          </article>
        ))}
      </section>
    </div>
  )
}

export function PlanPage() {
  const { t, locale } = useI18n()
  const query = useQuery({
    queryKey: ['plan'],
    queryFn: () => api<{ items: { id: string; studyYear: number; nameZh: string; nameEn: string; moduleZh: string; moduleEn: string; requirementType: string; sourceNoteZh: string; sourceNoteEn: string }[]; progress: Progress }>('/api/me/plan'),
  })
  if (query.isLoading) return <p>{t('loading')}</p>
  if (!query.data) return <p>{t('error')}</p>
  const years = [1, 2, 3, 4]
  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-600 dark:text-stone-300">{locale === 'en' ? query.data.items[0]?.sourceNoteEn : query.data.items[0]?.sourceNoteZh}</p>
      {years.map((year) => (
        <section key={year}>
          <h2 className="mb-2 text-lg font-semibold">
            {locale === 'en' ? `Year ${year}` : `${'一二三四'[year - 1]}年級`}
            {query.data?.progress.studyYear === year ? ' · ' : ''}
          </h2>
          <div className="grid gap-2 md:grid-cols-2">
            {query.data?.items
              .filter((item) => item.studyYear === year)
              .map((item) => (
                <article key={item.id} className="rounded-2xl border border-line bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-xs text-stone-500">{locale === 'en' ? item.moduleEn : item.moduleZh}</p>
                  <p className="font-medium">{locale === 'en' ? item.nameEn : item.nameZh}</p>
                  <p className="text-xs">{item.requirementType === 'MAJOR_ELECTIVE' ? (locale === 'en' ? 'Elective' : '選修') : locale === 'en' ? 'Required' : '必修'} · {t('placeholder')}</p>
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function EvidencePage() {
  const { t, locale } = useI18n()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/me/dashboard') })
  const [thresholdId, setThresholdId] = useState('')
  const [itemId, setItemId] = useState('')
  const [score, setScore] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState('')
  if (!query.data) return <p>{t('loading')}</p>
  const thresholds = query.data.progress.thresholds.filter((item) => item.state !== 'info')
  const selected = thresholds.find((item) => item.id === thresholdId) ?? thresholds[0]
  const items = query.data.recognized.filter((item) => !selected || item.type === selected.code || (selected.code === 'ENGLISH' && item.type === 'ENGLISH'))
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="space-y-3 rounded-3xl bg-white p-5 shadow-sm dark:bg-zinc-900"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!file || !selected) return
          const form = new FormData()
          form.set('thresholdId', selected.id)
          if (itemId) form.set('recognizedItemId', itemId)
          if (score) form.set('scoreText', score)
          if (note) form.set('note', note)
          form.set('files', file)
          try {
            await api('/api/me/submissions', { method: 'POST', form })
            setMessage('')
            setFile(null)
            await client.invalidateQueries({ queryKey: ['dashboard'] })
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'error')
          }
        }}
      >
        <h1 className="text-xl font-semibold">{t('upload')}</h1>
        <label className="block text-sm">
          {t('evidence')}
          <select className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-zinc-950" value={selected?.id ?? ''} onChange={(event) => setThresholdId(event.target.value)}>
            {thresholds.map((item) => (
              <option key={item.id} value={item.id}>
                {locale === 'en' ? item.nameEn : item.nameZh}
              </option>
            ))}
          </select>
        </label>
        {items.length > 0 && (
          <label className="block text-sm">
            {t('recognized')}
            <select className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-zinc-950" value={itemId} onChange={(event) => setItemId(event.target.value)} required>
              <option value="">—</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {locale === 'en' ? item.nameEn : item.nameZh}
                  {item.minScore != null ? ` ≥ ${item.minScore}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-sm">
          {t('score')}
          <input className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-zinc-950" value={score} onChange={(event) => setScore(event.target.value)} />
        </label>
        <label className="block text-sm">
          {t('note')}
          <input className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-zinc-950" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <label
          className="block rounded-2xl border border-dashed border-stone-400 px-4 py-8 text-center text-sm"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            setFile(event.dataTransfer.files[0] ?? null)
          }}
        >
          {file ? file.name : t('drop')}
          <input className="mt-2 block w-full" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        {message && <p className="text-sm text-rose-700">{message}</p>}
        <button className="rounded-xl bg-teal px-4 py-2 text-white" type="submit">
          {t('submit')}
        </button>
      </form>
      <div className="space-y-3">
        {query.data.submissions.map((submission) => (
          <article key={submission.id} className="rounded-2xl border border-line bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">{locale === 'en' ? submission.threshold?.nameEn : submission.threshold?.nameZh}</h2>
              <StatusPill state={submission.status === 'APPROVED' ? 'passed' : submission.status === 'REJECTED' ? 'missing' : 'under_review'} />
            </div>
            <p className="text-sm text-stone-500">
              {submission.scoreText} · {new Date(submission.createdAt).toLocaleDateString()}
            </p>
            {submission.reviewComment && <p className="mt-2 text-sm">{submission.reviewComment}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {submission.files.map((file) => (
                <button key={file.id} className="rounded-lg border px-2 py-1 text-sm" type="button" onClick={() => setPreview(file.id)}>
                  {file.originalName}
                </button>
              ))}
            </div>
          </article>
        ))}
        {preview && <DocumentPreview fileId={preview} />}
      </div>
    </div>
  )
}

export function NotificationsPage() {
  const { t, locale } = useI18n()
  const query = useQuery({
    queryKey: ['notes'],
    queryFn: () => api<{ notifications: { id: string; titleZh: string; titleEn: string; bodyZh: string; bodyEn: string; readAt: string | null; createdAt: string }[] }>('/api/inbox'),
  })
  if (!query.data) return <p>{t('loading')}</p>
  return (
    <div className="space-y-3">
      {query.data.notifications.length === 0 && <p>{t('empty')}</p>}
      {query.data.notifications.map((item) => (
        <article key={item.id} className="rounded-2xl bg-white p-4 dark:bg-zinc-900">
          <h2 className="font-medium">{locale === 'en' ? item.titleEn : item.titleZh}</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm">{locale === 'en' ? item.bodyEn : item.bodyZh}</p>
        </article>
      ))}
    </div>
  )
}
