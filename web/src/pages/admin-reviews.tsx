import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, FileText, Undo2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useConfirm, useLock, useUnsaved } from '../components/confirm'
import { LoadError, PageSkeleton, PendingButton } from '../components/feedback'
import { DocumentPreview } from '../components/preview'
import { EmptyState } from '../components/shell'
import { ApiError, api, errorMessage } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { BatchImportLink } from './admin-batch-import'

type Name = { nameZh: string; nameEn: string }
type Submission = {
  id: string; scoreText: string | null; note: string | null; createdAt: string
  threshold?: Name; recognizedItem?: Name | null; student?: Name & { account: string }
  files: { id: string; originalName: string }[]
}
type Queue = { submissions: Submission[] }
type Decision = 'APPROVED' | 'REJECTED'
const reviewKey = ['reviews']

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
  const [failure, setFailure] = useState<{ id: string; text: string; uncertain: boolean } | null>(null)
  const [success, setSuccess] = useState('')
  const studentHeading = useRef<HTMLHeadingElement>(null)
  const successMessage = useRef<HTMLParagraphElement>(null)
  useUnsaved(Object.values(drafts).some((comment) => comment.trim()))

  if (query.isLoading) return <PageSkeleton />
  if (query.isError || !query.data) return <LoadError pending={query.isFetching} onRetry={() => void query.refetch()} />

  const { submissions } = query.data
  const submission = submissions.find((item) => item.id === selectedId) ?? submissions[0]
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Taipei' })
  const nameOf = (item?: Name | null) => item ? (locale === 'en' ? item.nameEn || item.nameZh : item.nameZh || item.nameEn) : ''

  function choose(id: string) {
    setSelectedId(id)
    setFileId('')
    setSuccess('')
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
      setDecision(nextDecision)
      try {
        const result = await api<{ ok: boolean }>(`/api/admin/reviews/${item.id}`, {
          body: { decision: nextDecision, comment: (drafts[item.id] ?? '').trim() },
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
        const index = submissions.findIndex(({ id }) => id === item.id)
        choose((submissions[index + 1] ?? submissions[index - 1])?.id ?? '')
        setSuccess(t(nextDecision === 'APPROVED' ? 'reviewApproved' : 'reviewReturned'))
        requestAnimationFrame(() => (studentHeading.current ?? successMessage.current)?.focus())
      } catch (error) {
        const uncertain = !(error instanceof ApiError) || ['SERVER', 'OFFLINE', 'TIMEOUT'].includes(error.code)
        setFailure({ id: item.id, text: uncertain ? t('reviewFailed') : errorMessage(error, locale, t('error')), uncertain })
      } finally {
        setDecision(null)
      }
    })
  }

  const activeFile = submission?.files.find((file) => file.id === fileId) ?? submission?.files[0]
  const studentName = nameOf(submission?.student) || submission?.student?.account || t('studentRole')

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><BatchImportLink kind="reviews" /></div>
      {success && <p className="login-result login-result-success" role="status" tabIndex={-1} ref={successMessage}>{success}</p>}
      {!submission ? <section className="card"><EmptyState>{t('reviewEmpty')}</EmptyState></section> : (
        <div className="review-workspace">
          <section className="card review-queue" aria-labelledby="review-queue-title">
            <div className="review-queue-heading">
              <h2 className="section-title" id="review-queue-title">{t('reviewQueue')}</h2>
              <span className="review-queue-count">{submissions.length}</span>
            </div>
            <div className="review-queue-picker">
              <select aria-labelledby="review-queue-title" className="field w-full" value={submission.id} disabled={busy} onChange={(event) => choose(event.target.value)}>
                {submissions.map((item) => <option key={item.id} value={item.id}>
                  {[nameOf(item.student) || item.student?.account, nameOf(item.threshold)].filter(Boolean).join(' · ')}
                </option>)}
              </select>
            </div>
            <ul className="review-queue-list">
              {submissions.map((item) => (
                <li key={item.id}>
                  <button type="button" aria-pressed={submission.id === item.id} disabled={busy} onClick={() => choose(item.id)}>
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

          <div className="review-case">
            <section className="card review-summary" aria-labelledby="review-student-name">
              <div className="review-student">
                <span className="workspace-avatar" aria-hidden="true">{Array.from(studentName)[0]}</span>
                <div className="min-w-0">
                  <h2 id="review-student-name" className="review-student-name" tabIndex={-1} ref={studentHeading}>{studentName}</h2>
                  {submission.student?.account && <p className="text-sm text-muted">{submission.student.account}</p>}
                </div>
              </div>
              <dl className="review-facts">
                {submission.threshold && <div><dt>{t('graduationRequirements')}</dt><dd>{nameOf(submission.threshold)}</dd></div>}
                {submission.recognizedItem && <div><dt>{t('evidenceRecognizedItem')}</dt><dd>{nameOf(submission.recognizedItem)}</dd></div>}
                {submission.scoreText && <div><dt>{t('score')}</dt><dd>{submission.scoreText}</dd></div>}
                <div><dt>{t('reviewSubmittedAt')}</dt><dd><time dateTime={submission.createdAt}>{date.format(new Date(submission.createdAt))}</time></dd></div>
              </dl>
              {submission.note && <div className="review-note"><h3>{t('note')}</h3><p>{submission.note}</p></div>}
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
                  <div>
                    <label htmlFor="review-comment" className="block text-sm font-semibold">{t('comment')}</label>
                    <textarea id="review-comment" className="field w-full" rows={4} maxLength={1000} value={drafts[submission.id] ?? ''}
                      placeholder={t('reviewCommentHint')}
                      onChange={(event) => setDrafts((current) => ({ ...current, [submission.id]: event.target.value }))} />
                  </div>
                  {failure?.id === submission.id && <div className="space-y-2">
                    <p className="login-result" role="alert">{failure.text}</p>
                    {failure.uncertain && <PendingButton className="btn btn-ghost" type="button" pending={query.isFetching}
                      onClick={() => void query.refetch().then((result) => { if (result.isSuccess) setFailure(null) })}>
                      {t('reviewRefresh')}
                    </PendingButton>}
                  </div>}
                  <div className="review-actions">
                    <PendingButton className="btn btn-primary" type="submit" pending={decision === 'APPROVED'}><Check size={17} aria-hidden />{t('approve')}</PendingButton>
                    <PendingButton className="btn btn-miss" type="button" pending={decision === 'REJECTED'} onClick={() => review(submission, 'REJECTED')}><Undo2 size={17} aria-hidden />{t('reject')}</PendingButton>
                  </div>
                </fieldset>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
