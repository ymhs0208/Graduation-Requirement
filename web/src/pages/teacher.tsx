import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLock, useUnsaved } from '../components/confirm'
import { PageSkeleton, PendingLabel, TableSkeleton } from '../components/feedback'
import { DocumentPreview } from '../components/preview'
import { EmptyState, StatusPill } from '../components/shell'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'

type Row = {
  id: string
  account: string
  nameZh: string
  nameEn: string
  classNameZh: string
  verdict: string
  atRisk: boolean
  delayed: boolean
  earnedTowardTotal: number
  requiredTotal: number | null
  missing: { nameZh: string; nameEn: string }[]
}

export function TeacherHome() {
  const { t, locale } = useI18n()
  const [atRisk, setAtRisk] = useState(false)
  const query = useQuery({
    queryKey: ['roster', atRisk],
    queryFn: () => api<{ students: Row[] }>(`/api/teacher/students${atRisk ? '?atRisk=1' : ''}`),
  })
  if (query.isLoading || !query.data) return query.isLoading ? <TableSkeleton /> : <p className="text-sm text-muted">{t('error')}</p>
  return (
    <div className="space-y-4">
      <label className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-medium shadow-sm ring-1 ring-line">
        <input className="h-4 w-4 accent-teal" type="checkbox" checked={atRisk} onChange={(event) => setAtRisk(event.target.checked)} />
        {t('atRisk')}
      </label>
      <div className="card overflow-auto">
        <table className="data-table">
          <caption className="sr-only">{t('classes')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('account')}</th>
              <th scope="col">{locale === 'en' ? 'Name' : '姓名'}</th>
              <th scope="col">{t('overview')}</th>
              <th scope="col">{t('earned')}</th>
            </tr>
          </thead>
          <tbody>
            {query.data.students.map((student) => (
              <tr key={student.id}>
                <td>
                  <Link className="font-semibold text-teal underline-offset-2 hover:underline" to={`/teacher/${student.id}`}>
                    {student.account}
                  </Link>
                </td>
                <td>{locale === 'en' ? student.nameEn : student.nameZh}</td>
                <td>
                  <StatusPill state={student.verdict} /> {student.atRisk && <span className="ml-1 inline-flex rounded-full bg-[#fdeceb] px-2 py-1 text-xs font-semibold text-[#9b1c16]">{t('atRisk')}</span>}
                </td>
                <td className="tabular-nums">
                  {student.earnedTowardTotal}
                  {student.requiredTotal != null ? ` / ${student.requiredTotal}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.data.students.length === 0 && <EmptyState>{t('empty')}</EmptyState>}
    </div>
  )
}

export function TeacherStudent() {
  const { id = '' } = useParams()
  const { t, locale } = useI18n()
  const client = useQueryClient()
  const [preview, setPreview] = useState('')
  const [body, setBody] = useState('')
  const { busy, run } = useLock()
  useUnsaved(Boolean(body.trim()))
  const query = useQuery({
    queryKey: ['teacher-student', id],
    queryFn: () =>
      api<{
        student: { account: string; nameZh: string; nameEn: string; status: string }
        progress: { verdict: string; categories: { code: string; nameZh: string; nameEn: string; earned: number; requiredCredits: number | null }[]; thresholds: { nameZh: string; nameEn: string; state: string }[] }
        submissions: { id: string; status: string; scoreText: string | null; createdAt: string; threshold?: { nameZh: string; nameEn: string }; files: { id: string; originalName: string }[] }[]
        comments: { id: string; body: string; createdAt: string }[]
      }>(`/api/teacher/students/${id}`),
  })
  if (query.isLoading || !query.data) return query.isLoading ? <PageSkeleton /> : <p className="text-sm text-muted">{t('error')}</p>
  const student = query.data.student
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="card p-5">
          <p className="text-sm text-muted">{student.account}</p>
          <h1 className="text-2xl font-bold tracking-tight">{locale === 'en' ? student.nameEn : student.nameZh}</h1>
          <div className="mt-3">
            <StatusPill state={query.data.progress.verdict} />
          </div>
          <p className="mt-4 rounded-xl bg-[#fff4dc] px-3 py-2 text-sm leading-6 text-[#7a4e00]">{t('reminderHint')}</p>
        </div>
        {query.data.submissions.map((submission) => (
          <article key={submission.id} className="card p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <h2 className="font-semibold">{locale === 'en' ? submission.threshold?.nameEn : submission.threshold?.nameZh}</h2>
              <StatusPill state={submission.status === 'APPROVED' ? 'passed' : submission.status === 'PENDING' ? 'under_review' : 'missing'} />
            </div>
            <p className="text-sm text-muted">
              {t('score')}: {submission.scoreText || '—'} · {new Date(submission.createdAt).toLocaleDateString()}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {submission.files.map((file) => (
                <button key={file.id} className="btn btn-ghost px-2.5 py-1" type="button" onClick={() => setPreview(file.id)}>
                  {file.originalName}
                </button>
              ))}
            </div>
          </article>
        ))}
        <form
          className="card space-y-3 p-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!body.trim()) return
            void run(async () => {
              await api(`/api/teacher/students/${id}/comments`, { method: 'POST', body: { body }, success: t('saved') })
              setBody('')
              await client.invalidateQueries({ queryKey: ['teacher-student', id] })
            })
          }}
        >
          <label className="block text-sm font-medium">
            {t('reminder')}
            <textarea className="field w-full" value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <button className="btn btn-ink" type="submit" disabled={busy || !body.trim()} title={!body.trim() ? t('reminderHint') : undefined}>
            <PendingLabel pending={busy}>{t('reminder')}</PendingLabel>
          </button>
          {!body.trim() && <p className="text-xs text-muted">{t('reminderHint')}</p>}
        </form>
        {query.data.comments.map((comment) => (
          <p key={comment.id} className="rounded-2xl bg-[#eef5f1] px-4 py-3 text-sm leading-6">
            {comment.body}
          </p>
        ))}
      </div>
      <div>{preview ? <DocumentPreview fileId={preview} /> : <EmptyState>{t('preview')}</EmptyState>}</div>
    </div>
  )
}
