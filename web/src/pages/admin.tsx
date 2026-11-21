import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { DocumentPreview } from '../components/preview'
import { StatusPill } from '../components/shell'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'

export function AdminStats() {
  const { t, locale } = useI18n()
  const [cohort, setCohort] = useState<number | ''>('')
  const query = useQuery({
    queryKey: ['stats', cohort],
    queryFn: () => api<{ cohortYear: number; cohorts: number[]; stats: { students: number; englishPassRate: number; certificationRate: number; atRisk: number; delayed: number; ready: number; blocked: number; needsOffice: number } | null; students: { account: string; nameZh: string; nameEn: string; verdict: string; atRisk: boolean; english: string }[] }>(`/api/admin/stats${cohort ? `?cohort=${cohort}` : ''}`),
  })
  const client = useQueryClient()
  if (!query.data) return <p>{t('loading')}</p>
  const stats = query.data.stats
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          {t('cohort')}
          <select className="ml-2 rounded-xl border px-3 py-2 dark:bg-zinc-950" value={query.data.cohortYear} onChange={(event) => setCohort(Number(event.target.value))}>
            {query.data.cohorts.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <a className="rounded-xl border px-3 py-2 text-sm" href={`/api/admin/export?cohort=${query.data.cohortYear}`}>
          {t('export')}
        </a>
        <button
          className="rounded-xl bg-teal px-3 py-2 text-sm text-white"
          type="button"
          onClick={async () => {
            await api('/api/admin/preaudit', { method: 'POST', body: { cohortYear: query.data?.cohortYear } })
            await client.invalidateQueries({ queryKey: ['notes'] })
          }}
        >
          {t('preaudit')}
        </button>
      </div>
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [t('englishRate'), `${Math.round(stats.englishPassRate * 100)}%`],
            [t('certRate'), `${Math.round(stats.certificationRate * 100)}%`],
            [t('atRisk'), String(stats.atRisk)],
            [t('delayed'), String(stats.delayed)],
          ].map(([label, value]) => (
            <article key={label} className="rounded-2xl bg-white p-4 dark:bg-zinc-900">
              <p className="text-sm text-stone-500">{label}</p>
              <p className="text-3xl font-semibold">{value}</p>
            </article>
          ))}
        </div>
      )}
      <div className="overflow-auto rounded-2xl border border-line bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-left text-sm">
          <tbody>
            {query.data.students.map((student) => (
              <tr key={student.account} className="border-t border-line dark:border-zinc-800">
                <td className="px-3 py-2">{student.account}</td>
                <td className="px-3 py-2">{locale === 'en' ? student.nameEn : student.nameZh}</td>
                <td className="px-3 py-2">
                  <StatusPill state={student.verdict} />
                </td>
                <td className="px-3 py-2">
                  <StatusPill state={student.english} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function AdminReviews() {
  const { t, locale } = useI18n()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['reviews'],
    queryFn: () =>
      api<{
        submissions: {
          id: string
          scoreText: string | null
          note: string | null
          createdAt: string
          status: string
          threshold?: { nameZh: string; nameEn: string }
          recognizedItem?: { nameZh: string; nameEn: string } | null
          student?: { account: string; nameZh: string; nameEn: string }
          files: { id: string; originalName: string }[]
        }[]
      }>('/api/admin/reviews'),
  })
  const [current, setCurrent] = useState(0)
  const [comment, setComment] = useState('')
  const [fileId, setFileId] = useState('')
  if (!query.data) return <p>{t('loading')}</p>
  const submission = query.data.submissions[current]
  if (!submission) return <p>{t('empty')}</p>
  const activeFile = fileId || submission.files[0]?.id
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>{activeFile && <DocumentPreview fileId={activeFile} />}</div>
      <form
        className="space-y-3 rounded-3xl bg-white p-5 dark:bg-zinc-900"
        onSubmit={async (event) => {
          event.preventDefault()
        }}
      >
        <p className="text-sm text-stone-500">{submission.student?.account}</p>
        <h1 className="text-xl font-semibold">{locale === 'en' ? submission.student?.nameEn : submission.student?.nameZh}</h1>
        <p>{locale === 'en' ? submission.threshold?.nameEn : submission.threshold?.nameZh}</p>
        <p className="text-sm">
          {locale === 'en' ? submission.recognizedItem?.nameEn : submission.recognizedItem?.nameZh} · {t('score')} {submission.scoreText || '—'} · {new Date(submission.createdAt).toLocaleString()}
        </p>
        {submission.note && <p className="text-sm">{submission.note}</p>}
        <div className="flex flex-wrap gap-2">
          {submission.files.map((file) => (
            <button key={file.id} className="rounded-lg border px-2 py-1 text-sm" type="button" onClick={() => setFileId(file.id)}>
              {file.originalName}
            </button>
          ))}
        </div>
        <textarea className="w-full rounded-2xl border px-3 py-2 dark:bg-zinc-950" value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t('comment')} />
        <div className="flex gap-2">
          <button
            className="rounded-xl bg-emerald-700 px-4 py-2 text-white"
            type="button"
            onClick={async () => {
              await api(`/api/admin/reviews/${submission.id}`, { method: 'POST', body: { decision: 'APPROVED', comment } })
              setComment('')
              setCurrent(0)
              await client.invalidateQueries({ queryKey: ['reviews'] })
            }}
          >
            {t('approve')}
          </button>
          <button
            className="rounded-xl bg-rose-700 px-4 py-2 text-white"
            type="button"
            onClick={async () => {
              await api(`/api/admin/reviews/${submission.id}`, { method: 'POST', body: { decision: 'REJECTED', comment } })
              setComment('')
              await client.invalidateQueries({ queryKey: ['reviews'] })
            }}
          >
            {t('reject')}
          </button>
        </div>
        <div className="flex gap-2 text-sm">
          {query.data.submissions.map((item, index) => (
            <button key={item.id} className="underline" type="button" onClick={() => { setCurrent(index); setFileId('') }}>
              {item.student?.account}
            </button>
          ))}
        </div>
      </form>
    </div>
  )
}

