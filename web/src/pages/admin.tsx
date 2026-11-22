import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useConfirm, useLock, useUnsaved } from '../components/confirm'
import { DocumentPreview } from '../components/preview'
import { EmptyState, StatusPill } from '../components/shell'
import { api, errorMessage } from '../lib/api'
import { PageSkeleton, PendingLabel, StepStatus } from '../components/feedback'
import { useI18n } from '../lib/i18n'
import { ImportPanel } from './import-panel'

const statBar = ['bg-teal', 'bg-[#5c6b7a]', 'bg-[#c48a12]', 'bg-[#c24134]']

export function AdminStats() {
  const { t, locale } = useI18n()
  const [cohort, setCohort] = useState<number | ''>('')
  const query = useQuery({
    queryKey: ['stats', cohort],
    queryFn: () => api<{ cohortYear: number; cohorts: number[]; stats: { students: number; englishPassRate: number; certificationRate: number; atRisk: number; delayed: number; ready: number; blocked: number; needsOffice: number } | null; students: { account: string; nameZh: string; nameEn: string; verdict: string; atRisk: boolean; english: string }[] }>(`/api/admin/stats${cohort ? `?cohort=${cohort}` : ''}`),
  })
  const client = useQueryClient()
  const { busy, run } = useLock()
  const [job, setJob] = useState<'export' | 'preaudit' | ''>('')
  const [step, setStep] = useState(-1)
  if (query.isLoading || !query.data) return query.isLoading ? <PageSkeleton /> : <p className="text-sm text-muted">{t('error')}</p>
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
        <button
          className="btn btn-ghost"
          type="button"
          disabled={busy}
          onClick={() => run(async () => {
            setJob('export')
            setStep(0)
            try {
              const response = await fetch(`/api/admin/export?cohort=${query.data?.cohortYear}`, { credentials: 'include' })
              if (!response.ok) throw new Error('export')
              setStep(1)
              const blob = await response.blob()
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = `graduation-${query.data?.cohortYear}.csv`
              link.click()
              URL.revokeObjectURL(url)
              setStep(2)
              const { toast } = await import('sonner')
              toast.success(t('exportDone'))
            } finally {
              window.setTimeout(() => { setJob(''); setStep(-1) }, 900)
            }
          })}
        >
          <PendingLabel pending={busy && job === 'export'}>{t('export')}</PendingLabel>
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy}
          onClick={() => run(async () => {
            setJob('preaudit')
            setStep(0)
            try {
              await api('/api/admin/preaudit', { method: 'POST', body: { cohortYear: query.data?.cohortYear }, success: t('preauditDone'), timeout: 60000 })
              setStep(1)
              await client.invalidateQueries({ queryKey: ['notes'] })
              setStep(2)
            } finally {
              window.setTimeout(() => { setJob(''); setStep(-1) }, 900)
            }
          })}
        >
          <PendingLabel pending={busy && job === 'preaudit'}>{t('preaudit')}</PendingLabel>
        </button>
      </div>
      {job === 'export' && step >= 0 && <StepStatus steps={[t('stepExport'), t('stepDownload'), t('stepDone')]} current={step} />}
      {job === 'preaudit' && step >= 0 && <StepStatus steps={[t('stepScan'), t('stepNotify'), t('stepDone')]} current={step} />}
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
          <caption className="sr-only">{t('stats')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('account')}</th>
              <th scope="col">{locale === 'en' ? 'Name' : '姓名'}</th>
              <th scope="col">{t('overview')}</th>
              <th scope="col">{t('englishRate')}</th>
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
  const confirm = useConfirm()
  const { busy, run } = useLock()
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
  if (query.isLoading || !query.data) return query.isLoading ? <PageSkeleton /> : <p className="text-sm text-muted">{t('error')}</p>
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
        {submission.note && <p className="rounded-xl bg-[#f6f7fb] px-3 py-2 text-sm">{submission.note}</p>}
        <div className="flex flex-wrap gap-2">
          {submission.files.map((file) => (
            <button key={file.id} className={`btn px-2.5 py-1 ${activeFile === file.id ? 'btn-ink' : 'btn-ghost'}`} type="button" onClick={() => setFileId(file.id)}>
              {file.originalName}
            </button>
          ))}
        </div>
        <label className="block text-sm font-medium">
          {t('comment')}
          <textarea className="field w-full" value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-pass"
            type="button"
            disabled={busy}
            onClick={() => run(async () => {
              await api(`/api/admin/reviews/${submission.id}`, { method: 'POST', body: { decision: 'APPROVED', comment }, success: t('saved') })
              setComment('')
              setCurrent(0)
              await client.invalidateQueries({ queryKey: ['reviews'] })
            })}
          >
            <PendingLabel pending={busy}>{t('approve')}</PendingLabel>
          </button>
          <button
            className="btn btn-miss"
            type="button"
            disabled={busy}
            onClick={() => run(async () => {
              const ok = await confirm({ title: t('confirmTitle'), body: t('confirmReject'), confirm: t('reject'), danger: true })
              if (!ok) return
              await api(`/api/admin/reviews/${submission.id}`, { method: 'POST', body: { decision: 'REJECTED', comment }, success: t('saved') })
              setComment('')
              await client.invalidateQueries({ queryKey: ['reviews'] })
            })}
          >
            <PendingLabel pending={busy}>{t('reject')}</PendingLabel>
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {query.data.submissions.map((item, index) => (
            <button
              key={item.id}
              className={`rounded-full px-3 py-1 font-medium ${index === current ? 'bg-pine text-white' : 'bg-[#eef1f6] text-ink'}`}
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
  const confirm = useConfirm()
  const { busy, run } = useLock()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: { id: string; account: string; nameZh: string; role: string; status: string; cohortYear: number | null; classNameZh: string }[]; classes: { id: string; nameZh: string }[] }>('/api/admin/users'),
  })
  const [form, setForm] = useState({ account: '', nameZh: '', nameEn: '', email: '', role: 'STUDENT', cohortYear: 115 })
  const [temp, setTemp] = useState('')
  const [formMessage, setFormMessage] = useState('')
  const dirty = Boolean(form.account || form.nameZh || form.nameEn || form.email)
  useUnsaved(dirty)
  if (query.isLoading || !query.data) return query.isLoading ? <PageSkeleton /> : <p className="text-sm text-muted">{t('error')}</p>
  const accountOk = form.role === 'STUDENT' ? /^B\d{8}$/.test(form.account) : form.role === 'TEACHER' ? /^T\d{4}$/.test(form.account) : /^A\d{4}$/.test(form.account)
  const emailOk = /^[^\s@]+@nutc\.edu\.tw$/i.test(form.email)
  const nameOk = form.nameZh.trim().length > 0 && form.nameEn.trim().length > 0
  const cohortOk = form.role !== 'STUDENT' || (form.cohortYear >= 100 && form.cohortYear <= 200)
  const formIssues = [!accountOk ? t('badAccount') : '', !emailOk ? t('badEmail') : '', !nameOk ? t('needName') : '', !cohortOk ? t('badCohort') : ''].filter(Boolean)
  return (
    <div className="space-y-4">
      <ImportPanel />
      <form
        className="card grid gap-2 p-4 md:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (formIssues.length) return
          void run(async () => {
            setFormMessage('')
            try {
              const created = await api<{ tempPassword: string }>('/api/admin/users', {
                method: 'POST',
                body: { ...form, cohortYear: form.role === 'STUDENT' ? Number(form.cohortYear) : undefined },
                success: t('saved'),
              })
              setTemp(created.tempPassword)
              setForm({ account: '', nameZh: '', nameEn: '', email: '', role: 'STUDENT', cohortYear: 115 })
              await client.invalidateQueries({ queryKey: ['users'] })
            } catch (error) {
              setFormMessage(errorMessage(error, locale, t('error')))
            }
          })
        }}
      >
        {(['account', 'nameZh', 'nameEn', 'email'] as const).map((key) => (
          <input key={key} className="field w-full" aria-label={key === 'account' ? t('account') : key === 'email' ? t('emailLabel') : key === 'nameEn' ? t('nameEnLabel') : t('nameZhLabel')} placeholder={key === 'account' ? t('account') : key === 'email' ? t('emailLabel') : key === 'nameEn' ? t('nameEnLabel') : t('nameZhLabel')} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} required />
        ))}
        <select className="field w-full" aria-label={t('roleLabel')} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
          <option>STUDENT</option>
          <option>TEACHER</option>
          <option>ADMIN</option>
        </select>
        <input className="field w-full" type="number" aria-label={t('cohort')} value={form.cohortYear} onChange={(event) => setForm({ ...form, cohortYear: Number(event.target.value) })} />
        <button className="btn btn-ink" type="submit" disabled={busy || formIssues.length > 0} title={formIssues[0] || undefined}>
          <PendingLabel pending={busy}>{t('save')}</PendingLabel>
        </button>
      </form>
      {formIssues.length > 0 && dirty && <p className="text-sm text-[#9e1d22]">{formIssues[0]}</p>}
      {formMessage && <p className="text-sm font-medium text-[#9e1d22]">{formMessage}</p>}
      {temp && <p className="rounded-xl bg-[#fff6e0] px-3 py-2 text-sm font-medium text-[#8a5600]">暫時密碼（只顯示一次）：{temp}</p>}
      <div className="card overflow-auto">
        <table className="data-table">
          <caption className="sr-only">{t('users')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('account')}</th>
              <th scope="col">{locale === 'en' ? 'Name' : '姓名'}</th>
              <th scope="col">{locale === 'en' ? 'Role' : '角色'}</th>
              <th scope="col">{locale === 'en' ? 'Status' : '狀態'}</th>
              <th scope="col">{locale === 'en' ? 'Action' : '操作'}</th>
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
                    <button className="font-medium text-[#9e1d22] underline-offset-2 hover:underline" type="button" disabled={busy} onClick={() => run(async () => { const ok = await confirm({ title: t('confirmTitle'), body: `${user.account} ${t('confirmDeactivate')}`, confirm: t('deactivate'), danger: true }); if (!ok) return; await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { status: 'DEACTIVATED', deactivationReason: 'SUSPENDED' } }); await client.invalidateQueries({ queryKey: ['users'] }) })}>
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
  const confirm = useConfirm()
  const { busy, run } = useLock()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [ruleMessage, setRuleMessage] = useState('')
  useUnsaved(Object.keys(drafts).length > 0)
  const query = useQuery({
    queryKey: ['rules'],
    queryFn: () =>
      api<{
        rules: { cohortYear: number; totalCredits: number | null; totalCreditsConfirmed: boolean; summaryZh: string; summaryEn: string; sourceNoteZh: string; categories: { id: string; nameZh: string; nameEn: string; requiredCredits: number | null; isPlaceholder: boolean; noteZh: string; noteEn: string }[] }[]
      }>('/api/admin/rules'),
  })
  const client = useQueryClient()
  if (query.isLoading || !query.data) return query.isLoading ? <PageSkeleton /> : <p className="text-sm text-muted">{t('error')}</p>
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
                  value={drafts[category.id] ?? (category.requiredCredits ?? '')}
                  onChange={(event) => setDrafts({ ...drafts, [category.id]: event.target.value })}
                />
              </label>
            ))}
          </div>
          <button
            className="btn btn-primary mt-4"
            type="button"
            disabled={busy || !rule.categories.some((category) => drafts[category.id] !== undefined)}
            title={!rule.categories.some((category) => drafts[category.id] !== undefined) ? t('empty') : undefined}
            onClick={() => run(async () => {
              const changed = rule.categories.filter((category) => drafts[category.id] !== undefined)
              if (!changed.length) return
              if (changed.some((category) => drafts[category.id] !== '' && !Number.isFinite(Number(drafts[category.id])))) {
                setRuleMessage(t('badCohort'))
                return
              }
              const ok = await confirm({ title: t('confirmTitle'), body: t('confirmRules'), confirm: t('save') })
              if (!ok) return
              setRuleMessage('')
              try {
                await api(`/api/admin/rules/${rule.cohortYear}`, {
                  success: t('saved'),
                  method: 'PATCH',
                  body: {
                    categories: changed.map((category) => {
                      const raw = drafts[category.id]
                      const value = raw === '' ? null : Number(raw)
                      return { id: category.id, requiredCredits: value, isPlaceholder: value == null, noteZh: category.noteZh, noteEn: category.noteEn }
                    }),
                    totalCreditsConfirmed: rule.totalCreditsConfirmed,
                  },
                })
                setDrafts((current) => {
                  const next = { ...current }
                  for (const category of changed) delete next[category.id]
                  return next
                })
                await client.invalidateQueries({ queryKey: ['rules'] })
              } catch (error) {
                setRuleMessage(errorMessage(error, locale, t('error')))
              }
            })}
          >
            <PendingLabel pending={busy}>{t('save')}</PendingLabel>
          </button>
          {ruleMessage && <p className="mt-2 text-sm text-[#9e1d22]">{ruleMessage}</p>}
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
  if (query.isLoading || !query.data) return query.isLoading ? <PageSkeleton /> : <p className="text-sm text-muted">{t('error')}</p>
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
        <select className="field w-full" aria-label={t('roleLabel')} value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
          <option>ENGLISH</option>
          <option>CERTIFICATION</option>
          <option>COMPETITION</option>
        </select>
        <input className="field w-full" aria-label={t('nameZhLabel')} placeholder={t('nameZhLabel')} value={form.nameZh} onChange={(event) => setForm({ ...form, nameZh: event.target.value })} required />
        <input className="field w-full" aria-label={t('nameEnLabel')} placeholder={t('nameEnLabel')} value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} required />
        <button className="btn btn-ink" type="submit" disabled={!form.nameZh.trim() || !form.nameEn.trim()} title={!form.nameZh.trim() || !form.nameEn.trim() ? t('needName') : undefined}>{t('save')}</button>
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
  if (query.isLoading || !query.data) return query.isLoading ? <PageSkeleton /> : <p className="text-sm text-muted">{t('error')}</p>
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
  const confirm = useConfirm()
  const { busy, run } = useLock()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['retention'],
    queryFn: () => api<{ retentionYears: number; preview: { users: { account: string; nameZh: string }[] } }>('/api/admin/retention'),
  })
  const [years, setYears] = useState(5)
  useUnsaved(Boolean(query.data) && years !== query.data?.retentionYears)
  if (query.isLoading || !query.data) return query.isLoading ? <PageSkeleton /> : <p className="text-sm text-muted">{t('error')}</p>
  return (
    <div className="card space-y-4 p-5">
      <p className="leading-7">停用後保存 {query.data.retentionYears} 年，到期可去識別並刪除上傳檔。目前可清除 {query.data.preview.users.length} 筆。</p>
      <label className="block text-sm font-medium">
        年
        <input className="field ml-2 mt-0 w-24" type="number" value={years} onChange={(event) => setYears(Number(event.target.value))} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-ghost" type="button" disabled={busy || years === query.data.retentionYears || years < 1 || years > 30} title={years === query.data.retentionYears ? t('empty') : undefined} onClick={() => run(async () => { await api('/api/admin/retention', { method: 'PUT', body: { retentionYears: years } }); await client.invalidateQueries({ queryKey: ['retention'] }) })}>
          <PendingLabel pending={busy}>{t('save')}</PendingLabel>
        </button>
        <button
          className="btn btn-miss"
          type="button"
          disabled={busy}
          onClick={() => run(async () => {
            const ok = await confirm({ title: t('confirmTitle'), body: t('confirmPurge'), confirm: t('confirmTitle'), danger: true })
            if (!ok) return
            await api('/api/admin/retention/purge', { method: 'POST', body: { confirm: 'PURGE' } })
            await client.invalidateQueries({ queryKey: ['retention'] })
          })}
        >
          執行去識別
        </button>
      </div>
    </div>
  )
}
