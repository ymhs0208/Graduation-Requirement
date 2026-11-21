import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DocumentPreview } from '../components/preview'
import { StatusPill } from '../components/shell'
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
  if (!query.data) return <p>{t('loading')}</p>
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={atRisk} onChange={(event) => setAtRisk(event.target.checked)} />
        {t('atRisk')}
      </label>
      <div className="overflow-auto rounded-2xl border border-line bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-stone-100 dark:bg-zinc-800">
            <tr>
              <th className="px-3 py-2">{t('account')}</th>
              <th className="px-3 py-2">{locale === 'en' ? 'Name' : '姓名'}</th>
              <th className="px-3 py-2">{t('overview')}</th>
              <th className="px-3 py-2">{t('earned')}</th>
            </tr>
          </thead>
          <tbody>
            {query.data.students.map((student) => (
              <tr key={student.id} className="border-t border-line dark:border-zinc-800">
                <td className="px-3 py-2">
                  <Link className="underline" to={`/teacher/${student.id}`}>
                    {student.account}
                  </Link>
                </td>
                <td className="px-3 py-2">{locale === 'en' ? student.nameEn : student.nameZh}</td>
                <td className="px-3 py-2">
                  <StatusPill state={student.verdict} /> {student.atRisk && <span className="ml-1 rounded-full bg-rose-100 px-2 py-1 text-xs text-rose-900">{t('atRisk')}</span>}
                </td>
                <td className="px-3 py-2">
                  {student.earnedTowardTotal}
                  {student.requiredTotal != null ? ` / ${student.requiredTotal}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.data.students.length === 0 && <p>{t('empty')}</p>}
    </div>
  )
}

export function TeacherStudent() {
  const { id = '' } = useParams()
  const { t, locale } = useI18n()
  const client = useQueryClient()
  const [preview, setPreview] = useState('')
  const [body, setBody] = useState('')
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
  if (!query.data) return <p>{t('loading')}</p>
  const student = query.data.student
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">{locale === 'en' ? student.nameEn : student.nameZh}</h1>
          <p className="text-sm text-stone-500">{student.account}</p>
          <div className="mt-2">
            <StatusPill state={query.data.progress.verdict} />
          </div>
          <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">{t('reminderHint')}</p>
        </div>
        {query.data.submissions.map((submission) => (
          <article key={submission.id} className="rounded-2xl border border-line bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex justify-between gap-2">
              <h2 className="font-medium">{locale === 'en' ? submission.threshold?.nameEn : submission.threshold?.nameZh}</h2>
              <StatusPill state={submission.status === 'APPROVED' ? 'passed' : submission.status === 'PENDING' ? 'under_review' : 'missing'} />
            </div>
            <p className="text-sm">
              {t('score')}: {submission.scoreText || '—'} · {new Date(submission.createdAt).toLocaleDateString()}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {submission.files.map((file) => (
                <button key={file.id} className="rounded-lg border px-2 py-1 text-sm" type="button" onClick={() => setPreview(file.id)}>
                  {file.originalName}
                </button>
              ))}
            </div>
          </article>
        ))}
        <form
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault()
            await api(`/api/teacher/students/${id}/comments`, { method: 'POST', body: { body } })
            setBody('')
            await client.invalidateQueries({ queryKey: ['teacher-student', id] })
          }}
        >
          <textarea className="w-full rounded-2xl border px-3 py-2 dark:bg-zinc-950" value={body} onChange={(event) => setBody(event.target.value)} placeholder={t('reminder')} />
          <button className="rounded-xl bg-ink px-4 py-2 text-white" type="submit">
            {t('reminder')}
          </button>
        </form>
        {query.data.comments.map((comment) => (
          <p key={comment.id} className="rounded-2xl bg-stone-100 px-3 py-2 text-sm dark:bg-zinc-800">
            {comment.body}
          </p>
        ))}
      </div>
      <div>{preview ? <DocumentPreview fileId={preview} /> : <p className="text-sm text-stone-500">{t('preview')}</p>}</div>
    </div>
  )
}
