import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileUp, Search, ShieldCheck, UserPlus, UserRoundX, UsersRound } from 'lucide-react'
import { useRef, useState } from 'react'
import { useConfirm, useLock, useUnsaved } from '../components/confirm'
import { PageSkeleton, PendingButton } from '../components/feedback'
import { EmptyState } from '../components/shell'
import { api, errorMessage } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { ImportPanel } from './import-panel'

const roles = { STUDENT: 'studentRole', TEACHER: 'teacherRole', ADMIN: 'adminRole' } as const
const patterns = { STUDENT: /^B\d{8}$/, TEACHER: /^T\d{4}$/, ADMIN: /^A\d{4}$/ }
const examples = { STUDENT: 'B11523001', TEACHER: 'T1001', ADMIN: 'A0001' }
type Role = keyof typeof roles
type User = {
  id: string; account: string; nameZh: string; nameEn: string; role: Role; status: 'ACTIVE' | 'DEACTIVATED'; anonymized: boolean
  cohortYear: number | null; classNameZh: string
}
type Class = { id: string; cohortYear: number; nameZh: string; nameEn: string }
const emptyForm = { account: '', nameZh: '', nameEn: '', email: '', role: 'STUDENT' as Role, cohortYear: '', classId: '' }
const pageSize = 20

