import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, ClipboardList, CloudUpload, FileText, FileUp, Paperclip, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLock, useUnsaved } from '../components/confirm'
import { LoadError, PageSkeleton, PendingButton, UploadProgress } from '../components/feedback'
import { DocumentPreview } from '../components/preview'
import { EmptyState, StatusPill } from '../components/shell'
import { ApiError, api, errorMessage } from '../lib/api'
import { conditionDescription } from '../lib/conditions'
import { officialSource } from '../lib/official-source'
import { useI18n } from '../lib/i18n'
import type { Progress } from '../lib/progress'

type Name = { nameZh: string; nameEn: string }
type EvidenceFile = { id: string; originalName: string }
type Dashboard = {
  progress: Progress
  recognized: (Name & { id: string; type: string; minScore: number | null })[]
  submissions: {
    id: string; status: string; scoreText: string | null; reviewComment: string | null; createdAt: string
    threshold?: Name; recognizedItem?: Name | null; files: EvidenceFile[]
  }[]
}

const maxBytes = 8 * 1024 * 1024
const recognizedTypes = ['ENGLISH', 'CERTIFICATION', 'COMPETITION']
const tabs = [['upload', 'upload', FileUp], ['history', 'submissionHistory', ClipboardList]] as const
const steps = ['evidenceChooseStep', 'evidenceAttachStep', 'evidenceReviewStep'] as const

