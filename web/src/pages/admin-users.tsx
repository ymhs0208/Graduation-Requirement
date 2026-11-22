import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileUp, GraduationCap, Presentation, Search, ShieldCheck, UserRoundX, UsersRound } from 'lucide-react'
import { useRef, useState } from 'react'
import { useConfirm, useLock, useUnsaved } from '../components/confirm'
import { LoadError, PageSkeleton, PendingButton } from '../components/feedback'
import { EmptyState } from '../components/shell'
import { ApiError, api, errorMessage } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { ImportPanel } from './import-panel'
import { BatchImportLink } from './admin-batch-import'

const accountTypes = {
  STUDENT: { tab: 'studentRole', heading: 'directoryStudents', title: 'createStudentAccount', label: 'directoryStudentId', invalid: 'directoryBadStudentId', example: 'B11523001', pattern: /^B\d{8}$/, Icon: GraduationCap },
  TEACHER: { tab: 'directoryTeacher', heading: 'directoryTeachers', title: 'createTeacherAccount', label: 'directoryTeacherId', invalid: 'directoryBadTeacherId', example: 'T1001', pattern: /^T\d{4}$/, Icon: Presentation },
  ADMIN: { tab: 'directoryAdmin', heading: 'directoryAdmins', title: 'createAdminAccount', label: 'account', invalid: 'directoryBadAdminId', example: 'A0001', pattern: /^A\d{4}$/, Icon: ShieldCheck },
} as const
type Role = keyof typeof accountTypes
const accountRoles = Object.keys(accountTypes) as Role[]
type User = {
  id: string; account: string; nameZh: string; nameEn: string; role: Role; status: 'ACTIVE' | 'DEACTIVATED'; anonymized: boolean
  cohortYear: number | null; classNameZh: string
}
type Class = { id: string; cohortYear: number; nameZh: string; nameEn: string }
const emptyForm = { account: '', nameZh: '', nameEn: '', email: '', cohortYear: '', classId: '' }
const pageSize = 20