export function AdminUsers() {
  const { t, locale } = useI18n()
  const confirm = useConfirm()
  const { busy, run } = useLock()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: User[]; classes?: Class[] }>('/api/admin/users') })
  const [mode, setMode] = useState<'list' | 'create' | 'import'>('list')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | ''>('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DEACTIVATED' | 'ANONYMIZED'>('ALL')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState(emptyForm)
  const [attempted, setAttempted] = useState(false)
  const [message, setMessage] = useState('')
  const [created, setCreated] = useState<{ account: string; tempPassword?: string } | null>(null)
  const panelHeading = useRef<HTMLHeadingElement>(null)
  const directoryHeading = useRef<HTMLHeadingElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  const createdMessage = useRef<HTMLDivElement>(null)
  useUnsaved(Boolean(form.account || form.nameZh || form.nameEn || form.email || form.cohortYear || form.classId))

  const term = search.trim().toLowerCase()
  const directory = query.data?.users ?? []
  const users = directory.filter((user) =>
    (!roleFilter || user.role === roleFilter) &&
    (statusFilter === 'ALL' || statusFilter === (user.anonymized ? 'ANONYMIZED' : user.status)) &&
    [user.account, user.nameZh, user.nameEn, user.classNameZh].some((value) => value?.toLowerCase().includes(term)),
  )
  const activeCount = directory.filter((user) => user.status === 'ACTIVE' && !user.anonymized).length
  const inactiveCount = directory.filter((user) => user.status === 'DEACTIVATED' && !user.anonymized).length
  const pageCount = Math.max(1, Math.ceil(users.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const first = (currentPage - 1) * pageSize
  const visible = users.slice(first, first + pageSize)
  const cohortYear = Number(form.cohortYear)
  const classes = (query.data?.classes ?? []).filter((item) => item.cohortYear === cohortYear)
  const errors = {
    account: patterns[form.role].test(form.account.trim()) ? '' : `${t('badAccount')} ${t('example')} ${examples[form.role]}`,
    nameZh: form.nameZh.trim() ? '' : t('formRequired'),
    nameEn: form.nameEn.trim() ? '' : t('formRequired'),
    email: /^[^\s@]+@nutc\.edu\.tw$/i.test(form.email.trim()) ? '' : t('badEmail'),
    cohortYear: form.role !== 'STUDENT' || (Number.isInteger(cohortYear) && cohortYear >= 100 && cohortYear <= 200) ? '' : t('badCohort'),
  }
  const fields = [
    ['account', 'account', examples[form.role], 40],
    ['nameZh', 'nameZhLabel', '', 40],
    ['nameEn', 'nameEnLabel', '', 80],
    ['email', 'emailLabel', 'name@nutc.edu.tw', 120],
    ...(form.role === 'STUDENT' ? [['cohortYear', 'cohort', '115', 3] as const] : []),
  ] as const

  function open(next: typeof mode) {
    setMode(next)
    requestAnimationFrame(() => {
      if (next === 'list') directoryHeading.current?.focus()
      else if (next === 'create') panelHeading.current?.focus()
      else backButton.current?.focus()
    })
  }

  function resetFilters() {
    setSearch('')
    setRoleFilter('')
    setStatusFilter('ALL')
    setPage(1)
  }

  return (
    <div className="space-y-4">
      {mode === 'list' && query.data && (
        <div className="directory-summary">
          {([
            ['directoryTotal', directory.length, UsersRound],
            ['directoryActive', activeCount, ShieldCheck],
            ['directoryInactive', inactiveCount, UserRoundX],
          ] as const).map(([label, count, Icon]) => (
            <section key={label} className="card metric-card">
              <span className="workspace-event-icon"><Icon size={19} aria-hidden /></span>
              <div><h2 className="text-sm text-muted">{t(label)}</h2><p className="text-2xl font-bold tabular-nums">{count}</p></div>
            </section>
          ))}
        </div>
      )}
      <section id="accounts-list" hidden={mode !== 'list'} className="card account-directory">
        <div className="panel-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 ref={directoryHeading} tabIndex={-1} className="section-title">{t('accountList')}</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => open('import')}><FileUp size={17} aria-hidden />{t('importTitle')}</button>
              <button type="button" className="btn btn-primary" onClick={() => open('create')}><UserPlus size={17} aria-hidden />{t('createAccount')}</button>
            </div>
          </div>
          <div className="account-filters directory-filters">
            <label className="text-sm font-semibold">
              {t('findAccount')}
              <span className="account-search">
                <Search size={17} aria-hidden />
                <input className="field w-full" type="search" value={search} placeholder={t('accountSearchHint')} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
              </span>
            </label>
            <label className="text-sm font-semibold">
              {t('roleLabel')}
              <select className="field w-full" value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value as Role | ''); setPage(1) }}>
                <option value="">{t('allRoles')}</option>
                {(Object.keys(roles) as Role[]).map((role) => <option key={role} value={role}>{t(roles[role])}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold">{t('recognizedStatus')}
              <select className="field w-full" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1) }}>
                <option value="ALL">{t('recognizedAllStatuses')}</option>
                <option value="ACTIVE">{t('itemActive')}</option>
                <option value="DEACTIVATED">{t('accountInactive')}</option>
                <option value="ANONYMIZED">{t('accountAnonymized')}</option>
              </select>
            </label>
          </div>
        </div>
        {query.isLoading ? <div className="p-4"><PageSkeleton /></div> : query.isError ? (
          <div className="p-4">
            <p role="alert" className="login-result">{t('loadFailed')}</p>
            <button type="button" className="btn btn-ghost mt-2" onClick={() => void query.refetch()}>{t('tryAgain')}</button>
          </div>
        ) : <>
          <div className="directory-results">
            <p className="text-sm text-muted" role="status">{t('directoryResults')} {users.length} / {directory.length}</p>
            {(search || roleFilter || statusFilter !== 'ALL') && <button type="button" className="btn btn-ghost" onClick={resetFilters}>{t('directoryClear')}</button>}
          </div>
          {users.length === 0 ? <EmptyState>{term || roleFilter || statusFilter !== 'ALL' ? t('noMatchingAccounts') : t('empty')}</EmptyState> : (
          <ul className="directory-list">
            {visible.map((user) => {
              const deactivating = user.status === 'ACTIVE'
              const action = t(deactivating ? 'deactivate' : 'activate')
              const name = locale === 'en' ? user.nameEn || user.nameZh : user.nameZh
              return (
                <li key={user.id} className="directory-row">
                  <div className="account-row-name">
                    <span className="workspace-avatar" aria-hidden="true">{Array.from(name || user.account)[0]}</span>
                    <div className="min-w-0"><p className="font-bold">{name || user.account}</p><p className="text-sm text-muted">{user.account}</p></div>
                  </div>
                  <div className="directory-role text-sm text-muted">
                    <p className="font-semibold text-ink">{t(roles[user.role])}</p>
                    {user.role === 'STUDENT' && !user.anonymized && <p>{[user.cohortYear ? `${user.cohortYear} ${t('cohort')}` : '', user.classNameZh].filter(Boolean).join(' · ')}</p>}
                  </div>
                  <span className={`account-state justify-self-start ${deactivating && !user.anonymized ? 'account-state-active' : ''}`}>{t(user.anonymized ? 'accountAnonymized' : deactivating ? 'itemActive' : 'accountInactive')}</span>
                  {!user.anonymized && <button type="button" className="btn btn-ghost" disabled={busy} aria-label={`${action} ${user.account}`} onClick={() => run(async () => {
                    if (!await confirm({ title: `${action} · ${user.account}`, body: t(deactivating ? 'confirmDeactivate' : 'confirmReactivate'), confirm: action, danger: deactivating })) return
                    await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: deactivating ? { status: 'DEACTIVATED', deactivationReason: 'SUSPENDED' } : { status: 'ACTIVE' }, success: t('saved') }).catch(() => undefined)
                    await client.invalidateQueries({ queryKey: ['users'] })
                  })}>{action}</button>}
                </li>
              )
            })}
          </ul>
          )}
          {pageCount > 1 && <footer className="directory-results border-t border-line">
            <p className="text-sm text-muted">{first + 1}–{first + visible.length} / {users.length}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{t('directoryPrevious')}</button>
              <button type="button" className="btn btn-ghost" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>{t('directoryNext')}</button>
            </div>
          </footer>}
        </>}
      </section>
      {mode !== 'list' && <button ref={backButton} type="button" className="btn btn-ghost" disabled={busy} onClick={() => open('list')}><ArrowLeft size={16} aria-hidden />{t('directoryBack')}</button>}
      <section id="accounts-create" hidden={mode !== 'create'} className="card p-4 sm:p-6">
        <h2 ref={panelHeading} tabIndex={-1} className="section-title">{t('createAccount')}</h2>
        <p className="mt-1 text-sm text-muted">{t('createAccountHint')}</p>
        {created && <div ref={createdMessage} tabIndex={-1} className="inset-panel mt-4" role="status">
          <p className="font-bold">{t('accountCreated')} {created.account}</p>
          {created.tempPassword && <><p className="mt-1 text-sm text-muted">{t('temporaryPasswordOnce')}</p><code className="break-all font-bold text-pine">{created.tempPassword}</code></>}
        </div>}
        <form className="mt-4 space-y-4" noValidate onSubmit={(event) => {
          event.preventDefault()
          setAttempted(true)
          setMessage('')
          const invalid = Object.entries(errors).find(([, error]) => error)
          if (invalid) {
            document.getElementById(`create-${invalid[0]}`)?.focus()
            return
          }
          void run(async () => {
            const account = form.account.trim()
            try {
              const result = await api<{ tempPassword?: string }>('/api/admin/users', {
                method: 'POST',
                body: { ...form, account, email: form.email.trim(), cohortYear: form.role === 'STUDENT' ? cohortYear : undefined, classId: form.role === 'STUDENT' ? form.classId || undefined : undefined },
                silent: true,
              })
              setCreated({ account, tempPassword: result.tempPassword })
              setForm(emptyForm)
              setAttempted(false)
              requestAnimationFrame(() => createdMessage.current?.focus())
              await client.invalidateQueries({ queryKey: ['users'] })
            } catch (error) {
              setMessage(errorMessage(error, locale, t('error')))
            }
          })
        }}>
          <fieldset className="space-y-4" disabled={busy}>
          <label className="block max-w-xs text-sm font-semibold">
            {t('roleLabel')}
            <select className="field w-full" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role, classId: '' })}>
              {(Object.keys(roles) as Role[]).map((role) => <option key={role} value={role}>{t(roles[role])}</option>)}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map(([key, label, placeholder, maxLength]) => {
              const error = attempted && errors[key]
              return (
                <div key={key} className="min-w-0">
                  <label htmlFor={`create-${key}`} className="block text-sm font-semibold">{t(label)}</label>
                  <input id={`create-${key}`} className="field w-full" type={key === 'email' ? 'email' : 'text'}
                    inputMode={key === 'cohortYear' ? 'numeric' : undefined} maxLength={maxLength} placeholder={placeholder}
                    required aria-invalid={Boolean(error)} aria-describedby={error ? `create-${key}-error` : undefined}
                    value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value, classId: key === 'cohortYear' ? '' : form.classId })} />
                  {error && <p className="login-error" id={`create-${key}-error`}>{error}</p>}
                </div>
              )
            })}
            {form.role === 'STUDENT' && classes.length > 0 && <label className="block text-sm font-semibold">{t('directoryClassOptional')}
              <select className="field w-full" value={form.classId} onChange={(event) => setForm({ ...form, classId: event.target.value })}>
                <option value="">{t('directoryNoClass')}</option>
                {classes.map((item) => <option key={item.id} value={item.id}>{locale === 'en' ? item.nameEn || item.nameZh : item.nameZh}</option>)}
              </select>
            </label>}
          </div>
          </fieldset>
          {message && <p className="login-result" role="alert">{message}</p>}
          <PendingButton type="submit" className="btn btn-primary" pending={busy}>{t('createAccount')}</PendingButton>
        </form>
      </section>
      <div id="accounts-import" hidden={mode !== 'import'}><ImportPanel /></div>
    </div>
  )
}
