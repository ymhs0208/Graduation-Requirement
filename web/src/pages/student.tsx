import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useLock, useUnsaved } from '../components/confirm'
import { PageSkeleton, PendingLabel, TableSkeleton, UploadProgress } from '../components/feedback'
import { api, errorMessage } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { DocumentPreview } from '../components/preview'
import { EmptyState, Ring, StatusPill } from '../components/shell'

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

const thresholdAccent: Record<string, string> = {
  passed: 'border-l-[#0f7a4a]',
  under_review: 'border-l-[#d0891f]',
  missing: 'border-l-[#c24134]',
  unpublished: 'border-l-[#3b82b6]',
  info: 'border-l-[#b7c4be]',
}

export function StudentHome() {
  const { t, locale } = useI18n()
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/me/dashboard') })
  const client = useQueryClient()
  const [step, setStep] = useState(0)
  const [leaving, setLeaving] = useState(false)
  if (query.isLoading) return <PageSkeleton />
  if (query.isError || !query.data) return <p className="text-sm text-[#9e1d22]">{t('error')}</p>
  const { profile, progress } = query.data
  const ratio = progress.requiredTotal ? progress.earnedTowardTotal / progress.requiredTotal : 0
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
      <section className="card grid gap-5 p-5 sm:p-6 md:grid-cols-[auto_1fr] md:items-center">
        <Ring value={ratio} label={progress.requiredTotal ? `${progress.earnedTowardTotal}/${progress.requiredTotal}` : '—'} />
        <div>
          <p className="text-sm text-muted">
            {profile.account} · {locale === 'en' ? profile.classNameEn : profile.classNameZh} · {profile.cohortYear}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{locale === 'en' ? profile.nameEn : profile.nameZh}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusPill state={progress.verdict} />
            {progress.atRisk && <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fdecee] px-2.5 py-1 text-xs font-semibold text-[#9e1d22] ring-1 ring-[#f4c7c8]">{t('atRisk')}</span>}
            {progress.delayed && <span className="inline-flex rounded-full bg-pine px-2.5 py-1 text-xs font-semibold text-white">{t('delayed')}</span>}
          </div>
          {(progress.missing.length > 0 || progress.office.length > 0) && (
            <ul className="mt-4 space-y-1.5 rounded-xl bg-[#f6f7fb] px-3 py-3 text-sm">
              {progress.missing.map((item) => (
                <li key={item.nameZh}>· {locale === 'en' ? item.nameEn : item.nameZh}</li>
              ))}
              {progress.office.map((item) => (
                <li key={item.nameZh} className="text-[#314e78]">
                  · {locale === 'en' ? item.nameEn : item.nameZh}（{t('placeholder')}）
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className="grid gap-3 md:grid-cols-2">
        {progress.categories.map((category) => {
          const width = Math.min(100, category.requiredCredits ? (category.earned / category.requiredCredits) * 100 : 0)
          return (
            <article key={category.code} className="card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{locale === 'en' ? category.nameEn : category.nameZh}</h2>
                {category.isPlaceholder ? <StatusPill state="unpublished" /> : <StatusPill state={category.met ? 'passed' : 'missing'} />}
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight">
                {category.earned}
                <span className="text-base font-medium text-muted"> / {category.requiredCredits ?? '—'}</span>
              </p>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#e4e8f0]">
                <div className={`h-full rounded-full ${category.met ? 'bg-[#0f7a4a]' : 'bg-teal'}`} style={{ width: `${width}%` }} />
              </div>
              <p className="mt-2 text-xs leading-5 text-muted">{locale === 'en' ? category.noteEn : category.noteZh}</p>
            </article>
          )
        })}
      </section>
      <section className="space-y-2">
        {progress.thresholds.map((threshold) => (
          <article key={threshold.id} className={`card flex flex-col gap-3 border-l-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between ${thresholdAccent[threshold.state] ?? 'border-l-[#b7c4be]'}`}>
            <div className="min-w-0">
              <h2 className="font-semibold">{locale === 'en' ? threshold.nameEn : threshold.nameZh}</h2>
              <p className="text-sm text-muted">{locale === 'en' ? threshold.descriptionEn : threshold.descriptionZh}</p>
              {threshold.overdue && <p className="text-sm font-medium text-[#9e1d22]">{t('atRisk')}</p>}
            </div>
            <div className="shrink-0">
              <StatusPill state={threshold.state} />
            </div>
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
  if (query.isLoading) return <PageSkeleton />
  if (!query.data) return <p className="text-sm text-[#9e1d22]">{t('error')}</p>
  const years = [1, 2, 3, 4]
  return (
    <div className="space-y-6">
      <p className="text-sm leading-6 text-muted">{locale === 'en' ? query.data.items[0]?.sourceNoteEn : query.data.items[0]?.sourceNoteZh}</p>
      {years.map((year) => {
        const items = query.data?.items.filter((item) => item.studyYear === year) ?? []
        return (
          <section key={year}>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold tracking-tight">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-pine text-sm text-white">{locale === 'en' ? year : '一二三四'[year - 1]}</span>
              {locale === 'en' ? `Year ${year}` : `${'一二三四'[year - 1]}年級`}
              {query.data?.progress.studyYear === year ? ' · ' : ''}
            </h2>
            {items.length === 0 ? (
              <EmptyState>{t('empty')}</EmptyState>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {items.map((item) => (
                  <article key={item.id} className="card px-4 py-3">
                    <p className="text-xs font-medium text-teal">{locale === 'en' ? item.moduleEn : item.moduleZh}</p>
                    <p className="font-semibold">{locale === 'en' ? item.nameEn : item.nameZh}</p>
                    <p className="text-xs text-muted">{item.requirementType === 'MAJOR_ELECTIVE' ? (locale === 'en' ? 'Elective' : '選修') : locale === 'en' ? 'Required' : '必修'} · {t('placeholder')}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

export function EvidencePage() {
  const { t, locale } = useI18n()
  const { busy, run } = useLock()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/me/dashboard') })
  const [thresholdId, setThresholdId] = useState('')
  const [itemId, setItemId] = useState('')
  const [score, setScore] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState('')
  const [percent, setPercent] = useState<number | null>(null)
  const uploadAbort = useRef<AbortController | null>(null)
  useUnsaved(Boolean(file || score || note || percent !== null))
  if (query.isLoading || !query.data) return query.isLoading ? <PageSkeleton /> : <p className="text-sm text-muted">{t('loading')}</p>
  const fileReady = Boolean(file && file.size <= 8 * 1024 * 1024 && (/^(application\/pdf|image\/png|image\/jpeg)$/.test(file.type) || /\.(pdf|png|jpe?g)$/i.test(file.name)))
  const fileNote = !file ? t('needFile') : file.size > 8 * 1024 * 1024 ? t('uploadTooBig') : fileReady ? t('uploadReady') : t('uploadType')
  const thresholds = query.data.progress.thresholds.filter((item) => item.state !== 'info')
  const selected = thresholds.find((item) => item.id === thresholdId) ?? thresholds[0]
  const items = query.data.recognized.filter((item) => !selected || item.type === selected.code || (selected.code === 'ENGLISH' && item.type === 'ENGLISH'))
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="card space-y-4 p-5 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault()
          if (!file || !selected || !fileReady) return
          void run(async () => {
          const form = new FormData()
          form.set('thresholdId', selected.id)
          if (itemId) form.set('recognizedItemId', itemId)
          if (score) form.set('scoreText', score)
          if (note) form.set('note', note)
          form.set('files', file)
          const controller = new AbortController()
          uploadAbort.current = controller
          setPercent(0)
          try {
            await api('/api/me/submissions', { method: 'POST', form, onProgress: setPercent, signal: controller.signal, success: t('submitted') })
            setMessage('')
            setFile(null)
            await client.invalidateQueries({ queryKey: ['dashboard'] })
          } catch (error) {
            setMessage(errorMessage(error, locale, t('error')))
          } finally {
            uploadAbort.current = null
            setPercent(null)
          }
          })
        }}
      >
        <h1 className="text-xl font-bold tracking-tight">{t('upload')}</h1>
        <label className="block text-sm font-medium">
          {t('evidence')}
          <select className="field w-full" value={selected?.id ?? ''} onChange={(event) => setThresholdId(event.target.value)}>
            {thresholds.map((item) => (
              <option key={item.id} value={item.id}>
                {locale === 'en' ? item.nameEn : item.nameZh}
              </option>
            ))}
          </select>
        </label>
        {items.length > 0 && (
          <label className="block text-sm font-medium">
            {t('recognized')}
            <select className="field w-full" value={itemId} onChange={(event) => setItemId(event.target.value)} required>
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
        <label className="block text-sm font-medium">
          {t('score')}
          <input className="field w-full" value={score} onChange={(event) => setScore(event.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          {t('note')}
          <input className="field w-full" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <label
          className="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            setFile(event.dataTransfer.files[0] ?? null)
          }}
        >
          <span className="block font-medium text-ink">{file ? file.name : t('drop')}</span>
          <input className="sr-only" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <p className={`text-sm ${fileReady ? 'text-[#0d6b45]' : 'text-[#9e1d22]'}`}>{fileNote}</p>
        {percent !== null && <UploadProgress percent={percent} onCancel={() => uploadAbort.current?.abort()} />}
        {message && <p className="text-sm font-medium text-[#9e1d22]">{message}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !fileReady || !selected} title={!fileReady ? fileNote : undefined}>
          <PendingLabel pending={busy}>{t('submit')}</PendingLabel>
        </button>
      </form>
      <div className="space-y-3">
        {query.data.submissions.length === 0 && <EmptyState>{t('empty')}</EmptyState>}
        {query.data.submissions.map((submission) => (
          <article key={submission.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{locale === 'en' ? submission.threshold?.nameEn : submission.threshold?.nameZh}</h2>
              <StatusPill state={submission.status === 'APPROVED' ? 'passed' : submission.status === 'REJECTED' ? 'missing' : 'under_review'} />
            </div>
            <p className="text-sm text-muted">
              {submission.scoreText} · {new Date(submission.createdAt).toLocaleDateString()}
            </p>
            {submission.reviewComment && <p className="mt-2 text-sm">{submission.reviewComment}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {submission.files.map((file) => (
                <button key={file.id} className="btn btn-ghost px-2.5 py-1" type="button" onClick={() => setPreview(file.id)}>
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
  if (query.isLoading || !query.data) return query.isLoading ? <TableSkeleton /> : <p className="text-sm text-muted">{t('loading')}</p>
  return (
    <div className="space-y-3">
      {query.data.notifications.length === 0 && <EmptyState>{t('empty')}</EmptyState>}
      {query.data.notifications.map((item) => (
        <article key={item.id} className={`card p-4 ${item.readAt ? '' : 'border-l-4 border-l-teal'}`}>
          <h2 className="font-semibold">{locale === 'en' ? item.titleEn : item.titleZh}</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{locale === 'en' ? item.bodyEn : item.bodyZh}</p>
        </article>
      ))}
    </div>
  )
}
