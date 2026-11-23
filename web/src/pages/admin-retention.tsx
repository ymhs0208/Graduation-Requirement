import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Clock, Pencil, ShieldAlert, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { ActionDialog } from '../components/action-dialog'
import { useConfirm, useLock, useUnsaved } from '../components/confirm'
import { LoadError, PageSkeleton, PendingButton } from '../components/feedback'
import { EmptyState } from '../components/shell'
import { ApiError, api, errorMessage } from '../lib/api'
import { useI18n } from '../lib/i18n'

type Candidate = { id: string; account: string; nameZh: string; deactivatedAt: string; deactivationReason: string | null }
type Retention = { retentionYears: number; preview: { cutoff: string; users: Candidate[] } }
const reasons = { GRADUATED: 'retentionGraduated', TRANSFERRED: 'retentionTransferred', SUSPENDED: 'retentionSuspended', OTHER: 'retentionOther' } as const

export function AdminRetention() {
  const { t, locale } = useI18n()
  const confirm = useConfirm()
  const { busy, run } = useLock()
  const query = useQuery({ queryKey: ['retention'], queryFn: () => api<Retention>('/api/admin/retention', { silent: true }) })
  const [draft, setDraft] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [operation, setOperation] = useState<'save' | 'purge' | null>(null)
  const yearsInput = useRef<HTMLInputElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const editing = draft !== null
  const changed = editing && draft !== String(query.data?.retentionYears)
  useUnsaved(changed)

  const saved = query.data
  if (!saved && query.isLoading) return <PageSkeleton />
  const feedback = message && <p className={`login-result ${message.error ? '' : 'login-result-success'}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>
  if (query.isError || !saved) return (
    <div className="space-y-4">
      {feedback}
      <LoadError pending={query.isFetching} onRetry={() => void query.refetch()} />
    </div>
  )

  const { retentionYears, preview } = saved
  const count = preview.users.length
  const years = Number(draft)
  const valid = draft !== null && /^\d+$/.test(draft) && years >= 1 && years <= 30
  const dateFormat = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Taipei' })
  const formatDate = (value: string) => dateFormat.format(new Date(value))

  function closeEditor() {
    setDraft(null)
  }

  function dismissEditor() {
    void run(async () => {
      if (changed && !await confirm({ title: t('ruleDiscard'), body: t('ruleDiscardConfirm'), confirm: t('ruleDiscard') })) return
      setMessage(null)
      closeEditor()
    })
  }

  return (
    <div className="space-y-4">
      {!editing && feedback}
      <div className="retention-overview">
        <section className="card metric-card">
          <span className="workspace-event-icon"><Clock size={20} aria-hidden /></span>
          <div><h2 className="metric-title">{t('retentionCurrent')}</h2><p className="text-2xl font-bold tabular-nums">{retentionYears} <span className="text-sm font-medium">{t('retentionYearUnit')}</span></p></div>
        </section>
        <section className="card metric-card">
          <span className="workspace-event-icon"><CalendarDays size={20} aria-hidden /></span>
          <div><h2 className="metric-title">{t('retentionCutoffLabel')}</h2><p className="font-bold"><time dateTime={preview.cutoff}>{formatDate(preview.cutoff)}</time></p></div>
        </section>
      </div>
      <div className="retention-layout">
        <section className="card self-start">
          <div className="panel-heading border-b border-line">
            <h2 className="section-title">{t('retentionSettings')}</h2>
            <p className="mt-1 text-sm text-muted">{t('retentionSettingHint')}</p>
          </div>
          <div className="p-4 sm:p-5">
            <button ref={editButton} type="button" className="btn btn-ghost" disabled={busy && !editing} aria-haspopup="dialog" onClick={() => { setMessage(null); setDraft(String(retentionYears)) }}>
              <Pencil size={16} aria-hidden />{t('retentionEdit')}
            </button>
            {editing && (
              <ActionDialog title={t('retentionEdit')} description={t('retentionSettingHint')} onDismiss={dismissEditor}
                busy={busy} compact initialFocus={yearsInput} triggerRef={editButton}>
                <form className="space-y-4" noValidate onSubmit={(event) => {
                  event.preventDefault()
                  if (!valid || !changed) return
                  void run(async () => {
                    setMessage(null)
                    if (!await confirm({
                      title: t('saveRetention'),
                      body: `${retentionYears} → ${years} ${t('retentionYearUnit')}\n\n${t('retentionSaveConfirm')}`,
                      confirm: t('saveRetention'),
                    })) return
                    setOperation('save')
                    try {
                      await api('/api/admin/retention', { method: 'PUT', body: { retentionYears: years }, silent: true })
                      setMessage({ text: t('retentionSaved'), error: false })
                      await query.refetch()
                      closeEditor()
                    } catch (error) {
                      setMessage({ text: errorMessage(error, locale, t('error')), error: true })
                    } finally {
                      setOperation(null)
                    }
                  })
                }}>
                  <label className="block text-sm font-semibold">{t('retentionYearsLabel')}
                    <input ref={yearsInput} className="field block w-28" type="number" min="1" max="30" step="1" inputMode="numeric"
                      value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} />
                  </label>
                  {!valid && <p className="login-error">{t('retentionInvalidYears')}</p>}
                  {feedback}
                  <div className="action-dialog-actions">
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={dismissEditor}>{t('cancel')}</button>
                    <PendingButton type="submit" className="btn btn-primary" disabled={!valid || !changed || busy} pending={operation === 'save'}>{t('saveRetention')}</PendingButton>
                  </div>
                </form>
              </ActionDialog>
            )}
          </div>
        </section>
        <section className="card min-w-0">
          <header className="panel-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="section-title">{t('retentionExpired')}</h2>
              <span className="tag tabular-nums">{count} {t('retentionAccountUnit')}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{t('retentionListHint')}</p>
          </header>
          {count === 0 ? <EmptyState>{t('retentionEmpty')}</EmptyState> : (
            <ul className="retention-candidates">
              {preview.users.map((user) => (
                <li key={user.id} className="retention-candidate">
                  <div><p className="font-bold">{user.nameZh || user.account}</p><p className="text-sm text-muted">{user.account}</p></div>
                  <div className="text-sm"><time dateTime={user.deactivatedAt}>{formatDate(user.deactivatedAt)}</time>
                    <p className="text-xs text-muted">{t('retentionDeactivated')}{user.deactivationReason && user.deactivationReason in reasons ? ` · ${t(reasons[user.deactivationReason as keyof typeof reasons])}` : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {count > 0 && <div className="retention-cleanup">
            <div className="flex items-start gap-2">
              <ShieldAlert size={19} className="mt-0.5 shrink-0 text-[#9e1d22]" aria-hidden />
              <p className="text-sm text-muted">{t('retentionCleanupHint')}</p>
            </div>
            <PendingButton className="btn btn-miss" type="button" pending={operation === 'purge'} disabled={busy || editing || query.isError}
              onClick={() => run(async () => {
                setMessage(null)
                const confirmed = await confirm({
                  title: t('purgeRecords'),
                  body: `${t('retentionExpired')}：${count} ${t('retentionAccountUnit')}\n\n${t('retentionCleanupHint')}`,
                  confirm: t('purgeRecords'), danger: true,
                })
                if (!confirmed) return
                setOperation('purge')
                try {
                  const { data: latest } = await query.refetch({ throwOnError: true })
                  const reviewed = new Set(preview.users.map((user) => user.id))
                  if (!latest || latest.retentionYears !== retentionYears ||
                    latest.preview.users.length !== count || latest.preview.users.some((user) => !reviewed.has(user.id))) {
                    setMessage({ text: t('retentionListChanged'), error: true })
                    return
                  }
                  const result = await api<{ count: number }>('/api/admin/retention/purge', { method: 'POST', body: { confirm: 'PURGE' }, timeout: 60_000, silent: true })
                  if (!Number.isInteger(result.count) || result.count < 0) throw new ApiError('SERVER')
                  setMessage({ text: `${t('retentionPurged')} · ${result.count} ${t('retentionAccountUnit')}`, error: false })
                  await query.refetch()
                } catch (error) {
                  await query.refetch()
                  setMessage({ text: errorMessage(error, locale, t('retentionCleanupFailed')), error: true })
                } finally {
                  setOperation(null)
                }
              })}><Trash2 size={17} aria-hidden />{t('purgeRecords')}</PendingButton>
          </div>}
        </section>
      </div>
    </div>
  )
}
