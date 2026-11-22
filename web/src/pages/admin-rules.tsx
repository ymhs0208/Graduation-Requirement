import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, GraduationCap, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useConfirm, useLock, useUnsaved } from '../components/confirm'
import { LoadError, PageSkeleton, PendingButton } from '../components/feedback'
import { EmptyState } from '../components/shell'
import { ApiError, api, errorMessage } from '../lib/api'
import { useI18n } from '../lib/i18n'
import type { Condition } from '../lib/conditions'
import { RuleConditions } from './rule-conditions'

type Category = {
  id: string; nameZh: string; nameEn: string; requiredCredits: number | null
  isPlaceholder: boolean; countsTowardTotal: boolean; minDomains?: number | null; noteZh: string; noteEn: string
}
type Rule = {
  cohortYear: number; totalCredits: number | null; totalCreditsConfirmed: boolean
  categories: Category[]
  thresholds: Condition[]
}

export function AdminRules() {
  const { t, locale } = useI18n()
  const confirm = useConfirm()
  const { busy, run } = useLock()
  const client = useQueryClient()
  const [cohort, setCohort] = useState<number | null>(null)
  const [section, setSection] = useState<'credits' | 'conditions'>('credits')
  const [editingYear, setEditingYear] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [conditionDrafts, setConditionDrafts] = useState<Record<number, boolean>>({})
  const [feedback, setFeedback] = useState<{ year: number; message: string; error?: boolean } | null>(null)
  const query = useQuery({ queryKey: ['rules'], queryFn: () => api<{ rules: Rule[] }>('/api/admin/rules') })
  useUnsaved(Object.keys(drafts).length > 0 || Object.values(conditionDrafts).some(Boolean))

  if (query.isLoading) return <PageSkeleton />
  if (query.isError || !query.data) return <LoadError pending={query.isFetching} onRetry={() => void query.refetch()} />
  const rules = query.data.rules.toSorted((a, b) => b.cohortYear - a.cohortYear)
  const rule = rules.find((item) => item.cohortYear === cohort) ?? rules[0]
  if (!rule) return <EmptyState>{t('noRules')}</EmptyState>

  const nameOf = (item: { nameZh: string; nameEn: string }) => locale === 'en' ? item.nameEn || item.nameZh : item.nameZh
  const numberLabel = (value: number | null) => value == null ? '—' : String(value)
  const changes = rule.categories.flatMap((item) => {
    const raw = drafts[item.id]
    if (raw === undefined) return []
    const valid = raw === '' || (/^\d+(?:\.\d+)?$/.test(raw) && Number.isFinite(Number(raw)))
    return [{ item, value: raw === '' ? null : Number(raw), valid }]
  })
  const editing = editingYear === rule.cohortYear || changes.length > 0

  function clearDrafts() {
    setDrafts((current) => {
      const next = { ...current }
      for (const { item } of changes) delete next[item.id]
      return next
    })
    setEditingYear(null)
  }

  return (
    <div className="space-y-4">
      <section className="card rules-header">
        <div className="rules-header-top">
          <label className="rules-cohort text-sm font-semibold">{t('cohort')}
            <select className="field w-full" value={rule.cohortYear} disabled={busy} onChange={(event) => setCohort(Number(event.target.value))}>
              {rules.map((item) => {
                const dirty = conditionDrafts[item.cohortYear] || item.categories.some((category) => drafts[category.id] !== undefined)
                return <option key={item.cohortYear} value={item.cohortYear}>{item.cohortYear}{dirty ? ` · ${t('ruleUnsaved')}` : ''}</option>
              })}
            </select>
          </label>
          {rule.totalCreditsConfirmed && rule.totalCredits != null && <dl className="rules-credit-total">
            <div><dt>{t('ruleTotalCredits')}</dt><dd>{rule.totalCredits} <span>{t('creditUnit')}</span></dd></div>
          </dl>}
        </div>
        <div className="rules-tabs" role="group" aria-label={t('rules')}>
          <button type="button" aria-pressed={section === 'credits'} aria-controls="rules-credits" disabled={busy} onClick={() => setSection('credits')}>
            <GraduationCap size={18} aria-hidden />{t('ruleCreditsTab')}
            {changes.length > 0 && <span className="rules-tab-draft">{t('ruleUnsaved')}</span>}
          </button>
          <button type="button" aria-pressed={section === 'conditions'} aria-controls="rules-conditions" disabled={busy} onClick={() => setSection('conditions')}>
            <ClipboardCheck size={17} aria-hidden />{t('graduationRequirements')}
            {conditionDrafts[rule.cohortYear] && <span className="rules-tab-draft">{t('ruleUnsaved')}</span>}
          </button>
        </div>
      </section>
      <div className="min-w-0">
        <form className="card" id="rules-credits" hidden={section !== 'credits'} onSubmit={(event) => {
          event.preventDefault()
          if (!changes.length || changes.some((change) => !change.valid)) return
          void run(async () => {
            const summary = changes.map(({ item, value }) => `${nameOf(item)}：${numberLabel(item.requiredCredits)} → ${numberLabel(value)}`).join('\n')
            if (!await confirm({ title: `${t('cohort')} ${rule.cohortYear} · ${t('saveRules')}`, body: `${t('confirmRules')}\n\n${summary}`, confirm: t('saveRules') })) return
            setFeedback(null)
            try {
              const categories = changes.map(({ item, value }) => ({
                id: item.id, requiredCredits: value, isPlaceholder: value === null, noteZh: item.noteZh, noteEn: item.noteEn,
              }))
              const result = await api<{ ok: boolean }>(`/api/admin/rules/${rule.cohortYear}`, { method: 'PATCH', body: { categories }, silent: true })
              if (result.ok !== true) throw new ApiError('SERVER')
              client.setQueryData<{ rules: Rule[] }>(['rules'], (current) => current && ({
                rules: current.rules.map((entry) => entry.cohortYear !== rule.cohortYear ? entry : {
                  ...entry, categories: entry.categories.map((item) => ({ ...item, ...categories.find((updated) => updated.id === item.id) })),
                }),
              }))
              clearDrafts()
              setFeedback({ year: rule.cohortYear, message: t('ruleSaved') })
              await client.invalidateQueries({ queryKey: ['rules'] })
            } catch (error) {
              setFeedback({ year: rule.cohortYear, message: errorMessage(error, locale, t('error')), error: true })
            }
          })
        }}>
          <header className="panel-heading flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="section-title">{t('creditBreakdown')}</h2>
                {editing && <p className="mt-1 text-sm text-muted">{t('ruleEditHint')}</p>}
            </div>
            {!editing && !!rule.categories.length && <button type="button" className="btn btn-ghost" onClick={() => { setFeedback(null); setEditingYear(rule.cohortYear) }}><Pencil size={16} aria-hidden />{t('ruleEdit')}</button>}
          </header>
          {!rule.categories.length && <EmptyState>{t('empty')}</EmptyState>}
          {rule.categories.map((item) => {
            const changed = changes.find((change) => change.item.id === item.id)
            const invalid = changed?.valid === false
            return (
              <div className="rule-credit-row" key={item.id}>
                <div>
                  <p className="font-bold">
                    {editing ? <label htmlFor={`credits-${item.id}`}>{nameOf(item)}</label> : nameOf(item)}
                    {changed && <span className="rule-pending ml-2">{t('ruleUnsaved')}</span>}
                  </p>
                  {item.countsTowardTotal === false && <p className="mt-1 text-xs font-semibold text-teal">{t('ruleNotAdded')}</p>}
                  {!!item.minDomains && <p className="mt-1 text-sm text-muted">{t('ruleMinDomains')} {item.minDomains}</p>}
                </div>
                {editing ? (
                  <div className="rule-credit-value">
                    <input id={`credits-${item.id}`} className="field w-full" inputMode="decimal"
                      disabled={busy} aria-invalid={invalid} aria-describedby={invalid ? `rule-error-${item.id}` : undefined}
                      value={drafts[item.id] ?? String(item.requiredCredits ?? '')}
                      onChange={(event) => {
                        const raw = event.target.value.trim()
                        setDrafts((current) => {
                          const next = { ...current }
                          if (raw === String(item.requiredCredits ?? '')) delete next[item.id]
                          else next[item.id] = raw
                          return next
                        })
                      }} />
                    {invalid && <p id={`rule-error-${item.id}`} className="login-error">{t('ruleInvalidCredits')}</p>}
                  </div>
                ) : (
                  <p className="rule-credit-value">
                    {item.requiredCredits == null || item.isPlaceholder ? '—' : <span className="text-lg font-bold tabular-nums">{item.requiredCredits} <span className="text-sm font-medium text-muted">{t('creditUnit')}</span></span>}
                  </p>
                )}
              </div>
            )
          })}
          {feedback?.year === rule.cohortYear && <p className={`mx-4 my-3 ${feedback.error ? 'login-result' : 'login-result login-result-success'}`} role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
          {editing && <footer className="rule-editor-footer">
            <span className="text-sm text-muted">{changes.length ? `${t('ruleUnsaved')} · ${changes.length}` : t('ruleNoChanges')}</span>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => run(async () => {
                if (changes.length && !await confirm({ title: t('ruleDiscard'), body: t('ruleDiscardConfirm'), confirm: t('ruleDiscard') })) return
                clearDrafts()
                setFeedback(null)
              })}>{t('cancel')}</button>
              <PendingButton className="btn btn-primary" type="submit" pending={busy} disabled={!changes.length || changes.some((change) => !change.valid)}>{t('saveRules')}</PendingButton>
            </div>
          </footer>}
        </form>
        <div id="rules-conditions" hidden={section !== 'conditions'}>
          {rules.map((entry) => (
            <div key={entry.cohortYear} hidden={entry.cohortYear !== rule.cohortYear}>
              <RuleConditions cohortYear={entry.cohortYear} conditions={entry.thresholds ?? []}
                onDirtyChange={(dirty) => setConditionDrafts((current) => ({ ...current, [entry.cohortYear]: dirty }))} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
