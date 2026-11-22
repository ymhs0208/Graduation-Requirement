import { useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useConfirm, useLock } from '../components/confirm'
import { PendingButton } from '../components/feedback'
import { EmptyState } from '../components/shell'
import { ApiError, api, errorMessage } from '../lib/api'
import { conditionDescription, conditionKinds, type Condition, type ConditionKind } from '../lib/conditions'
import { useI18n } from '../lib/i18n'

const empty = { nameZh: '', nameEn: '', descriptionZh: '', descriptionEn: '', kind: 'NON_CREDIT' as ConditionKind }

export function RuleConditions({ cohortYear, conditions, onDirtyChange }: { cohortYear: number; conditions: Condition[]; onDirtyChange: (dirty: boolean) => void }) {
  const { t, locale } = useI18n()
  const confirm = useConfirm()
  const { busy, run } = useLock()
  const client = useQueryClient()
  const [target, setTarget] = useState<Condition | 'new' | null>(null)
  const [form, setForm] = useState(empty)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (target) nameInput.current?.focus() }, [target])

  function open(item: Condition | 'new') {
    setTarget(item)
    setDirty(false)
    setSaved(false)
    setMessage('')
    if (item === 'new') setForm(empty)
    else setForm({
      nameZh: item.nameZh, nameEn: item.nameEn, kind: item.kind,
      descriptionZh: item.isPlaceholder ? '' : conditionDescription(item, 'zh-Hant', t('conditionRecognizedZh')),
      descriptionEn: item.isPlaceholder ? '' : conditionDescription(item, 'en', t('conditionRecognizedEn')),
    })
  }

  function update(field: keyof typeof form, value: string) {
    setDirty(true)
    onDirtyChange(true)
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function close() {
    setTarget(null)
    setDirty(false)
    onDirtyChange(false)
    setMessage('')
  }

  const active = conditions.filter((item) => !item.isPlaceholder)
  const templates = conditions.filter((item) => item.isPlaceholder)
  const formTitle = t(target === 'new' ? 'conditionAdd' : 'conditionEdit')

  return (
    <section className="card">
      <div className="panel-heading flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">{t('graduationRequirements')}</h2>
        {!target && <button type="button" className="btn btn-primary" onClick={() => open('new')}><Plus size={16} aria-hidden />{t('conditionAdd')}</button>}
      </div>
      {saved && <p role="status" className="login-result login-result-success mx-4 mb-3">{t('conditionSaved')}</p>}
      {target && (
        <form className="space-y-4 border-t border-line bg-[#f8faff] p-4 sm:p-5" onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            setMessage('')
            if (!form.nameZh.trim() || !form.descriptionZh.trim()) { setMessage(t('formRequired')); return }
            if (!await confirm({
              title: `${cohortYear} · ${t('conditionSave')}`,
              body: `${form.nameZh} · ${t(conditionKinds[form.kind])}\n${t('conditionSaveConfirm')}`,
              confirm: t('conditionSave'),
            })) return
            const endpoint = `/api/admin/rules/${cohortYear}/conditions`
            try {
              const result = await api<{ condition?: Condition }>(target === 'new' ? endpoint : `${endpoint}/${target.id}`, {
                method: target === 'new' ? 'POST' : 'PATCH', body: form, silent: true,
              })
              if (!result.condition?.id || (target !== 'new' && result.condition.id !== target.id)) throw new ApiError('SERVER')
              close()
              setSaved(true)
              await client.invalidateQueries({ queryKey: ['rules'] })
            } catch (error) {
              setMessage(errorMessage(error, locale, t('error')))
            }
          })
        }}>
          <h3 className="font-bold">{formTitle}</h3>
          <fieldset disabled={busy} className="space-y-3">
            <div className="rule-condition-fields">
              <label className="block text-sm font-semibold">{t('conditionName')}
                <input ref={nameInput} className="field w-full" required maxLength={80} value={form.nameZh} onChange={(event) => update('nameZh', event.target.value)} />
              </label>
              <label className="block text-sm font-semibold">{t('conditionKind')}
                <select className="field w-full" value={form.kind} onChange={(event) => update('kind', event.target.value)} aria-describedby={`condition-kind-hint-${cohortYear}`}>
                  {Object.entries(conditionKinds).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
                </select>
              </label>
            </div>
            <p id={`condition-kind-hint-${cohortYear}`} className="text-sm text-muted">{t(form.kind === 'NON_CREDIT' ? 'conditionRequiredHint' : form.kind === 'OPTIONAL' ? 'conditionOptionalHint' : 'conditionInfoHint')}</p>
            <label className="block text-sm font-semibold">{t('conditionDescription')}
              <textarea className="field w-full" required maxLength={1500} value={form.descriptionZh} onChange={(event) => update('descriptionZh', event.target.value)} />
            </label>
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-teal">{t('conditionEnglish')}</summary>
              <div className="mt-3 space-y-3">
                <label className="block text-sm font-semibold">{t('conditionEnglishName')}
                  <input className="field w-full" maxLength={120} value={form.nameEn} onChange={(event) => update('nameEn', event.target.value)} />
                </label>
                <label className="block text-sm font-semibold">{t('conditionEnglishDescription')}
                  <textarea className="field w-full" maxLength={1500} value={form.descriptionEn} onChange={(event) => update('descriptionEn', event.target.value)} />
                </label>
              </div>
            </details>
          </fieldset>
          {message && <p role="alert" className="login-result">{message}</p>}
          <div className="flex flex-wrap gap-2">
            <PendingButton type="submit" className="btn btn-primary" pending={busy}>{t('conditionSave')}</PendingButton>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(async () => {
              if (!dirty || await confirm({ title: t('ruleDiscard'), body: t('ruleDiscardConfirm'), confirm: t('ruleDiscard') })) close()
            })}>{t('cancel')}</button>
          </div>
        </form>
      )}
      {active.length === 0 && !target && <EmptyState>{t('conditionEmpty')}</EmptyState>}
      {!target && active.map((item) => {
        const name = locale === 'en' ? item.nameEn || item.nameZh : item.nameZh
        return (
          <article key={item.id} className="rule-condition">
            <div>
              <span className="rule-condition-kind" data-kind={item.kind}>{t(conditionKinds[item.kind] ?? 'conditionInfo')}</span>
              <h3 className="font-bold">{name}</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted">{conditionDescription(item, locale, t('recognizedRequirement'))}</p>
            </div>
            <button type="button" className="btn btn-ghost self-start justify-self-start" aria-label={`${t('conditionEdit')} · ${name}`} onClick={() => open(item)}><Pencil size={15} aria-hidden />{t('conditionEdit')}</button>
          </article>
        )
      })}
      {!target && templates.length > 0 && <details className="border-t border-line p-4">
        <summary className="cursor-pointer text-sm font-semibold text-teal">{t('conditionExisting')}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {templates.map((item) => <button key={item.id} type="button" className="btn btn-ghost" onClick={() => open(item)}>{locale === 'en' ? item.nameEn : item.nameZh}</button>)}
        </div>
      </details>}
    </section>
  )
}
