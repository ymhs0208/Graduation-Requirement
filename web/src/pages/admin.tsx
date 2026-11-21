import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { DocumentPreview } from '../components/preview'
import { EmptyState, StatusPill } from '../components/shell'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'

const statBar = ['bg-teal', 'bg-pine', 'bg-[#d0891f]', 'bg-[#c24134]']

export function AdminStats() {
  const { t, locale } = useI18n()
  const [cohort, setCohort] = useState<number | ''>('')
  const query = useQuery({
    queryKey: ['stats', cohort],
    queryFn: () => api<{ cohortYear: number; cohorts: number[]; stats: { students: number; englishPassRate: number; certificationRate: number; atRisk: number; delayed: number; ready: number; blocked: number; needsOffice: number } | null; students: { account: string; nameZh: string; nameEn: string; verdict: string; atRisk: boolean; english: string }[] }>(`/api/admin/stats${cohort ? `?cohort=${cohort}` : ''}`),
  })
  const client = useQueryClient()
  if (!query.data) return <p className="text-sm text-muted">{t('loading')}</p>
  const stats = query.data.stats
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium">
          {t('cohort')}
          <select className="field ml-2 mt-0 w-auto" value={query.data.cohortYear} onChange={(event) => setCohort(Number(event.target.value))}>
            {query.data.cohorts.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <a className="btn btn-ghost" href={`/api/admin/export?cohort=${query.data.cohortYear}`}>
          {t('export')}
        </a>
        <button
          className="btn btn-primary"
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
          ].map(([label, value], index) => (
            <article key={label} className="card overflow-hidden">
              <div className={`h-1.5 ${statBar[index]}`} />
              <div className="p-4">
                <p className="text-sm text-muted">{label}</p>
                <p className="mt-1 text-3xl font-bold tracking-tight">{value}</p>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="card overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('account')}</th>
              <th>{locale === 'en' ? 'Name' : '姓名'}</th>
              <th>{t('overview')}</th>
              <th>{t('englishRate')}</th>
            </tr>
          </thead>
          <tbody>
            {query.data.students.map((student) => (
              <tr key={student.account}>
                <td className="font-medium">{student.account}</td>
                <td>{locale === 'en' ? student.nameEn : student.nameZh}</td>
                <td>
                  <StatusPill state={student.verdict} />
                </td>
                <td>
                  <StatusPill state={student.english} />
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
  if (!query.data) return <p className="text-sm text-muted">{t('loading')}</p>
  const submission = query.data.submissions[current]
  if (!submission) return <EmptyState>{t('empty')}</EmptyState>
  const activeFile = fileId || submission.files[0]?.id
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>{activeFile && <DocumentPreview fileId={activeFile} />}</div>
      <form
        className="card space-y-3 p-5"
        onSubmit={async (event) => {
          event.preventDefault()
        }}
      >
        <p className="text-sm text-muted">{submission.student?.account}</p>
        <h1 className="text-xl font-bold tracking-tight">{locale === 'en' ? submission.student?.nameEn : submission.student?.nameZh}</h1>
        <p className="font-medium">{locale === 'en' ? submission.threshold?.nameEn : submission.threshold?.nameZh}</p>
        <p className="text-sm text-muted">
          {locale === 'en' ? submission.recognizedItem?.nameEn : submission.recognizedItem?.nameZh} · {t('score')} {submission.scoreText || '—'} · {new Date(submission.createdAt).toLocaleString()}
        </p>
        {submission.note && <p className="rounded-xl bg-[#f7faf8] px-3 py-2 text-sm">{submission.note}</p>}
        <div className="flex flex-wrap gap-2">
          {submission.files.map((file) => (
            <button key={file.id} className={`btn px-2.5 py-1 ${activeFile === file.id ? 'btn-ink' : 'btn-ghost'}`} type="button" onClick={() => setFileId(file.id)}>
              {file.originalName}
            </button>
          ))}
        </div>
        <textarea className="field w-full" value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t('comment')} />
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-pass"
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
            className="btn btn-miss"
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
        <div className="flex flex-wrap gap-2 text-sm">
          {query.data.submissions.map((item, index) => (
            <button
              key={item.id}
              className={`rounded-full px-3 py-1 font-medium ${index === current ? 'bg-pine text-white' : 'bg-[#eef5f1] text-ink'}`}
              type="button"
              onClick={() => { setCurrent(index); setFileId('') }}
            >
              {item.student?.account}
            </button>
          ))}
        </div>
      </form>
    </div>
  )
}

export function AdminUsers() {
  const { t, locale } = useI18n()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: { id: string; account: string; nameZh: string; role: string; status: string; cohortYear: number | null; classNameZh: string }[]; classes: { id: string; nameZh: string }[] }>('/api/admin/users'),
  })
  const [form, setForm] = useState({ account: '', nameZh: '', nameEn: '', email: '', role: 'STUDENT', cohortYear: 115 })
  const [temp, setTemp] = useState('')
  if (!query.data) return <p className="text-sm text-muted">{t('loading')}</p>
  return (
    <div className="space-y-4">
      <form
        className="card grid gap-2 p-4 md:grid-cols-3"
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
          <input key={key} className="field w-full" placeholder={key} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} required />
        ))}
        <select className="field w-full" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
          <option>STUDENT</option>
          <option>TEACHER</option>
          <option>ADMIN</option>
        </select>
        <input className="field w-full" type="number" value={form.cohortYear} onChange={(event) => setForm({ ...form, cohortYear: Number(event.target.value) })} />
        <button className="btn btn-ink" type="submit">
          {t('save')}
        </button>
      </form>
      {temp && <p className="rounded-xl bg-[#fff4dc] px-3 py-2 text-sm font-medium text-[#7a4e00]">暫時密碼（只顯示一次）：{temp}</p>}
      <div className="card overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('account')}</th>
              <th>{locale === 'en' ? 'Name' : '姓名'}</th>
              <th>{locale === 'en' ? 'Role' : '角色'}</th>
              <th>{locale === 'en' ? 'Status' : '狀態'}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {query.data.users.map((user) => (
              <tr key={user.id}>
                <td className="font-medium">{user.account}</td>
                <td>{user.nameZh}</td>
                <td>{user.role}</td>
                <td>{user.status}</td>
                <td>
                  {user.status === 'ACTIVE' ? (
                    <button className="font-medium text-[#9b1c16] underline-offset-2 hover:underline" type="button" onClick={async () => { await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { status: 'DEACTIVATED', deactivationReason: 'SUSPENDED' } }); await client.invalidateQueries({ queryKey: ['users'] }) }}>
                      {t('deactivate')}
                    </button>
                  ) : (
                    <button className="font-medium text-teal underline-offset-2 hover:underline" type="button" onClick={async () => { await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { status: 'ACTIVE' } }); await client.invalidateQueries({ queryKey: ['users'] }) }}>
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
  if (!query.data) return <p className="text-sm text-muted">{t('loading')}</p>
  return (
    <div className="space-y-6">
      {query.data.rules.map((rule) => (
        <section key={rule.cohortYear} className="card p-5">
          <h2 className="text-lg font-bold tracking-tight">
            {rule.cohortYear} · {rule.totalCredits ?? '—'} {rule.totalCreditsConfirmed ? '' : t('placeholder')}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">{locale === 'en' ? rule.summaryEn : rule.summaryZh}</p>
          <p className="mt-1 text-xs text-muted">{rule.sourceNoteZh}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {rule.categories.map((category) => (
              <label key={category.id} className="text-sm font-medium">
                {locale === 'en' ? category.nameEn : category.nameZh}
                {category.isPlaceholder ? ` (${t('placeholder')})` : ''}
                <input
                  className="field w-full"
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
  if (!query.data) return <p className="text-sm text-muted">{t('loading')}</p>
  return (
    <div className="space-y-4">
      <form
        className="card grid gap-2 p-4 md:grid-cols-4"
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
        <select className="field w-full" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
          <option>ENGLISH</option>
          <option>CERTIFICATION</option>
          <option>COMPETITION</option>
        </select>
        <input className="field w-full" placeholder="nameZh" value={form.nameZh} onChange={(event) => setForm({ ...form, nameZh: event.target.value })} required />
        <input className="field w-full" placeholder="nameEn" value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} required />
        <button className="btn btn-ink" type="submit">{t('save')}</button>
      </form>
      <ul className="space-y-2">
        {query.data.items.length === 0 && <EmptyState>{t('empty')}</EmptyState>}
        {query.data.items.map((item) => (
          <li key={item.id} className="card flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span className={item.active ? '' : 'text-muted'}>
              {item.type} · {locale === 'en' ? item.nameEn : item.nameZh} {item.minScore != null ? `≥ ${item.minScore}` : ''}
            </span>
            <button className="text-sm font-medium text-teal underline-offset-2 hover:underline" type="button" onClick={async () => { await api(`/api/admin/recognized/${item.id}`, { method: 'PATCH', body: { active: !item.active } }); await client.invalidateQueries({ queryKey: ['recognized'] }) }}>
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
  if (!query.data) return <p className="text-sm text-muted">{t('loading')}</p>
  return (
    <ul className="space-y-2">
      {query.data.logs.length === 0 && <EmptyState>{t('empty')}</EmptyState>}
      {query.data.logs.map((log) => (
        <li key={log.id} className="card px-4 py-3 text-sm">
          <span className="text-xs text-muted">{new Date(log.createdAt).toLocaleString()} · {log.actor?.account ?? 'system'} · {log.action}</span>
          <p className="mt-1">{locale === 'en' ? log.summaryEn : log.summaryZh}</p>
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
  if (!query.data) return <p className="text-sm text-muted">{t('loading')}</p>
  return (
    <div className="card space-y-4 p-5">
      <p className="leading-7">停用後保存 {query.data.retentionYears} 年，到期可去識別並刪除上傳檔。目前可清除 {query.data.preview.users.length} 筆。</p>
      <label className="block text-sm font-medium">
        年
        <input className="field ml-2 mt-0 w-24" type="number" value={years} onChange={(event) => setYears(Number(event.target.value))} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-ghost" type="button" onClick={async () => { await api('/api/admin/retention', { method: 'PUT', body: { retentionYears: years } }); await client.invalidateQueries({ queryKey: ['retention'] }) }}>
          {t('save')}
        </button>
        <button
          className="btn btn-miss"
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
    </div>
  )
}
