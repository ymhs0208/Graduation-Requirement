import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useConfirm, useLock, useUnsaved } from '../components/confirm'
import { PendingButton, UploadProgress } from '../components/feedback'
import { EmptyState } from '../components/shell'
import { ApiError, api, downloadCsv, errorMessage } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { planRequirements, planTerms } from '../lib/plan'

const imports = {
  courses: { title: 'batchCourses', guide: 'batchCoursesHint', from: '/admin/plan', query: ['admin-plan', 'plan-cohorts', 'plan'] },
  classes: { title: 'batchClasses', guide: 'batchClassesHint', from: '/admin/users', query: ['users', 'roster', 'stats'] },
  recognized: { title: 'batchRecognized', guide: 'batchRecognizedHint', from: '/admin/recognized', query: ['recognized', 'dashboard'] },
  reviews: { title: 'batchReviews', guide: 'batchReviewsHint', from: '/admin/reviews', query: ['reviews', 'dashboard', 'roster', 'stats'] },
} as const
type Kind = keyof typeof imports
type Row = {
  line: number; label: string; status: 'new' | 'update' | 'skip' | 'duplicate' | 'error'
  changes?: { field: string; before: string; after: string }[]; messageZh?: string; messageEn?: string
}
type Preview = { batchId: string; rows: Row[]; credits: Record<string, number> }
type Receipt = { batchId: string; added: number; updated: number; skipped: number; errors: number }
type History = { batches: (Receipt & { createdAt: string; actor: { nameZh: string; account: string } | null })[] }
type Rules = { rules: { cohortYear: number; thresholds: { code: string; nameZh: string; nameEn: string; isPlaceholder: boolean; kind: string }[] }[] }

const rowLabels = { new: 'importValid', update: 'batchUpdate', skip: 'batchSkip', duplicate: 'importDuplicate', error: 'importError' } as const
const fieldLabels = {
  studyYear: 'curriculumYear', term: 'batchTerm', nameZh: 'nameZhLabel', nameEn: 'nameEnLabel',
  moduleZh: 'batchModule', moduleEn: 'planEnglishCategory', requirementType: 'batchRequirement',
  credits: 'creditUnit', classHours: 'planClassHours', practiceHours: 'planPracticeHours',
  noteZh: 'note', noteEn: 'planEnglishNotes', advisorAccount: 'directoryTeacherId', className: 'rosterClass',
  minScore: 'recognizedMinimum', decision: 'reviewDecision', reviewedAt: 'batchReviewedAt', scoreText: 'score', comment: 'comment',
} as const
const optionLabels = {
  ...planRequirements, ...planTerms, APPROVED: 'approve', REJECTED: 'reject',
} as const

export function BatchImportLink({ kind, cohort }: { kind: Kind; cohort?: number }) {
  const { t } = useI18n()
  return <Link className="btn btn-ghost" to={`/admin/import/${kind}${cohort ? `?cohort=${cohort}` : ''}`}>
    <FileUp size={17} aria-hidden />{t(imports[kind].title)}
  </Link>
}

export function AdminBatchImport() {
  const { kind } = useParams()
  if (!kind || !Object.hasOwn(imports, kind)) return <Navigate to="/admin" replace />
  return <BatchForm key={kind} kind={kind as Kind} />
}

