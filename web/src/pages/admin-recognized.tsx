import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Award, BookOpen, Pencil, Plus, Search, SlidersHorizontal, Trophy } from 'lucide-react'
import { useRef, useState } from 'react'
import { ActionDialog } from '../components/action-dialog'
import { useConfirm, useLock, useUnsaved } from '../components/confirm'
import { PageSkeleton, PendingButton } from '../components/feedback'
import { EmptyState } from '../components/shell'
import { api, errorMessage } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { BatchImportLink } from './admin-batch-import'

const categories = {
  ENGLISH: { title: 'englishItem', Icon: BookOpen },
  CERTIFICATION: { title: 'certItem', Icon: Award },
  COMPETITION: { title: 'competitionItem', Icon: Trophy },
} as const
type ItemType = keyof typeof categories
type Item = { id: string; type: ItemType; nameZh: string; nameEn: string; minScore: number | null; active: boolean }
const types = Object.keys(categories) as ItemType[]
const initial = { type: 'CERTIFICATION' as ItemType, nameZh: '', nameEn: '', minScore: '' }

export function AdminRecognized() {
  const { t, locale } = useI18n()
  const client = useQueryClient()
  const confirm = useConfirm()
  const { busy, run } = useLock()
  const query = useQuery({ queryKey: ['recognized'], queryFn: () => api<{ items: Item[] }>('/api/admin/recognized') })
  const [category, setCategory] = useState<ItemType | 'ALL'>('ALL')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')
  const [editor, setEditor] = useState<Item | 'new' | null>(null)
  const [form, setForm] = useState(initial)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const nameField = useRef<HTMLInputElement>(null)
  const editorTrigger = useRef<HTMLButtonElement | null>(null)
  useUnsaved(dirty)

  const items = query.data?.items ?? []
  const term = search.trim().toLowerCase()
  const visible = items.filter((item) =>
    (category === 'ALL' || item.type === category) &&
    (status === 'ALL' || item.active === (status === 'ACTIVE')) &&
    (item.nameZh.toLowerCase().includes(term) || item.nameEn.toLowerCase().includes(term)),
  )

  function openEditor(item: Item | 'new', trigger: HTMLButtonElement) {
    editorTrigger.current = trigger
    setEditor(item)
    setForm(item === 'new'
      ? { ...initial, type: category === 'ALL' ? initial.type : category }
      : { type: item.type, nameZh: item.nameZh, nameEn: item.nameEn, minScore: String(item.minScore ?? '') })
    setDirty(false)
    setMessage('')
    setNotice('')
  }

  function closeEditor() {
    setEditor(null)
    setDirty(false)
    setMessage('')
  }

  function dismissEditor() {
    void run(async () => {
      if (!dirty || await confirm({ title: t('ruleDiscard'), body: t('recognizedDiscard'), confirm: t('ruleDiscard') })) closeEditor()
    })
  }

  function patchForm(next: Partial<typeof initial>) {
    setForm((current) => ({ ...current, ...next }))
    setDirty(true)
  }

  async function updateList(item: Item) {
    client.setQueryData<{ items: Item[] }>(['recognized'], (current) => ({
      items: [item, ...(current?.items ?? []).filter((entry) => entry.id !== item.id)],
    }))
    await client.invalidateQueries({ queryKey: ['recognized'] })
  }

  return (
    <div className="space-y-4">
      <div className="recognized-categories" role="group" aria-label={t('itemType')}>
        {(['ALL', ...types] as const).map((type) => {
          const Icon = type === 'ALL' ? SlidersHorizontal : categories[type].Icon
          return (
            <button key={type} type="button" aria-pressed={category === type} onClick={() => setCategory(type)}>
              <Icon size={19} aria-hidden />
              <span>{type === 'ALL' ? t('recognizedAll') : t(categories[type].title)}</span>
              <span className="recognized-category-count">{type === 'ALL' ? items.length : items.filter((item) => item.type === type).length}</span>
            </button>
          )
        })}
      </div>
      {notice && <p className="login-result login-result-success" role="status">{notice}</p>}
      {editor && <ActionDialog title={t(editor === 'new' ? 'addRecognized' : 'recognizedEdit')}
        onDismiss={dismissEditor} busy={busy} initialFocus={nameField} triggerRef={editorTrigger}>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            setMessage('')
            const nameZh = form.nameZh.trim()
            if (!nameZh) { setMessage(t('formRequired')); return }
            const minScore = form.minScore === '' ? null : Number(form.minScore)
            if (minScore !== null && (!Number.isFinite(minScore) || minScore < 0)) { setMessage(t('ruleInvalidCredits')); return }
            try {
              const fields = { nameZh, nameEn: form.nameEn.trim() || nameZh, minScore }
              const item = editor === 'new'
                ? await api<Item>('/api/admin/recognized', { method: 'POST', body: { ...fields, type: form.type, countsAsPass: true, active: true }, silent: true })
                : await api<Item>(`/api/admin/recognized/${editor.id}`, { method: 'PATCH', body: fields, silent: true })
              await updateList(item)
              closeEditor()
              if (editor === 'new') { setCategory(item.type); setStatus('ALL'); setSearch('') }
              setNotice(`${t('saved')} · ${locale === 'en' ? item.nameEn : item.nameZh}`)
            } catch (error) {
              setMessage(errorMessage(error, locale, t('error')))
            }
          })
        }}>
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            {editor === 'new' && <label className="block text-sm font-semibold">{t('itemType')}
              <select className="field w-full" value={form.type} onChange={(event) => patchForm({ type: event.target.value as ItemType })}>
                {types.map((type) => <option key={type} value={type}>{t(categories[type].title)}</option>)}
              </select>
            </label>}
            {editor !== 'new' && <p className="text-sm text-muted">{t('itemType')} · {t(categories[editor.type].title)}</p>}
            <label className="block text-sm font-semibold">{t('minScoreOptional')}
              <input className="field w-full" type="number" min="0" step="any" inputMode="decimal" placeholder={t('recognizedNoScore')} value={form.minScore} onChange={(event) => patchForm({ minScore: event.target.value })} />
            </label>
            <label className="block text-sm font-semibold">{t('recognizedName')}
              <input ref={nameField} className="field w-full" required maxLength={120} value={form.nameZh} onChange={(event) => patchForm({ nameZh: event.target.value })} />
            </label>
            <label className="block text-sm font-semibold">{t('recognizedEnglishOptional')}
              <input className="field w-full" maxLength={160} value={form.nameEn} onChange={(event) => patchForm({ nameEn: event.target.value })} />
            </label>
          </fieldset>
          {message && <p className="login-result" role="alert">{message}</p>}
          <div className="action-dialog-actions">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={dismissEditor}>{t('cancel')}</button>
            <PendingButton type="submit" className="btn btn-primary" pending={busy}>{t(editor === 'new' ? 'addRecognized' : 'recognizedSave')}</PendingButton>
          </div>
        </form>
      </ActionDialog>}
      <section className="card">
        <header className="panel-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="section-title">{t('recognizedItems')}</h2>
            <div className="flex flex-wrap gap-2">
              <BatchImportLink kind="recognized" />
              <button type="button" className="btn btn-primary" disabled={busy} aria-haspopup="dialog" onClick={(event) => openEditor('new', event.currentTarget)}>
                <Plus size={17} aria-hidden />{t('addRecognized')}
              </button>
            </div>
          </div>
          <div className="account-filters">
            <label className="text-sm font-semibold">{t('recognizedSearch')}
              <span className="account-search"><Search size={17} aria-hidden />
                <input className="field w-full" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
              </span>
            </label>
            <label className="text-sm font-semibold">{t('recognizedStatus')}
              <select className="field w-full" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                <option value="ALL">{t('recognizedAllStatuses')}</option>
                <option value="ACTIVE">{t('itemActive')}</option>
                <option value="INACTIVE">{t('accountInactive')}</option>
              </select>
            </label>
          </div>
        </header>
        {query.isLoading ? <div className="p-4"><PageSkeleton /></div> : query.isError ? (
          <div className="p-4"><p role="alert">{t('loadFailed')}</p><button type="button" className="btn btn-ghost mt-2" onClick={() => void query.refetch()}>{t('tryAgain')}</button></div>
        ) : !visible.length ? <EmptyState>{t(items.length ? 'recognizedNoResults' : 'recognizedEmpty')}</EmptyState> : (
          <ul className="recognized-grid">
            {visible.map((item) => {
              const { Icon, title } = categories[item.type]
              const name = locale === 'en' ? item.nameEn : item.nameZh
              const toggleLabel = t(item.active ? 'deactivate' : 'activate')
              return (
                <li key={item.id} className="recognized-item">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="workspace-event-icon"><Icon size={19} aria-hidden /></span>
                    <span className={`account-state ${item.active ? 'account-state-active' : ''}`}>{t(item.active ? 'itemActive' : 'accountInactive')}</span>
                  </div>
                  <p className="text-xs font-semibold text-teal">{t(title)}</p>
                  <h3 className="item-title">{name}</h3>
                  <p className="text-sm text-muted">{item.minScore == null ? t('recognizedNoScore') : <>{t('recognizedMinimum')} <strong className="text-ink tabular-nums">{item.minScore}</strong></>}</p>
                  <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-3">
                    <button type="button" className="btn btn-ghost" disabled={busy && !editor} aria-haspopup="dialog" aria-label={`${t('recognizedEdit')} · ${name}`} onClick={(event) => openEditor(item, event.currentTarget)}><Pencil size={15} aria-hidden />{t('recognizedEdit')}</button>
                    <button type="button" className="btn btn-ghost" disabled={busy || Boolean(editor)} aria-label={`${toggleLabel} · ${name}`} onClick={() => run(async () => {
                      if (!await confirm({ title: `${toggleLabel} · ${name}`, body: t(item.active ? 'confirmHideItem' : 'confirmShowItem'), confirm: toggleLabel, danger: item.active })) return
                      try {
                        const changed = await api<Item>(`/api/admin/recognized/${item.id}`, { method: 'PATCH', body: { active: !item.active }, success: t('saved') })
                        await updateList(changed)
                      } catch {
                        // The API client displays the failure.
                      }
                    })}>{toggleLabel}</button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
