import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, FileText, Search, ShieldCheck, Undo2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useConfirm, useLock, useUnsaved } from '../components/confirm'
import { LoadError, PageSkeleton, PendingButton } from '../components/feedback'
import { DocumentPreview } from '../components/preview'
import { EmptyState } from '../components/shell'
import { ApiError, api, errorMessage } from '../lib/api'
import { conditionDescription } from '../lib/conditions'
import { useI18n } from '../lib/i18n'
import { BatchImportLink } from './admin-batch-import'

type Name = { nameZh: string; nameEn: string }
type Authenticity = {
  certificateNumber: string | null; issuingBody: string | null; issuedOn: string | null
  requiresPaperOriginal: boolean; verified: boolean; verificationMethod: string | null; verificationNote: string | null
  duplicateFile: boolean; duplicateCertificate: boolean
  files: { id: string; editedBySoftware: boolean; modifiedAfterCreate: boolean; hasDigitalSignature: boolean; signatureVerified: boolean; producer: string | null; creator: string | null }[]
}
type Submission = {
  id: string; scoreText: string | null; note: string | null; createdAt: string
  threshold?: Name & { id?: string; code?: string; descriptionZh?: string; descriptionEn?: string; requiresPaperOriginal?: boolean }
  recognizedItem?: (Name & { minScore?: number | null }) | null; student?: Name & { account: string }
  teacherComment?: string | null
  authenticity?: Authenticity
  files: { id: string; originalName: string }[]
}
type VerifyDraft = { on: boolean; method: '' | 'OFFICIAL_SITE' | 'PAPER_ORIGINAL' | 'OTHER'; note: string }
type Queue = { submissions: Submission[] }
type Decision = 'APPROVED' | 'REJECTED'
const reviewKey = ['reviews']
const reasons = ['reviewReasonBlurred', 'reviewReasonMissing', 'reviewReasonMismatch'] as const
const thresholdKey = (item: Submission) => item.threshold?.code || item.threshold?.nameZh || ''

