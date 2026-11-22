import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, BookOpen, FileText, MessageSquare, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useConfirm, useLock, useUnsaved } from '../components/confirm'
import { PageSkeleton, PendingButton } from '../components/feedback'
import { DocumentPreview } from '../components/preview'
import { EmptyState, Ring, StatusPill } from '../components/shell'
import { api, errorMessage } from '../lib/api'
import { conditionDescription } from '../lib/conditions'
import { useI18n } from '../lib/i18n'
import { showGraduationVerdict, type Progress } from '../lib/progress'

type Names = { nameZh: string; nameEn: string }
type EvidenceFile = { id: string; originalName: string }
type Detail = {
  student: Names & { account: string; cohortYear: number | null }
  progress: Progress
  submissions: { id: string; status: string; scoreText: string | null; createdAt: string; threshold?: Names; files: EvidenceFile[] }[]
  comments: { id: string; body: string; createdAt: string; author?: Names | null }[]
}

const sections = [
  ['progress', 'advisorProgress', BookOpen],
  ['evidence', 'submissionHistory', FileText],
  ['reminders', 'advisorReminders', MessageSquare],
] as const

export function TeacherStudent() {
  const { id = '' } = useParams()
  return <StudentDetail key={id} id={id} />
}

function StudentDetail({ id }: { id: string }) {
  const { t, locale } = useI18n()
  const client = useQueryClient()
  const confirm = useConfirm()
  const { busy, run } = useLock()
  const [tab, setTab] = useState<(typeof sections)[number][0]>('progress')
  const [file, setFile] = useState<EvidenceFile | null>(null)
  const [body, setBody] = useState('')
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const previewTitle = useRef<HTMLHeadingElement>(null)
  const query = useQuery({
    queryKey: ['teacher-student', id],
    queryFn: () => api<Detail>(`/api/teacher/students/${id}`),
  })
  useUnsaved(Boolean(body.trim()))
  useEffect(() => { if (file && tab === 'evidence') previewTitle.current?.focus() }, [file, tab])

  const back = <Link className="btn btn-ghost" to="/teacher"><ArrowLeft size={16} aria-hidden />{t('classes')}</Link>
  if (query.isLoading) return <PageSkeleton />
  if (query.isError || !query.data) return (
    <div className="space-y-4">
      {back}
      <div className="card p-5">
        <p className="text-sm text-muted" role="alert">{t('loadFailed')}</p>
        <button className="btn btn-ghost mt-3" type="button" onClick={() => void query.refetch()}>{t('tryAgain')}</button>
      </div>
    </div>
  )

  const { student, progress, submissions, comments } = query.data
  const nameOf = (item?: Names | null) => item ? (locale === 'en' ? item.nameEn || item.nameZh : item.nameZh) : ''
  const name = nameOf(student) || student.account
  const total = progress.totalConfirmed && progress.requiredTotal != null && progress.requiredTotal > 0 ? progress.requiredTotal : null
  const categories = progress.categories.filter((item) => !item.isPlaceholder && item.requiredCredits != null)
  const conditions = progress.thresholds.filter((item) => !item.isPlaceholder && item.state !== 'unpublished')
  const missing = progress.missing ?? []
  const date = (value: string) => new Date(value).toLocaleDateString(locale)

  return (
    <div className="space-y-4">
      {back}
      <div className="advisor-overview">
        <section className="advisor-profile">
          <div className="student-profile-main">
            <span className="advisor-profile-avatar" aria-hidden="true">{Array.from(name)[0]}</span>
            <div className="min-w-0">
              <h2 className="text-3xl font-bold tracking-tight">{name}</h2>
              <p className="mt-1 text-sm text-slate-200">{[student.account, student.cohortYear ? `${student.cohortYear} ${t('cohort')}` : ''].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          {(showGraduationVerdict(progress.verdict) || progress.delayed) && <div className="mt-4 flex flex-wrap items-center gap-2">
            {showGraduationVerdict(progress.verdict) && <StatusPill state={progress.verdict} />}
            {progress.delayed && <span className="advisor-badge">{t('delayed')}</span>}
          </div>}
        </section>
        <section className="card student-credit-summary">
          <div>
            <h2 className="section-title">{t(total === null ? 'advisorCreditsEarned' : 'creditProgress')}</h2>
            <p className="student-credit-number">{progress.earnedTowardTotal}<span>{total === null ? ' ' : ` / ${total} `}{t('creditUnit')}</span></p>
          </div>
          {total !== null && <Ring value={progress.earnedTowardTotal / total} accessibleLabel={t('creditProgress')} />}
        </section>
      </div>
      <div className="advisor-sections" role="group" aria-label={t('studentDetail')}>
        {sections.map(([value, label, Icon]) => (
          <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>
            <Icon size={17} aria-hidden />{t(label)}
          </button>
        ))}
      </div>
      {tab === 'progress' && (
        <div className="space-y-4">
          {missing.length > 0 && <section className="student-attention">
            <div>
              <h2 className="section-title">{t('needsAttention')}</h2>
              <ul className="student-attention-list">{missing.map((item, index) => <li key={index}>{nameOf(item)}</li>)}</ul>
            </div>
          </section>}
          <div className="workspace-columns">
            <section className="card">
              <h2 className="section-title panel-heading">{t('creditBreakdown')}</h2>
              {!categories.length && <EmptyState>{t('advisorNoCredits')}</EmptyState>}
              {categories.map((item) => (
                <div key={item.code} className="advisor-item">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{nameOf(item)}</h3>
                    <StatusPill state={item.met ? 'passed' : 'missing'} />
                  </div>
                  <p className="mt-1 text-sm text-muted">{t('earned')} <strong className="text-ink">{item.earned}</strong> · {t('required')} <strong className="text-ink">{item.requiredCredits}</strong> {t('creditUnit')}</p>
                  {!!item.minDomains && <p className="text-xs text-muted">{t('ruleMinDomains')} {item.domains} / {item.minDomains}</p>}
                </div>
              ))}
            </section>
            <section className="card">
              <h2 className="section-title panel-heading">{t('graduationRequirements')}</h2>
              {!conditions.length && <EmptyState>{t('advisorNoConditions')}</EmptyState>}
              {conditions.map((item) => (
                <details key={item.id} className="student-condition">
                  <summary>
                    <span className="min-w-0 break-words font-semibold">{nameOf(item)}</span>
                    <span className="student-condition-meta"><StatusPill state={item.state} /></span>
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted">{conditionDescription(item, locale, t('recognizedRequirement'))}</p>
                </details>
              ))}
            </section>
          </div>
        </div>
      )}
      {tab === 'evidence' && (
        <div className="workspace-columns advisor-evidence">
          <section className="card">
            <h2 className="section-title panel-heading">{t('submissionHistory')}</h2>
            {!submissions.length && <EmptyState>{t('advisorNoSubmissions')}</EmptyState>}
            {submissions.map((submission) => (
              <article key={submission.id} className="advisor-item">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold">{nameOf(submission.threshold) || t('evidence')}</h3>
                  <StatusPill state={submission.status === 'APPROVED' ? 'passed' : submission.status === 'PENDING' ? 'under_review' : 'missing'} />
                </div>
                <p className="mt-1 text-sm text-muted">
                  <time dateTime={submission.createdAt}>{date(submission.createdAt)}</time>
                  {submission.scoreText && ` · ${t('score')} ${submission.scoreText}`}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {submission.files.map((entry) => <button key={entry.id} type="button" aria-pressed={file?.id === entry.id}
                    className={`btn max-w-full break-all text-left ${file?.id === entry.id ? 'btn-ink' : 'btn-ghost'}`} onClick={() => setFile(entry)}>
                    <FileText size={15} className="shrink-0" aria-hidden />{entry.originalName}
                  </button>)}
                </div>
              </article>
            ))}
          </section>
          <section className="card">
            <div className="panel-heading">
              <h2 ref={previewTitle} tabIndex={-1} className="section-title">{t('preview')}</h2>
              {file && <p className="mt-1 break-all text-sm text-muted">{file.originalName}</p>}
            </div>
            <div className="px-4 pb-4">{file ? <DocumentPreview fileId={file.id} /> : <EmptyState>{t('advisorChooseFile')}</EmptyState>}</div>
          </section>
        </div>
      )}
      {tab === 'reminders' && (
        <div className="workspace-columns">
          <form className="card space-y-3 p-4 sm:p-5" onSubmit={(event) => {
            event.preventDefault()
            const text = body.trim()
            if (!text || text.length > 1000) return
            void run(async () => {
              setMessage('')
              setSent(false)
              if (!await confirm({ title: t('sendReminder'), body: `${name} · ${student.account}\n\n${text}`, confirm: t('sendReminder') })) return
              try {
                await api(`/api/teacher/students/${id}/comments`, { method: 'POST', body: { body: text }, silent: true })
                setBody('')
                setSent(true)
                await client.invalidateQueries({ queryKey: ['teacher-student', id] })
              } catch (error) {
                setMessage(errorMessage(error, locale, t('error')))
              }
            })
          }}>
            <h2 className="section-title">{t('sendReminder')}</h2>
            <p className="text-sm text-muted">{t('advisorReminderHint')}</p>
            <label className="block text-sm font-semibold">{t('advisorReminderBody')}
              <textarea className="field w-full" rows={5} maxLength={1000} value={body} onChange={(event) => { setBody(event.target.value); setSent(false) }} disabled={busy} required />
            </label>
            {sent && <p className="login-result login-result-success" role="status">{t('advisorReminderSent')}</p>}
            {message && <p className="login-result" role="alert">{message}</p>}
            <PendingButton type="submit" className="btn btn-primary" pending={busy} disabled={!body.trim()}>
              <Send size={16} aria-hidden />{t('sendReminder')}
            </PendingButton>
          </form>
          <section className="card">
            <h2 className="section-title panel-heading">{t('advisorReminderHistory')}</h2>
            {!comments.length && <EmptyState>{t('advisorNoReminders')}</EmptyState>}
            {comments.map((comment) => (
              <article key={comment.id} className="advisor-item">
                <p className="text-xs text-muted"><time dateTime={comment.createdAt}>{date(comment.createdAt)}</time>{comment.author && ` · ${nameOf(comment.author)}`}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{comment.body}</p>
              </article>
            ))}
          </section>
        </div>
      )}
    </div>
  )
}