export function AdminUsers() {
  const { t, locale } = useI18n()
  const confirm = useConfirm()
  const { busy, run } = useLock()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: User[]; classes?: Class[] }>('/api/admin/users') })
  const [mode, setMode] = useState<'list' | 'import' | Role>('list')
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<Role>('STUDENT')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DEACTIVATED' | 'ANONYMIZED'>('ALL')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState(emptyForm)
  const [attempted, setAttempted] = useState(false)
  const [message, setMessage] = useState('')
  const [statusError, setStatusError] = useState('')
  const [created, setCreated] = useState<{ account: string; tempPassword?: string } | null>(null)
  const panelHeading = useRef<HTMLHeadingElement>(null)
  const directoryHeading = useRef<HTMLHeadingElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  const createdMessage = useRef<HTMLDivElement>(null)
  const createRole = mode === 'list' || mode === 'import' ? null : mode
  const accountType = createRole && accountTypes[createRole]
  const directoryType = accountTypes[role]
  const dirty = Object.values(form).some(Boolean)
  useUnsaved(dirty)

  const term = search.trim().toLowerCase()
  const directory = query.data?.users.filter((user) => user.role === role) ?? []
  const users = directory.filter((user) =>
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
    account: accountType && !accountType.pattern.test(form.account.trim()) ? t(accountType.invalid) : '',
    nameZh: form.nameZh.trim() ? '' : t('formRequired'),
    nameEn: form.nameEn.trim() ? '' : t('formRequired'),
    email: /^[^\s@]+@nutc\.edu\.tw$/i.test(form.email.trim()) ? '' : t('badEmail'),
    cohortYear: createRole !== 'STUDENT' || (Number.isInteger(cohortYear) && cohortYear >= 100 && cohortYear <= 200) ? '' : t('badCohort'),
  }
  const fields = [
    ['account', accountType?.label ?? 'account', accountType?.example ?? '', 20],
    ['nameZh', 'nameZhLabel', '', 40],
    ['nameEn', 'nameEnLabel', '', 80],
    ['email', 'emailLabel', 'name@nutc.edu.tw', 120],
    ...(createRole === 'STUDENT' ? [['cohortYear', 'cohort', '115', 3] as const] : []),
  ] as const

  function open(next: typeof mode) {
    setMode(next)
    requestAnimationFrame(() => {
      if (next === 'list') directoryHeading.current?.focus()
      else if (next === 'import') backButton.current?.focus()
      else panelHeading.current?.focus()
    })
  }

  async function returnToList() {
    if (dirty && !await confirm({ title: t('ruleDiscard'), body: t('unsaved'), confirm: t('ruleDiscard'), danger: true })) return
    setForm(emptyForm)
    setAttempted(false)
    setMessage('')
    setCreated(null)
    open('list')
  }

  function resetFilters() {
    setSearch('')
    setStatusFilter('ALL')
    setPage(1)
  }

  return (
    <div className="space-y-4">
      {mode === 'list' && <div className="directory-tabs" role="group" aria-label={t('directoryRoleTabs')}>
        {accountRoles.map((next) => {
          const { Icon, tab } = accountTypes[next]
          return <button key={next} type="button" aria-pressed={role === next} aria-controls="accounts-list" disabled={busy} onClick={() => {
            if (role === next) return
            setRole(next)
            setStatusError('')
            resetFilters()
          }}>
            <Icon size={17} aria-hidden />{t(tab)}
          </button>
        })}
      </div>}
      {mode === 'list' && query.data && !query.isError && (
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
      <section id="accounts-list" hidden={mode !== 'list'} className="card account-directory" aria-labelledby="role-directory-title">
        <div className="panel-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="role-directory-title" ref={directoryHeading} tabIndex={-1} className="section-title">{t(directoryType.heading)}</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => open('import')}><FileUp size={17} aria-hidden />{t('importTitle')}</button>
              {role === 'STUDENT' && <BatchImportLink kind="classes" />}
              <button type="button" className="btn btn-primary" onClick={() => open(role)}>
                <directoryType.Icon size={17} aria-hidden />{t(directoryType.title)}
              </button>
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
        {statusError && <p role="alert" className="login-result m-4">{statusError}</p>}
        {query.isLoading ? <div className="p-4"><PageSkeleton /></div> : query.isError || !query.data ? (
          <div className="p-4"><LoadError pending={query.isFetching} onRetry={() => void query.refetch()} /></div>
        ) : <>
          <div className="directory-results">
            <p className="text-sm text-muted" role="status">{t('directoryResults')} {users.length} / {directory.length}</p>
            {(search || statusFilter !== 'ALL') && <button type="button" className="btn btn-ghost" onClick={resetFilters}>{t('directoryClear')}</button>}
          </div>
          {users.length === 0 ? <EmptyState>{term || statusFilter !== 'ALL' ? t('noMatchingAccounts') : t('empty')}</EmptyState> : (
          <ul className="directory-list">
            {visible.map((user) => {
              const deactivating = user.status === 'ACTIVE'
              const action = t(deactivating ? 'deactivate' : 'activate')
              const name = locale === 'en' ? user.nameEn || user.nameZh : user.nameZh
              return (
                <li key={user.id} className="directory-row">
                  <div className="account-row-name">
                    <span className="workspace-avatar" aria-hidden="true">{Array.from(name || user.account)[0]}</span>
                    <div className="min-w-0">
                      <p className="font-bold">{name || user.account}</p>
                      <p className="text-sm text-muted">{[user.account, role === 'STUDENT' && !user.anonymized ? user.classNameZh : '', role === 'STUDENT' && !user.anonymized && user.cohortYear ? `${user.cohortYear} ${t('cohort')}` : ''].filter(Boolean).join(' · ')}</p>
                    </div>
                  </div>
                  <span className={`account-state justify-self-start ${deactivating && !user.anonymized ? 'account-state-active' : ''}`}>{t(user.anonymized ? 'accountAnonymized' : deactivating ? 'itemActive' : 'accountInactive')}</span>
                  {!user.anonymized && <button type="button" className="btn btn-ghost" disabled={busy} aria-label={`${action} ${user.account}`} onClick={() => run(async () => {
                    if (!await confirm({ title: `${action} · ${user.account}`, body: t(deactivating ? 'confirmDeactivate' : 'confirmReactivate'), confirm: action, danger: deactivating })) return
                    setStatusError('')
                    try {
                      await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: deactivating ? { status: 'DEACTIVATED', deactivationReason: 'SUSPENDED' } : { status: 'ACTIVE' }, success: t('saved'), silent: true })
                      await client.invalidateQueries({ queryKey: ['users'] })
                    } catch (error) {
                      setStatusError(errorMessage(error, locale, t('error')))
                    }
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
      {mode !== 'list' && <button ref={backButton} type="button" className="btn btn-ghost" disabled={busy} onClick={() => void returnToList()}><ArrowLeft size={16} aria-hidden />{t('directoryBack')}</button>}
      {createRole && accountType && <section className="card p-4 sm:p-6" aria-labelledby="accounts-create-title">
        <h2 id="accounts-create-title" ref={panelHeading} tabIndex={-1} className="section-title">{t(accountType.title)}</h2>
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
            setCreated(null)
            try {
              const result = await api<{ id?: string; tempPassword?: string }>('/api/admin/users', {
                method: 'POST',
                body: { ...form, role: createRole, account, email: form.email.trim(), cohortYear: createRole === 'STUDENT' ? cohortYear : undefined, classId: createRole === 'STUDENT' ? form.classId || undefined : undefined },
                silent: true,
              })
              if (typeof result.id !== 'string' || !result.id.trim()) throw new ApiError('SERVER')
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
            {createRole === 'STUDENT' && classes.length > 0 && <label className="block text-sm font-semibold">{t('directoryClassOptional')}
              <select className="field w-full" value={form.classId} onChange={(event) => setForm({ ...form, classId: event.target.value })}>
                <option value="">{t('directoryNoClass')}</option>
                {classes.map((item) => <option key={item.id} value={item.id}>{locale === 'en' ? item.nameEn || item.nameZh : item.nameZh}</option>)}
              </select>
            </label>}
          </div>
          </fieldset>
          {message && <p className="login-result" role="alert">{message}</p>}
          <PendingButton type="submit" className="btn btn-primary" pending={busy}>{t(accountType.title)}</PendingButton>
        </form>
      </section>}
      <div id="accounts-import" hidden={mode !== 'import'}><ImportPanel /></div>
    </div>
  )
}