function BatchForm({ kind }: { kind: Kind }) {
  const { t, locale } = useI18n()
  const [params] = useSearchParams()
  const client = useQueryClient()
  const confirm = useConfirm()
  const { busy, run } = useLock()
  const [cohort, setCohort] = useState(params.get('cohort') ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [update, setUpdate] = useState(false)
  const [message, setMessage] = useState('')
  const [percent, setPercent] = useState<number | null>(null)
  const [uploadController, setUploadController] = useState<AbortController | null>(null)
  const [work, setWork] = useState<'preview' | 'commit' | null>(null)
  const receiptHeading = useRef<HTMLDivElement>(null)
  const settings = imports[kind]
  const endpoint = `/api/admin/batch-imports/${kind}`
  const historyKey = ['batch-history', kind]
  const history = useQuery({
    queryKey: historyKey,
    queryFn: async () => {
      const result = await api<History>(`${endpoint}/history`, { silent: true })
      if (!Array.isArray(result.batches)) throw new ApiError('SERVER')
      return result
    },
    retry: false,
  })
  const cohorts = useQuery({ queryKey: ['plan-cohorts'], queryFn: () => api<{ cohorts: { cohortYear: number }[] }>('/api/admin/plans', { silent: true }), enabled: kind === 'courses', retry: false })
  const rules = useQuery({ queryKey: ['rules'], queryFn: () => api<Rules>('/api/admin/rules', { silent: true }), enabled: kind === 'reviews', retry: false })
  const availableCohorts = cohorts.data?.cohorts ?? []
  const selectedCohort = availableCohorts.find(({ cohortYear }) => String(cohortYear) === cohort)?.cohortYear ?? availableCohorts[0]?.cohortYear
  const badFile = file && (!file.name.toLowerCase().endsWith('.csv') ? t('importCsvType') : file.size > 500_000 ? t('importCsvSize') : '')
  const counts = { new: 0, update: 0, skip: 0, duplicate: 0, error: 0 }
  for (const row of preview?.rows ?? []) counts[row.status]++
  const writable = counts.new + (update ? counts.update : 0)
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Taipei' })
  const creditFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  useUnsaved(Boolean(preview || work))

  function clearPreview() {
    setPreview(null)
    setReceipt(null)
    setMessage('')
    setUpdate(false)
  }

  function titleFor(field: string) {
    return Object.hasOwn(fieldLabels, field) ? t(fieldLabels[field as keyof typeof fieldLabels]) : field
  }

  function valueFor(value: string) {
    return Object.hasOwn(optionLabels, value) ? t(optionLabels[value as keyof typeof optionLabels]) : value || '—'
  }

  async function download(url: string, name: string) {
    try {
      await downloadCsv(url, name)
    } catch (error) {
      setMessage(errorMessage(error, locale, t('exportFailed')))
    }
  }

  function inspect() {
    if (!file || badFile || (kind === 'courses' && !selectedCohort)) return
    void run(async () => {
      clearPreview()
      setWork('preview')
      const form = new FormData()
      form.set('file', file)
      if (selectedCohort && kind === 'courses') form.set('cohort', String(selectedCohort))
      const controller = new AbortController()
      setUploadController(controller)
      setPercent(0)
      try {
        const result = await api<Preview>(`${endpoint}/preview`, { form, signal: controller.signal, onProgress: setPercent, silent: true })
        if (!result.batchId || !Array.isArray(result.rows) || !result.credits) throw new ApiError('SERVER')
        setPreview(result)
      } catch (error) {
        setMessage(errorMessage(error, locale, t('error')))
      } finally {
        setUploadController(null)
        setPercent(null)
        setWork(null)
      }
    })
  }

  function commit() {
    if (!preview || !writable) return
    void run(async () => {
      if (!await confirm({ title: t('importCommit'), body: `${t('batchConfirm')} ${writable}`, confirm: t('importCommit') })) return
      setWork('commit')
      setMessage('')
      try {
        const result = await api<Receipt>(`${endpoint}/commit`, { body: { batchId: preview.batchId, update, confirm: true }, timeout: 60_000, silent: true })
        if (result.batchId !== preview.batchId || ![result.added, result.updated, result.skipped, result.errors].every(Number.isInteger)) throw new ApiError('SERVER')
        setReceipt(result)
        setPreview(null)
        requestAnimationFrame(() => receiptHeading.current?.focus())
        await Promise.all([...settings.query.map((key) => client.invalidateQueries({ queryKey: [key] })),
          client.invalidateQueries({ queryKey: ['audit'] }), client.invalidateQueries({ queryKey: historyKey })])
      } catch (error) {
        const uncertain = error instanceof ApiError && ['OFFLINE', 'TIMEOUT', 'SERVER'].includes(error.code)
        setMessage(uncertain ? t('importUnconfirmed') : errorMessage(error, locale, t('error')))
        if (uncertain) void history.refetch()
      } finally {
        setWork(null)
      }
    })
  }

  function quantities(result: Receipt) {
    return `${t('importValid')} ${result.added} · ${t('batchUpdate')} ${result.updated} · ${t('batchSkip')} ${result.skipped} · ${t('importError')} ${result.errors}`
  }

  return (
    <div className="space-y-4">
      <Link className="btn btn-ghost" to={settings.from}><ArrowLeft size={16} aria-hidden />{t('batchBack')}</Link>
      <section className="card space-y-4 p-4 sm:p-6">
        <div><h2 className="section-title">{t(settings.title)}</h2><p className="mt-1 text-sm text-muted">{t(settings.guide)}</p></div>
        {kind === 'courses' && <label className="block max-w-xs text-sm font-semibold">{t('cohort')}
          <select className="field w-full" value={selectedCohort ?? ''} disabled={busy || cohorts.isError || !availableCohorts.length}
            onChange={(event) => { setCohort(event.target.value); clearPreview() }}>
            {!availableCohorts.length && <option value="">{t(cohorts.isFetching ? 'loading' : 'noRules')}</option>}
            {availableCohorts.map(({ cohortYear }) => <option key={cohortYear} value={cohortYear}>{cohortYear}</option>)}
          </select>
        </label>}
        {kind === 'courses' && cohorts.isError && <div className="space-y-2"><p className="login-result" role="alert">{t('loadFailed')}</p>
          <PendingButton type="button" className="btn btn-ghost" pending={cohorts.isFetching} onClick={() => void cohorts.refetch()}>{t('tryAgain')}</PendingButton>
        </div>}
        {kind === 'reviews' && <details className="inset-panel text-sm">
          <summary className="cursor-pointer font-semibold">{t('batchThresholdCodes')}</summary>
          {rules.isError ? <p role="alert">{t('loadFailed')} <button type="button" className="btn btn-ghost" onClick={() => void rules.refetch()}>{t('tryAgain')}</button></p>
            : rules.isFetching ? <p role="status">{t('loading')}</p> : <ul className="batch-code-list">
              {rules.data?.rules.map((rule) => {
                const available = rule.thresholds.filter((threshold) => threshold.kind !== 'INFO' && !threshold.isPlaceholder)
                return available.length > 0 && <li key={rule.cohortYear}><strong>{rule.cohortYear}</strong>
                  {available.map((threshold) => <span key={threshold.code}><code>{threshold.code}</code> · {locale === 'en' ? threshold.nameEn || threshold.nameZh : threshold.nameZh}</span>)}
                </li>
              })}
            </ul>}
        </details>}
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-0 grow text-sm font-semibold">{t('importPickFile')}
            <input type="file" className="field block w-full" accept=".csv,text/csv" disabled={busy}
              onChange={(event) => { setFile(event.target.files?.[0] ?? null); clearPreview() }} />
          </label>
          <button type="button" className="btn btn-ghost" onClick={() => void download(`${endpoint}/template`, `${kind}-template.csv`)}>
            <Download size={16} aria-hidden />{t('importTemplate')}
          </button>
          <PendingButton type="button" className="btn btn-primary" pending={work === 'preview'}
            disabled={!file || Boolean(badFile) || busy || (kind === 'courses' && (!selectedCohort || cohorts.isError))} onClick={inspect}>
            {t('importCheckFile')}
          </PendingButton>
        </div>
        {badFile && <p className="login-result" role="alert">{badFile}</p>}
        {percent !== null && uploadController && <UploadProgress percent={percent} onCancel={() => uploadController.abort()} />}
        {message && !preview && <p className="login-result" role="alert">{message}</p>}
        {receipt && <div className="login-result login-result-success" role="status" tabIndex={-1} ref={receiptHeading}>
          <strong>{t('importDone')}</strong><p>{quantities(receipt)}</p><p className="break-all">{t('batchId')} {receipt.batchId}</p>
        </div>}
      </section>

      {preview && <section className="card space-y-3 p-4 sm:p-6" aria-label={t('importPreview')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">{t('importPreview')}</h2><span className="break-all text-xs text-muted">{t('batchId')} {preview.batchId}</span>
        </div>
        <p className="text-sm text-muted">{t('importPreviewNote')}</p>
        <dl className="batch-counts">{(Object.keys(counts) as Row['status'][]).map((status) =>
          <div key={status}><dt>{t(rowLabels[status])}</dt><dd>{counts[status]}</dd></div>)}</dl>
        {kind === 'courses' && <p className="text-sm">
          <strong>{t('batchCourseCredits')} {creditFormat.format(Object.values(preview.credits).reduce((sum, count) => sum + count, 0))}</strong>
          {Object.entries(planRequirements).map(([code, label]) => <span key={code} className="ml-3 text-muted">{t(label)} {creditFormat.format(preview.credits[code] ?? 0)}</span>)}
        </p>}
        <div className="table-panel" tabIndex={0} role="region" aria-label={t('importPreview')}>
          <table className="data-table batch-table">
            <thead><tr><th scope="col">{t('line')}</th><th scope="col">{t('batchRecord')}</th><th scope="col">{t('recognizedStatus')}</th><th scope="col">{t('batchChanges')}</th></tr></thead>
            <tbody>{preview.rows.map((row) => <tr key={row.line}>
              <td>{row.line}</td><td>{row.label || '—'}</td><td>{t(rowLabels[row.status])}</td>
              <td>{row.messageZh ? (locale === 'en' ? row.messageEn : row.messageZh) : row.changes?.length ? <ul>
                {row.changes.map(({ field, before, after }) => <li key={field}><strong>{titleFor(field)}</strong> {row.status === 'update' ? `${valueFor(before)} → ` : ''}{valueFor(after)}</li>)}
              </ul> : '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {counts.update > 0 && <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={update} disabled={busy} onChange={(event) => setUpdate(event.target.checked)} />{t('importUpdate')}
        </label>}
        {!writable && <p className="text-sm text-muted">{t('importNoValid')}</p>}
        {message && <p className="login-result" role="alert">{message}</p>}
        <div className="flex flex-wrap gap-2">
          <PendingButton type="button" className="btn btn-primary" pending={work === 'commit'} disabled={!writable || busy} onClick={commit}>{t('importCommit')}</PendingButton>
          {(counts.error > 0 || counts.duplicate > 0) && <button type="button" className="btn btn-ghost"
            onClick={() => void download(`${endpoint}/${preview.batchId}/errors`, `${kind}-errors.csv`)}>{t('importErrors')}</button>}
        </div>
      </section>}

      <section className="card space-y-2 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">{t('batchHistory')}</h2>
          <PendingButton type="button" className="btn btn-ghost" pending={history.isFetching} onClick={() => void history.refetch()}>{t('batchRefresh')}</PendingButton>
        </div>
        {history.isError ? <p className="login-result" role="alert">{t('loadFailed')}</p>
          : history.data?.batches.length ? <ul className="divide-y divide-line">
            {history.data.batches.map((batch) => <li key={batch.batchId} className="py-2 text-sm">
              <p><time dateTime={batch.createdAt}>{date.format(new Date(batch.createdAt))}</time>{batch.actor && ` · ${batch.actor.nameZh} (${batch.actor.account})`}</p>
              <p className="break-all text-xs text-muted">{batch.batchId} · {quantities(batch)}</p>
            </li>)}
          </ul> : history.isFetching ? <p role="status">{t('loading')}</p> : <EmptyState>{t('empty')}</EmptyState>}
      </section>
    </div>
  )
}