export function EvidencePage() {
  const { t, locale } = useI18n()
  const { busy, run } = useLock()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/me/dashboard') })
  const [tab, setTab] = useState<(typeof tabs)[number][0]>('upload')
  const [step, setStep] = useState(1)
  const [thresholdId, setThresholdId] = useState('')
  const [itemId, setItemId] = useState('')
  const [score, setScore] = useState('')
  const [note, setNote] = useState('')
  const [certificateNumber, setCertificateNumber] = useState('')
  const [issuingBody, setIssuingBody] = useState('')
  const [issuedOn, setIssuedOn] = useState('')
  const [declaration, setDeclaration] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<EvidenceFile | null>(null)
  const [message, setMessage] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [percent, setPercent] = useState<number | null>(null)
  const uploadAbort = useRef<AbortController | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const previewTitle = useRef<HTMLHeadingElement>(null)
  const stepTitle = useRef<HTMLHeadingElement>(null)
  useUnsaved(Boolean(thresholdId || itemId || score || note || certificateNumber || issuingBody || issuedOn || declaration || file || percent !== null))
  useEffect(() => () => uploadAbort.current?.abort(), [])
  useEffect(() => { if (preview && tab === 'history') previewTitle.current?.focus() }, [preview, tab])
  useEffect(() => { if (tab === 'upload') stepTitle.current?.focus() }, [step, tab])

  if (query.isLoading) return <PageSkeleton />
  if (!query.data) return <LoadError pending={query.isFetching} onRetry={() => void query.refetch()} />

  const { progress, recognized, submissions } = query.data
  const thresholds = progress.thresholds.filter((item) =>
    !item.isPlaceholder && item.state !== 'unpublished' && item.kind !== 'INFO' &&
    (!recognizedTypes.includes(item.code) || recognized.some((candidate) => candidate.type === item.code)),
  )
  const selected = thresholds.find((item) => item.id === thresholdId)
  const items = selected && recognizedTypes.includes(selected.code) ? recognized.filter((item) => item.type === selected.code) : []
  const recognizedItem = items.find((item) => item.id === itemId)
  const minimum = recognizedItem?.minScore ?? null
  const scoreValid = minimum === null || (score.trim() !== '' && Number.isFinite(Number(score)) && Number(score) >= minimum)
  const fileError = !file ? '' : file.size === 0 ? t('evidenceEmptyFile') : file.size > maxBytes ? t('uploadTooBig')
    : /^(application\/pdf|image\/png|image\/jpeg)$/.test(file.type) || /\.(pdf|png|jpe?g)$/i.test(file.name) ? '' : t('uploadType')
  const identityRequired = selected?.code === 'ENGLISH' || selected?.code === 'CERTIFICATION'
  const identityReady = !identityRequired || Boolean(certificateNumber.trim() && issuingBody.trim() && issuedOn)
  const sourceUrl = recognizedItem ? officialSource(recognizedItem.nameZh, recognizedItem.nameEn) : null
  const ready = Boolean(selected && (!items.length || recognizedItem) && scoreValid && identityReady && declaration && file && !fileError)
  const visibleStep = !selected ? 1 : step === 3 && !ready ? 2 : step
  const nextStepHint = items.length && !recognizedItem ? 'evidencePickItem'
    : !scoreValid ? 'evidenceScoreNeeded'
    : !identityReady ? 'evidenceDetailsNeeded'
    : !file ? 'needFile'
    : 'evidenceDeclarationNeeded'
  const nameOf = (item?: Name | null) => item ? (locale === 'en' ? item.nameEn || item.nameZh : item.nameZh) : ''

  function selectFile(value: File | null) {
    setFile(value)
    setMessage('')
  }

  return (
    <div className="evidence-page">
      <div className="evidence-tabs" role="group" aria-label={t('evidence')}>
        {tabs.map(([value, label, Icon]) => (
          <button key={value} type="button" aria-pressed={tab === value} disabled={busy} onClick={() => {
            setTab(value)
            setSubmitted(false)
            if (value === 'history') void query.refetch()
          }}>
            <Icon size={18} aria-hidden />{t(label)}
            {value === 'history' && !query.isError && <span className="evidence-tab-count">{submissions.length}</span>}
          </button>
        ))}
      </div>
      {submitted && <p className="login-result login-result-success" role="status">{t('evidenceSent')}</p>}
      {tab === 'upload' && (!thresholds.length ? <section className="card p-4"><EmptyState>{t('conditionNoneForUpload')}</EmptyState></section> : (
        <div className="evidence-workspace evidence-workspace-upload">
          <form className="card evidence-wizard" onSubmit={(event) => {
            event.preventDefault()
            if (visibleStep === 1) {
              if (selected) setStep(2)
              return
            }
            if (visibleStep === 2) {
              if (ready) setStep(3)
              return
            }
            if (!ready || !file || !selected) return
            void run(async () => {
              setMessage('')
              const data = new FormData()
              data.set('thresholdId', selected.id)
              if (recognizedItem) data.set('recognizedItemId', recognizedItem.id)
              if (score.trim()) data.set('scoreText', score.trim())
              if (note.trim()) data.set('note', note.trim())
              if (certificateNumber.trim()) data.set('certificateNumber', certificateNumber.trim())
              if (issuingBody.trim()) data.set('issuingBody', issuingBody.trim())
              if (issuedOn) data.set('issuedOn', issuedOn)
              data.set('declaration', declaration ? 'true' : 'false')
              data.set('files', file)
              const controller = new AbortController()
              uploadAbort.current = controller
              setPercent(0)
              try {
                const result = await api<{ id?: string }>('/api/me/submissions', { method: 'POST', form: data, onProgress: setPercent, signal: controller.signal, silent: true })
                if (typeof result.id !== 'string' || !result.id.trim()) throw new ApiError('SERVER')
                setThresholdId('')
                setItemId('')
                setScore('')
                setNote('')
                setCertificateNumber('')
                setIssuingBody('')
                setIssuedOn('')
                setDeclaration(false)
                setFile(null)
                setStep(1)
                setPreview(null)
                setTab('history')
                setSubmitted(true)
                await client.invalidateQueries({ queryKey: ['dashboard'] })
              } catch (error) {
                const code = error instanceof ApiError ? error.code : ''
                if (code === 'CANCELLED') setMessage(t('evidenceCancelled'))
                else if (['OFFLINE', 'TIMEOUT', 'SERVER'].includes(code)) setMessage(t('evidenceUnconfirmed'))
                else if (code === 'FILE_SIZE') setMessage(t('uploadTooBig'))
                else setMessage(errorMessage(error, locale, t('evidenceFailed')))
              } finally {
                uploadAbort.current = null
                setPercent(null)
              }
            })
          }}>
            <ol className="evidence-steps" aria-label={t('upload')}>
              {steps.map((label, index) => (
                <li key={label} aria-current={visibleStep === index + 1 ? 'step' : undefined} data-complete={visibleStep > index + 1}>
                  <span className="evidence-step-number" aria-hidden>{visibleStep > index + 1 ? <Check size={15} /> : index + 1}</span>
                  <span className="evidence-step-label">{t(label)}</span>
                  {index < steps.length - 1 && <ChevronRight className="evidence-step-divider" size={15} aria-hidden />}
                </li>
              ))}
            </ol>
            <section className="evidence-step">
              <h2 ref={stepTitle} tabIndex={-1} className="evidence-content-title">{t(steps[visibleStep - 1])}</h2>
              {visibleStep === 1 && <fieldset className="mt-4" disabled={busy}>
                <legend className="sr-only">{t('graduationRequirements')}</legend>
                <div className="evidence-choices">
                  {thresholds.map((item) => (
                    <label className="evidence-choice" key={item.id}>
                      <input type="radio" name="threshold" className="sr-only" value={item.id} checked={thresholdId === item.id}
                        onChange={() => { setThresholdId(item.id); setItemId(''); setScore(''); setMessage('') }} />
                      <span className="evidence-choice-mark" aria-hidden="true"><Check size={14} /></span>
                      <span className="evidence-choice-main">
                        <span className="evidence-choice-heading">
                          <span className="item-title">{nameOf(item)}</span>
                          <StatusPill state={item.state} />
                        </span>
                        <span className="block whitespace-pre-wrap break-words text-sm text-muted">{conditionDescription(item, locale, t('recognizedRequirement'))}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>}
              {visibleStep === 2 && selected && <>
                <p className="evidence-selected-inline">{t('evidenceSelectedRequirement')} · <strong>{nameOf(selected)}</strong></p>
                <fieldset className="evidence-fields mt-4" disabled={busy}>
                  <legend className="sr-only">{t('evidenceAttachStep')}</legend>
                  {items.length > 0 && (
                    <div>
                      <label htmlFor="evidence-item" className="block text-sm font-semibold">{t('evidenceRecognizedItem')}</label>
                      <select id="evidence-item" className="field w-full" value={itemId} required onChange={(event) => { setItemId(event.target.value); setScore('') }}>
                        <option value="">{t('evidencePickItem')}</option>
                        {items.map((item) => <option key={item.id} value={item.id}>{nameOf(item)}{item.minScore != null ? ` ≥ ${item.minScore}` : ''}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label htmlFor="evidence-score" className="block text-sm font-semibold">{t(minimum === null ? 'evidenceScoreOptional' : 'score')}</label>
                    <input id="evidence-score" className="field w-full" value={score} onChange={(event) => setScore(event.target.value)} maxLength={40}
                      inputMode={minimum === null ? undefined : 'decimal'} required={minimum !== null}
                      aria-invalid={Boolean(score && !scoreValid)} aria-describedby={minimum === null ? undefined : 'evidence-minimum'} />
                    {minimum !== null && <span id="evidence-minimum" className={`mt-1 block text-xs ${score && !scoreValid ? 'text-[#9e1d22]' : 'text-muted'}`}>{t('recognizedMinimum')} {minimum}</span>}
                  </div>
                  <label className="block text-sm font-semibold">{t('evidenceCertNumber')}{identityRequired ? '' : `（${locale === 'en' ? 'optional' : '選填'}）`}
                    <input className="field w-full" value={certificateNumber} maxLength={80} required={identityRequired} onChange={(event) => setCertificateNumber(event.target.value)} />
                  </label>
                  <label className="block text-sm font-semibold">{t('evidenceIssuer')}{identityRequired ? '' : `（${locale === 'en' ? 'optional' : '選填'}）`}
                    <input className="field w-full" value={issuingBody} maxLength={120} required={identityRequired} onChange={(event) => setIssuingBody(event.target.value)} />
                  </label>
                  <label className="block text-sm font-semibold">{t('evidenceIssuedOn')}{identityRequired ? '' : `（${locale === 'en' ? 'optional' : '選填'}）`}
                    <input className="field w-full" type="date" value={issuedOn} required={identityRequired} onChange={(event) => setIssuedOn(event.target.value)} />
                  </label>
                  {sourceUrl && <p className="evidence-fields-wide text-sm"><a className="font-semibold text-teal underline underline-offset-2" href={sourceUrl} target="_blank" rel="noopener noreferrer">{t('evidenceOfficialLink')}<span className="sr-only">（另開新視窗）</span></a></p>}
                </fieldset>
                <div className="evidence-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                  event.preventDefault()
                  if (!busy) selectFile(event.dataTransfer.files[0] ?? null)
                }}>
                  <span className="evidence-upload-icon"><CloudUpload size={27} aria-hidden /></span>
                  <p className="text-sm text-muted" id="evidence-file-hint">{t('evidenceFileHint')}</p>
                  <button type="button" className="btn btn-ghost" onClick={() => picker.current?.click()} disabled={busy} aria-describedby="evidence-file-hint">{t(file ? 'evidenceReplaceFile' : 'evidencePickFile')}</button>
                  <input ref={picker} hidden type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" aria-label={t('evidencePickFile')} onChange={(event) => {
                    const chosen = event.target.files?.[0]
                    if (chosen) selectFile(chosen)
                    event.target.value = ''
                  }} />
                </div>
                {file && <div className="evidence-file-row">
                  <Paperclip size={18} className="shrink-0 text-teal" aria-hidden />
                  <div className="min-w-0 flex-1"><p className="break-all text-sm font-semibold">{file.name}</p><p className="text-xs text-muted">{(file.size / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} KB</p></div>
                  <button className="btn btn-ghost px-2" type="button" aria-label={t('evidenceRemoveFile')} disabled={busy} onClick={() => selectFile(null)}><X size={17} aria-hidden /></button>
                </div>}
                {fileError && <p className="login-result mt-2" role="alert">{fileError}</p>}
                <label className="mt-4 block text-sm font-semibold">{t('evidenceNoteOptional')}
                  <textarea className="field w-full" rows={2} maxLength={500} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} />
                </label>
                <label className="evidence-declaration">
                  <input type="checkbox" checked={declaration} required disabled={busy} onChange={(event) => setDeclaration(event.target.checked)} />
                  <span>{t('evidenceDeclaration')}</span>
                </label>
              </>}
              {visibleStep === 3 && selected && file && (
                <dl className="evidence-review">
                  <div><dt>{t('graduationRequirements')}</dt><dd>{nameOf(selected)}</dd></div>
                  {recognizedItem && <div><dt>{t('evidenceRecognizedItem')}</dt><dd>{nameOf(recognizedItem)}</dd></div>}
                  {score.trim() && <div><dt>{t('score')}</dt><dd>{score.trim()}</dd></div>}
                  {certificateNumber.trim() && <div><dt>{t('evidenceCertNumber')}</dt><dd>{certificateNumber.trim()}</dd></div>}
                  {issuingBody.trim() && <div><dt>{t('evidenceIssuer')}</dt><dd>{issuingBody.trim()}</dd></div>}
                  {issuedOn && <div><dt>{t('evidenceIssuedOn')}</dt><dd>{issuedOn}</dd></div>}
                  {note.trim() && <div><dt>{t('note')}</dt><dd className="whitespace-pre-wrap">{note.trim()}</dd></div>}
                  <div className="evidence-review-wide"><dt>{t('evidenceAttachStep')}</dt><dd className="flex items-start gap-2"><Paperclip size={16} className="mt-0.5 shrink-0 text-teal" aria-hidden /><span className="min-w-0">{file.name}</span></dd></div>
                  <div className="evidence-review-wide">
                    <dt>{t('evidenceDeclaration')}</dt>
                    <dd className="flex items-center gap-2 text-[#126544]"><Check size={18} aria-hidden />{t('evidenceDeclarationConfirmed')}</dd>
                  </div>
                </dl>
              )}
              {percent !== null && <div className="mt-3"><UploadProgress percent={percent} onCancel={() => uploadAbort.current?.abort()} /></div>}
              {message && <p className="login-result mt-3" role="alert">{message}</p>}
            </section>
            <div className="evidence-submit">
              {visibleStep > 1 && <button type="button" className="btn btn-ghost mr-auto" disabled={busy} onClick={() => { setStep(visibleStep - 1); setMessage('') }}><ArrowLeft size={16} aria-hidden />{t('evidencePrevious')}</button>}
              {visibleStep === 2 && !ready && !busy && !fileError && <p className="text-sm text-muted">{t(nextStepHint)}</p>}
              <PendingButton className="btn btn-primary" type="submit" pending={busy} disabled={visibleStep === 1 ? !selected : !ready}>
                {t(visibleStep === 3 ? 'submitEvidence' : 'next')}
                {visibleStep !== 3 && <ArrowRight size={16} aria-hidden />}
              </PendingButton>
            </div>
          </form>
          <aside className="evidence-context" aria-label={t('graduationRequirements')}>
            {selected && (
              <section className="card evidence-context-card evidence-context-selection">
                <div className="evidence-context-heading">
                  <span className="evidence-context-icon"><ClipboardList size={19} aria-hidden /></span>
                  <h2 className="item-title">{t('evidenceSelectedRequirement')}</h2>
                </div>
                <p className="font-bold">{nameOf(selected)}</p>
                <p className="whitespace-pre-wrap text-sm text-muted">{conditionDescription(selected, locale, t('recognizedRequirement'))}</p>
                <div><StatusPill state={selected.state} /></div>
              </section>
            )}
            <section className="card evidence-context-card">
              <div className="evidence-context-heading">
                <span className="evidence-context-icon"><FileUp size={19} aria-hidden /></span>
                <h2 className="item-title">{t('evidenceFileRules')}</h2>
              </div>
              {visibleStep !== 2 && <p className="text-sm text-muted">{t('evidenceFileHint')}</p>}
              <p className="text-sm text-muted">{t('evidenceFileNaming')}</p>
            </section>
          </aside>
        </div>
      ))}
      {tab === 'history' && (query.isFetching ? <PageSkeleton /> : query.isError ? (
        <LoadError message={t('evidenceHistoryFailed')} onRetry={() => void query.refetch()} />
      ) : (
        <div className="evidence-workspace evidence-workspace-history" data-preview={Boolean(submissions.length)}>
          <section className="card evidence-history">
            <h2 className="section-title panel-heading">{t('submissionHistory')}</h2>
            {!submissions.length && <div className="evidence-history-empty"><EmptyState>{t('evidenceNoHistory')}</EmptyState></div>}
            {submissions.map((submission) => (
              <article key={submission.id} className="evidence-history-item">
                <div className="evidence-history-heading">
                  <h3 className="item-title">{nameOf(submission.threshold) || t('evidence')}</h3>
                  {submission.status === 'REJECTED'
                    ? <span className="account-state bg-[#fdecee] text-[#9e1d22]">{t('evidenceReturned')}</span>
                    : <StatusPill state={submission.status === 'APPROVED' ? 'passed' : 'under_review'} />}
                </div>
                <p className="evidence-history-meta">
                  <time dateTime={submission.createdAt}><CalendarDays size={15} aria-hidden />{new Date(submission.createdAt).toLocaleDateString(locale)}</time>
                  {[nameOf(submission.recognizedItem), submission.scoreText].filter(Boolean).map((value, index) => <span key={index}>{value}</span>)}
                </p>
                {submission.reviewComment && <p className="inset-panel mt-2 whitespace-pre-wrap break-words text-sm"><strong>{t('evidenceReviewComment')}</strong> · {submission.reviewComment}</p>}
                <div className="evidence-history-files">
                  {submission.files.map((item) => <button key={item.id} type="button" aria-pressed={preview?.id === item.id}
                    className="evidence-history-file" onClick={() => setPreview(item)}>
                    <FileText size={17} aria-hidden /><span>{item.originalName}</span><ChevronRight size={15} aria-hidden />
                  </button>)}
                </div>
              </article>
            ))}
          </section>
          {!!submissions.length && <section className="card evidence-history-preview">
            <div className="panel-heading"><h2 ref={previewTitle} tabIndex={-1} className="section-title">{t('preview')}</h2>
              {preview && <p className="mt-1 break-all text-sm text-muted">{preview.originalName}</p>}
            </div>
            <div className="px-4 pb-4">{preview ? <DocumentPreview key={preview.id} fileId={preview.id} filename={preview.originalName} /> : <EmptyState>{t('advisorChooseFile')}</EmptyState>}</div>
          </section>}
        </div>
      ))}
    </div>
  )
}