export function AdminReviews() {
  const { t, locale } = useI18n()
  const confirm = useConfirm()
  const { busy, run } = useLock()
  const client = useQueryClient()
  const query = useQuery({ queryKey: reviewKey, queryFn: () => api<Queue>('/api/admin/reviews', { silent: true }) })
  const [selectedId, setSelectedId] = useState('')
  const [fileId, setFileId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [decision, setDecision] = useState<Decision | null>(null)
  const [search, setSearch] = useState('')
  const [threshold, setThreshold] = useState({ key: '', title: '' })
  const [verify, setVerify] = useState<Record<string, VerifyDraft>>({})
  const [failure, setFailure] = useState<{ id: string; text: string; uncertain: boolean } | null>(null)
  const [success, setSuccess] = useState('')
  const [notificationWarning, setNotificationWarning] = useState(false)
  const studentHeading = useRef<HTMLHeadingElement>(null)
  const successMessage = useRef<HTMLParagraphElement>(null)
  useUnsaved(Object.entries(drafts).some(([id, comment]) =>
    comment.trim() && (!query.data || query.data.submissions.some((item) => item.id === id)),
  ))

  if (query.isLoading) return <PageSkeleton />
  if (query.isError || !query.data) return <LoadError pending={query.isFetching} onRetry={() => void query.refetch()} />

  const { submissions } = query.data
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Taipei' })
  const nameOf = (item?: Name | null) => item ? (locale === 'en' ? item.nameEn || item.nameZh : item.nameZh || item.nameEn) : ''
  const thresholds = new Map(submissions.flatMap((item) => thresholdKey(item) ? [[thresholdKey(item), nameOf(item.threshold)]] : []))
  if (threshold.key && !thresholds.has(threshold.key)) thresholds.set(threshold.key, threshold.title)
  const term = search.trim().toLowerCase()
  const queue = submissions.filter((item) => (!threshold.key || thresholdKey(item) === threshold.key) &&
    (!term || [item.student?.account, item.student?.nameZh, item.student?.nameEn].some((value) => value?.toLowerCase().includes(term))))
  const submission = queue.find((item) => item.id === selectedId) ?? queue[0]
  const position = queue.findIndex((item) => item.id === submission?.id)

  function choose(id: string) {
    setSelectedId(id)
    setFileId('')
    setSuccess('')
    setNotificationWarning(false)
  }

  function insertReason(item: Submission, reason: string) {
    const comment = drafts[item.id]?.trim() ?? ''
    if (comment.split('\n').includes(reason)) return
    const next = [comment, reason].filter(Boolean).join('\n')
    if (next.length > 1000) {
      setFailure({ id: item.id, text: t('reviewCommentLong'), uncertain: false })
      return
    }
    setDrafts((current) => ({ ...current, [item.id]: next }))
    setFailure(null)
  }

  function review(item: Submission, nextDecision: Decision) {
    void run(async () => {
      if (nextDecision === 'REJECTED' && !await confirm({
        title: t('reject'),
        body: [nameOf(item.student), nameOf(item.threshold), t('confirmReject')].filter(Boolean).join('\n'),
        confirm: t('reject'),
        danger: true,
      })) return
      setFailure(null)
      setSuccess('')
      setNotificationWarning(false)
      setDecision(nextDecision)
      try {
        const check = verify[item.id]
        const result = await api<{ ok: boolean; notificationFailed?: boolean }>(`/api/admin/reviews/${item.id}`, {
          body: {
            decision: nextDecision,
            comment: (drafts[item.id] ?? '').trim(),
            verified: Boolean(check?.on),
            verificationMethod: check?.method || undefined,
            verificationNote: check?.note.trim() || undefined,
          },
          silent: true,
        })
        if (result.ok !== true) throw new ApiError('SERVER')
        await client.cancelQueries({ queryKey: reviewKey })
        client.setQueryData<Queue>(reviewKey, (current) => current && {
          submissions: current.submissions.filter(({ id }) => id !== item.id),
        })
        setDrafts((current) => {
          const updated = { ...current }
          delete updated[item.id]
          return updated
        })
        const index = queue.findIndex(({ id }) => id === item.id)
        choose((queue[index + 1] ?? queue[index - 1])?.id ?? '')
        setSuccess(t(nextDecision === 'APPROVED' ? 'reviewApproved' : 'reviewReturned'))
        setNotificationWarning(Boolean(result.notificationFailed))
        requestAnimationFrame(() => (studentHeading.current ?? successMessage.current)?.focus())
      } catch (error) {
        const uncertain = !(error instanceof ApiError) || ['SERVER', 'OFFLINE', 'TIMEOUT'].includes(error.code)
        setFailure({ id: item.id, text: uncertain ? t('reviewFailed') : errorMessage(error, locale, t('error')), uncertain: uncertain || (error instanceof ApiError && error.code === 'REVIEW_ALREADY_COMPLETED') })
      } finally {
        setDecision(null)
      }
    })
  }

  const activeFile = submission?.files.find((file) => file.id === fileId) ?? submission?.files[0]
  const studentName = nameOf(submission?.student) || submission?.student?.account || t('studentRole')
  const requirement = submission?.threshold
  const criteria = requirement && conditionDescription({
    code: requirement.code ?? '',
    descriptionZh: requirement.descriptionZh ?? '',
    descriptionEn: requirement.descriptionEn || requirement.descriptionZh || '',
  }, locale, '')

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><BatchImportLink kind="reviews" /></div>
      {success && <p className="login-result login-result-success" role="status" tabIndex={-1} ref={successMessage}>{success}</p>}
      {notificationWarning && <p className="login-result" role="alert">{t('reviewNotificationFailed')}</p>}
      {!submissions.length ? <section className="card"><EmptyState>{t('reviewEmpty')}</EmptyState></section> : (
        <div className="review-workspace">
          <section className="card review-queue" aria-labelledby="review-queue-title">
            <div className="review-queue-heading">
              <h2 className="section-title" id="review-queue-title">{t('reviewQueue')}</h2>
              <span className="review-queue-count" role="status">{queue.length} / {submissions.length}</span>
            </div>
            <div className="review-queue-filters">
              <label className="block text-sm font-semibold">{t('reviewSearch')}
                <span className="account-search"><Search size={16} aria-hidden />
                  <input type="search" className="field w-full" value={search} disabled={busy}
                    onChange={(event) => { setSearch(event.target.value); choose('') }} />
                </span>
              </label>
              <label className="block text-sm font-semibold">{t('graduationRequirements')}
                <select className="field w-full" value={threshold.key} disabled={busy} onChange={(event) => {
                  const key = event.target.value
                  setThreshold({ key, title: thresholds.get(key) ?? '' })
                  choose('')
                }}>
                  <option value="">{t('reviewAllRequirements')}</option>
                  {[...thresholds].map(([key, title]) => <option key={key} value={key}>{title}</option>)}
                </select>
              </label>
            </div>
            {submission && <div className="review-queue-picker">
              <select aria-labelledby="review-queue-title" className="field w-full" value={submission.id} disabled={busy} onChange={(event) => choose(event.target.value)}>
                {queue.map((item) => <option key={item.id} value={item.id}>
                  {[nameOf(item.student) || item.student?.account, nameOf(item.threshold)].filter(Boolean).join(' · ')}
                </option>)}
              </select>
            </div>}
            <ul className="review-queue-list">
              {queue.map((item) => (
                <li key={item.id}>
                  <button type="button" aria-pressed={submission?.id === item.id} disabled={busy} onClick={() => choose(item.id)}>
                    <span className="min-w-0">
                      <strong className="block">{nameOf(item.student) || item.student?.account || t('studentRole')}</strong>
                      <span className="review-queue-meta">{[item.student?.account, nameOf(item.threshold)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <ChevronRight size={16} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {!submission ? <section className="card"><EmptyState>{t('reviewNoMatches')}</EmptyState></section> : <div className="review-case">
            <section className="card review-summary" aria-labelledby="review-student-name">
              <div className="review-case-heading">
                <div className="review-student">
                  <span className="workspace-avatar" aria-hidden="true">{Array.from(studentName)[0]}</span>
                  <div className="min-w-0">
                    <h2 id="review-student-name" className="review-student-name" tabIndex={-1} ref={studentHeading}>{studentName}</h2>
                    {submission.student?.account && <p className="text-sm text-muted">{submission.student.account}</p>}
                  </div>
                </div>
                {queue.length > 1 && <div className="review-navigation">
                  <button type="button" className="btn btn-ghost" disabled={busy || position <= 0} onClick={() => choose(queue[position - 1].id)}>
                    <ChevronLeft size={15} aria-hidden />{t('reviewPreviousCase')}
                  </button>
                  <span className="text-sm text-muted tabular-nums">{position + 1} / {queue.length}</span>
                  <button type="button" className="btn btn-ghost" disabled={busy || position >= queue.length - 1} onClick={() => choose(queue[position + 1].id)}>
                    {t('reviewNextCase')}<ChevronRight size={15} aria-hidden />
                  </button>
                </div>}
              </div>
              <dl className="review-facts">
                {submission.threshold && <div><dt>{t('graduationRequirements')}</dt><dd>{nameOf(submission.threshold)}</dd></div>}
                {submission.recognizedItem && <div><dt>{t('evidenceRecognizedItem')}</dt><dd>{nameOf(submission.recognizedItem)}</dd></div>}
                {submission.scoreText && <div><dt>{t('score')}</dt><dd>{submission.scoreText}</dd></div>}
                {submission.recognizedItem?.minScore != null && <div><dt>{t('recognizedMinimum')}</dt><dd>{submission.recognizedItem.minScore}</dd></div>}
                <div><dt>{t('reviewSubmittedAt')}</dt><dd><time dateTime={submission.createdAt}>{date.format(new Date(submission.createdAt))}</time></dd></div>
              </dl>
              {criteria && <details key={submission.id} className="review-note">
                <summary className="cursor-pointer text-sm font-semibold">{t('reviewCriteria')}</summary>
                <p>{criteria}</p>
              </details>}
              {submission.note && <div className="review-note"><h3>{t('note')}</h3><p>{submission.note}</p></div>}
              {submission.teacherComment && <div className="review-note"><h3>{t('reviewTeacherNote')}</h3><p>{submission.teacherComment}</p></div>}
              {submission.authenticity && <div className="review-note" role="status">
                <h3 className="flex items-center gap-2"><ShieldCheck size={16} aria-hidden />{t('verifyAgainstSource')}</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {submission.authenticity.certificateNumber && <li>{t('evidenceCertNumber')}：{submission.authenticity.certificateNumber}</li>}
                  {submission.authenticity.issuingBody && <li>{t('evidenceIssuer')}：{submission.authenticity.issuingBody}</li>}
                  {submission.authenticity.issuedOn && <li>{t('evidenceIssuedOn')}：{submission.authenticity.issuedOn.slice(0, 10)}</li>}
                  {submission.authenticity.duplicateFile && <li className="flex items-start gap-2"><AlertTriangle size={16} aria-hidden />{t('duplicateFileWarning')}</li>}
                  {submission.authenticity.duplicateCertificate && <li className="flex items-start gap-2"><AlertTriangle size={16} aria-hidden />{t('duplicateCertWarning')}</li>}
                  {submission.authenticity.files.some((file) => file.editedBySoftware) && <li className="flex items-start gap-2"><AlertTriangle size={16} aria-hidden />{t('editedSoftwareWarning')}</li>}
                  {submission.authenticity.files.some((file) => file.modifiedAfterCreate) && <li className="flex items-start gap-2"><AlertTriangle size={16} aria-hidden />{t('modifiedLaterWarning')}</li>}
                  <li>{submission.authenticity.files.some((file) => file.hasDigitalSignature) ? t('signaturePresent') : t('signatureAbsent')}</li>
                </ul>
              </div>}
            </section>

            <div className="review-case-columns">
              <section className="card review-evidence" aria-labelledby="review-files-title">
                <div className="review-evidence-heading">
                  <h3 id="review-files-title" className="section-title">{t('reviewFiles')}</h3>
                  {submission.files.length > 1 ? (
                    <div className="review-file-options" role="group" aria-labelledby="review-files-title">
                      {submission.files.map((file) => (
                        <button key={file.id} type="button" aria-pressed={activeFile?.id === file.id} onClick={() => setFileId(file.id)}>
                          <FileText size={15} aria-hidden />{file.originalName}
                        </button>
                      ))}
                    </div>
                  ) : activeFile && <p className="review-filename"><FileText size={15} aria-hidden />{activeFile.originalName}</p>}
                </div>
                {activeFile ? <div className="review-preview"><DocumentPreview key={activeFile.id} fileId={activeFile.id} filename={activeFile.originalName} /></div>
                  : <EmptyState>{t('reviewNoFiles')}</EmptyState>}
              </section>
              <form className="card review-decision" onSubmit={(event) => { event.preventDefault(); review(submission, 'APPROVED') }}>
                <h3 className="section-title">{t('reviewDecision')}</h3>
                <fieldset disabled={busy} className="space-y-3">
                  <label className="flex items-start gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={Boolean(submission.authenticity?.requiresPaperOriginal)} onChange={(event) => {
                      const id = submission.threshold?.id
                      if (!id) return
                      const next = event.target.checked
                      void api(`/api/admin/thresholds/${id}`, { method: 'PATCH', body: { requiresPaperOriginal: next }, silent: true }).then(() => {
                        client.setQueryData<Queue>(reviewKey, (current) => current && {
                          submissions: current.submissions.map((row) => row.threshold?.id === id && row.authenticity
                            ? { ...row, authenticity: { ...row.authenticity, requiresPaperOriginal: next } }
                            : row),
                        })
                      })
                    }} />
                    <span>{t('paperOriginalRequired')}</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={verify[submission.id]?.on ?? submission.authenticity?.verified ?? false} onChange={(event) => setVerify((current) => ({
                      ...current,
                      [submission.id]: { on: event.target.checked, method: current[submission.id]?.method ?? (submission.authenticity?.verificationMethod as VerifyDraft['method']) ?? '', note: current[submission.id]?.note ?? submission.authenticity?.verificationNote ?? '' },
                    }))} />
                    <span>{t('verifyAgainstSource')}</span>
                  </label>
                  <label className="block text-sm font-semibold">{t('verifyMethod')}
                    <select className="field w-full" value={verify[submission.id]?.method ?? ''} onChange={(event) => setVerify((current) => ({
                      ...current,
                      [submission.id]: { on: current[submission.id]?.on ?? false, method: event.target.value as VerifyDraft['method'], note: current[submission.id]?.note ?? '' },
                    }))}>
                      <option value="">{t('reviewChooseReason')}</option>
                      <option value="OFFICIAL_SITE">{t('verifyOfficial')}</option>
                      <option value="PAPER_ORIGINAL">{t('verifyPaper')}</option>
                      <option value="OTHER">{t('verifyOther')}</option>
                    </select>
                  </label>
                  {(verify[submission.id]?.method ?? '') === 'OTHER' && <label className="block text-sm font-semibold">{t('verifyNote')}
                    <input className="field w-full" value={verify[submission.id]?.note ?? ''} maxLength={500} onChange={(event) => setVerify((current) => ({
                      ...current,
                      [submission.id]: { on: current[submission.id]?.on ?? false, method: 'OTHER', note: event.target.value },
                    }))} />
                  </label>}
                  <div>
                    <label htmlFor="review-comment" className="block text-sm font-semibold">{t('comment')}</label>
                    <textarea id="review-comment" className="field w-full" rows={4} maxLength={1000} value={drafts[submission.id] ?? ''}
                      placeholder={t('reviewCommentHint')}
                      onChange={(event) => setDrafts((current) => ({ ...current, [submission.id]: event.target.value }))} />
                  </div>
                  <label className="block text-sm font-semibold">{t('reviewQuickReason')}
                    <select className="field w-full" value="" onChange={(event) => { if (event.target.value) insertReason(submission, event.target.value) }}>
                      <option value="">{t('reviewChooseReason')}</option>
                      {reasons.map((reason) => <option key={reason} value={t(reason)}>{t(reason)}</option>)}
                    </select>
                  </label>
                  {failure?.id === submission.id && <div className="space-y-2">
                    <p className="login-result" role="alert">{failure.text}</p>
                    {failure.uncertain && <PendingButton className="btn btn-ghost" type="button" pending={query.isFetching}
                      onClick={() => void query.refetch().then((result) => { if (result.isSuccess) setFailure(null) })}>
                      {t('reviewRefresh')}
                    </PendingButton>}
                  </div>}
                  {(() => {
                    const draft = verify[submission.id]
                    const paperBlocked = Boolean(submission.authenticity?.requiresPaperOriginal) && !(draft?.on && draft.method && (draft.method !== 'OTHER' || draft.note.trim()))
                    return <div className="space-y-2">
                      {paperBlocked && <p className="text-sm text-muted">{t('verifyNeeded')}</p>}
                      <div className="review-actions">
                        <PendingButton className="btn btn-primary" type="submit" pending={decision === 'APPROVED'} disabled={paperBlocked}><Check size={17} aria-hidden />{t('approve')}</PendingButton>
                        <PendingButton className="btn btn-miss" type="button" pending={decision === 'REJECTED'} onClick={() => review(submission, 'REJECTED')}><Undo2 size={17} aria-hidden />{t('reject')}</PendingButton>
                      </div>
                    </div>
                  })()}
                </fieldset>
              </form>
            </div>
          </div>}
        </div>
      )}
    </div>
  )
}