export function AdminUsers() {
  const { t } = useI18n()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: { id: string; account: string; nameZh: string; role: string; status: string; cohortYear: number | null; classNameZh: string }[]; classes: { id: string; nameZh: string }[] }>('/api/admin/users'),
  })
  const [form, setForm] = useState({ account: '', nameZh: '', nameEn: '', email: '', role: 'STUDENT', cohortYear: 115 })
  const [temp, setTemp] = useState('')
  if (!query.data) return <p>{t('loading')}</p>
  return (
    <div className="space-y-4">
      <form
        className="grid gap-2 rounded-2xl bg-white p-4 md:grid-cols-3 dark:bg-zinc-900"
        onSubmit={async (event) => {
          event.preventDefault()
          const created = await api<{ tempPassword: string }>('/api/admin/users', {
            method: 'POST',
            body: { ...form, cohortYear: form.role === 'STUDENT' ? Number(form.cohortYear) : undefined },
          })
          setTemp(created.tempPassword)
          await client.invalidateQueries({ queryKey: ['users'] })
        }}
      >
        {(['account', 'nameZh', 'nameEn', 'email'] as const).map((key) => (
          <input key={key} className="rounded-xl border px-3 py-2 dark:bg-zinc-950" placeholder={key} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} required />
        ))}
        <select className="rounded-xl border px-3 py-2 dark:bg-zinc-950" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
          <option>STUDENT</option>
          <option>TEACHER</option>
          <option>ADMIN</option>
        </select>
        <input className="rounded-xl border px-3 py-2 dark:bg-zinc-950" type="number" value={form.cohortYear} onChange={(event) => setForm({ ...form, cohortYear: Number(event.target.value) })} />
        <button className="rounded-xl bg-ink px-3 py-2 text-white" type="submit">
          {t('save')}
        </button>
      </form>
      {temp && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm">暫時密碼（只顯示一次）：{temp}</p>}
      <div className="overflow-auto rounded-2xl border bg-white dark:bg-zinc-900">
        <table className="w-full text-left text-sm">
          <tbody>
            {query.data.users.map((user) => (
              <tr key={user.id} className="border-t">
                <td className="px-3 py-2">{user.account}</td>
                <td className="px-3 py-2">{user.nameZh}</td>
                <td className="px-3 py-2">{user.role}</td>
                <td className="px-3 py-2">{user.status}</td>
                <td className="px-3 py-2">
                  {user.status === 'ACTIVE' ? (
                    <button className="underline" type="button" onClick={async () => { await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { status: 'DEACTIVATED', deactivationReason: 'SUSPENDED' } }); await client.invalidateQueries({ queryKey: ['users'] }) }}>
                      {t('deactivate')}
                    </button>
                  ) : (
                    <button className="underline" type="button" onClick={async () => { await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { status: 'ACTIVE' } }); await client.invalidateQueries({ queryKey: ['users'] }) }}>
                      {t('activate')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function AdminRules() {
  const { t, locale } = useI18n()
  const query = useQuery({
    queryKey: ['rules'],
    queryFn: () =>
      api<{
        rules: { cohortYear: number; totalCredits: number | null; totalCreditsConfirmed: boolean; summaryZh: string; summaryEn: string; sourceNoteZh: string; categories: { id: string; nameZh: string; nameEn: string; requiredCredits: number | null; isPlaceholder: boolean; noteZh: string; noteEn: string }[] }[]
      }>('/api/admin/rules'),
  })
  const client = useQueryClient()
  if (!query.data) return <p>{t('loading')}</p>
  return (
    <div className="space-y-6">
      {query.data.rules.map((rule) => (
        <section key={rule.cohortYear} className="rounded-3xl bg-white p-5 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">
            {rule.cohortYear} · {rule.totalCredits ?? '—'} {rule.totalCreditsConfirmed ? '' : t('placeholder')}
          </h2>
          <p className="mt-1 text-sm text-stone-600">{locale === 'en' ? rule.summaryEn : rule.summaryZh}</p>
          <p className="mt-1 text-xs text-stone-500">{rule.sourceNoteZh}</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {rule.categories.map((category) => (
              <label key={category.id} className="text-sm">
                {locale === 'en' ? category.nameEn : category.nameZh}
                {category.isPlaceholder ? ` (${t('placeholder')})` : ''}
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-zinc-950"
                  defaultValue={category.requiredCredits ?? ''}
                  onBlur={async (event) => {
                    const value = event.target.value === '' ? null : Number(event.target.value)
                    await api(`/api/admin/rules/${rule.cohortYear}`, {
                      method: 'PATCH',
                      body: {
                        categories: [{ id: category.id, requiredCredits: value, isPlaceholder: value == null, noteZh: category.noteZh, noteEn: category.noteEn }],
                        totalCreditsConfirmed: value != null && category.isPlaceholder ? rule.totalCreditsConfirmed : rule.totalCreditsConfirmed,
                      },
                    })
                    await client.invalidateQueries({ queryKey: ['rules'] })
                  }}
                />
              </label>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function AdminRecognized() {
  const { t, locale } = useI18n()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['recognized'],
    queryFn: () => api<{ items: { id: string; type: string; nameZh: string; nameEn: string; minScore: number | null; active: boolean; sourceUrl: string | null }[] }>('/api/admin/recognized'),
  })
  const [form, setForm] = useState({ type: 'CERTIFICATION', nameZh: '', nameEn: '', minScore: '' })
  if (!query.data) return <p>{t('loading')}</p>
  return (
    <div className="space-y-4">
      <form
        className="grid gap-2 rounded-2xl bg-white p-4 md:grid-cols-4 dark:bg-zinc-900"
        onSubmit={async (event) => {
          event.preventDefault()
          await api('/api/admin/recognized', {
            method: 'POST',
            body: { type: form.type, nameZh: form.nameZh, nameEn: form.nameEn, minScore: form.minScore ? Number(form.minScore) : null, countsAsPass: true, active: true },
          })
          setForm({ ...form, nameZh: '', nameEn: '', minScore: '' })
          await client.invalidateQueries({ queryKey: ['recognized'] })
        }}
      >
        <select className="rounded-xl border px-3 py-2 dark:bg-zinc-950" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
          <option>ENGLISH</option>
          <option>CERTIFICATION</option>
          <option>COMPETITION</option>
        </select>
        <input className="rounded-xl border px-3 py-2 dark:bg-zinc-950" placeholder="nameZh" value={form.nameZh} onChange={(event) => setForm({ ...form, nameZh: event.target.value })} required />
        <input className="rounded-xl border px-3 py-2 dark:bg-zinc-950" placeholder="nameEn" value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} required />
        <button className="rounded-xl bg-ink px-3 py-2 text-white" type="submit">{t('save')}</button>
      </form>
      <ul className="space-y-2">
        {query.data.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 dark:bg-zinc-900">
            <span>
              {item.type} · {locale === 'en' ? item.nameEn : item.nameZh} {item.minScore != null ? `≥ ${item.minScore}` : ''}
            </span>
            <button className="text-sm underline" type="button" onClick={async () => { await api(`/api/admin/recognized/${item.id}`, { method: 'PATCH', body: { active: !item.active } }); await client.invalidateQueries({ queryKey: ['recognized'] }) }}>
              {item.active ? '停用' : '啟用'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AdminAudit() {
  const { t, locale } = useI18n()
  const query = useQuery({
    queryKey: ['audit'],
    queryFn: () => api<{ logs: { id: string; action: string; summaryZh: string; summaryEn: string; createdAt: string; actor: { account: string } | null }[] }>('/api/admin/audit'),
  })
  if (!query.data) return <p>{t('loading')}</p>
  return (
    <ul className="space-y-2">
      {query.data.logs.map((log) => (
        <li key={log.id} className="rounded-2xl bg-white px-4 py-3 text-sm dark:bg-zinc-900">
          <span className="text-stone-500">{new Date(log.createdAt).toLocaleString()} · {log.actor?.account ?? 'system'} · {log.action}</span>
          <p>{locale === 'en' ? log.summaryEn : log.summaryZh}</p>
        </li>
      ))}
    </ul>
  )
}

export function AdminRetention() {
  const { t } = useI18n()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['retention'],
    queryFn: () => api<{ retentionYears: number; preview: { users: { account: string; nameZh: string }[] } }>('/api/admin/retention'),
  })
  const [years, setYears] = useState(5)
  if (!query.data) return <p>{t('loading')}</p>
  return (
    <div className="space-y-4 rounded-3xl bg-white p-5 dark:bg-zinc-900">
      <p>停用後保存 {query.data.retentionYears} 年，到期可去識別並刪除上傳檔。目前可清除 {query.data.preview.users.length} 筆。</p>
      <label className="block text-sm">
        年
        <input className="ml-2 w-24 rounded-xl border px-3 py-2" type="number" value={years} onChange={(event) => setYears(Number(event.target.value))} />
      </label>
      <button className="rounded-xl border px-3 py-2" type="button" onClick={async () => { await api('/api/admin/retention', { method: 'PUT', body: { retentionYears: years } }); await client.invalidateQueries({ queryKey: ['retention'] }) }}>
        {t('save')}
      </button>
      <button
        className="ml-2 rounded-xl bg-rose-700 px-3 py-2 text-white"
        type="button"
        onClick={async () => {
          if (!confirm('確定依保存年限去識別？')) return
          await api('/api/admin/retention/purge', { method: 'POST', body: { confirm: 'PURGE' } })
          await client.invalidateQueries({ queryKey: ['retention'] })
        }}
      >
        執行去識別
      </button>
    </div>
  )
}
