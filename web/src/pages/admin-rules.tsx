import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useConfirm, useLock, useUnsaved } from '../components/confirm'
import { PageSkeleton, PendingButton } from '../components/feedback'
import { EmptyState } from '../components/shell'
import { api, errorMessage } from '../lib/api'
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
  const [editingYear, setEditingYear] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [conditionDrafts, setConditionDrafts] = useState<Record<number, boolean>>({})
  const [feedback, setFeedback] = useState<{ year: number; message: string; error?: boolean } | null>(null)
  const query = useQuery({ queryKey: ['rules'], queryFn: () => api<{ rules: Rule[] }>('/api/admin/rules') })
  useUnsaved(Object.keys(drafts).length > 0 || Object.values(conditionDrafts).some(Boolean))

  if (query.isLoading) return <PageSkeleton />
  if (!query.data) return (
    <div className="card p-4">
      <p role="alert">{t('loadFailed')}</p>
      <button type="button" className="btn btn-ghost mt-3" onClick={() => void query.refetch()}>{t('tryAgain')}</button>
    </div>
  )
  const rules = query.data.rules.toSorted((a, b) => b.cohortYear - a.cohortYear)
  const rule = rules.find((item) => item.cohortYear === cohort) ?? rules[0]
  if (!rule) return <EmptyState>{t('noRules')}</EmptyState>

  const nameOf = (item: { nameZh: string; nameEn: string }) => locale === 'en' ? item.nameEn : item.nameZh
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
    <div className="rules-layout">
      <aside className="card rule-cohorts">
        <h2 className="section-title">{t('cohort')}</h2>
        <div className="rule-year-list" role="group" aria-label={t('cohort')}>
          {rules.map((item) => (
            <button key={item.cohortYear} type="button" className="rule-year"
              aria-pressed={item.cohortYear === rule.cohortYear} aria-controls="cohort-rules" disabled={busy}
              onClick={() => { setCohort(item.cohortYear); setEditingYear(null) }}>
              <span>{item.cohortYear}</span>
              {(conditionDrafts[item.cohortYear] || item.categories.some((category) => drafts[category.id] !== undefined)) && <span className="rule-draft-label">{t('ruleUnsaved')}</span>}
            </button>
          ))}
        </div>
      </aside>
      <div id="cohort-rules" className="min-w-0 space-y-4">
        <section className="card rule-summary">
          <div>
            <h2 className="text-2xl font-bold">{t('cohort')} {rule.cohortYear}</h2>
          </div>
          {rule.totalCreditsConfirmed && rule.totalCredits != null && <dl className="rule-metrics">
            <div><dt>{t('ruleTotalCredits')}</dt><dd>{rule.totalCredits} <span className="text-sm font-medium text-muted">{t('creditUnit')}</span></dd></div>
          </dl>}
        </section>
        <form className="card" onSubmit={(event) => {
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
              await api(`/api/admin/rules/${rule.cohortYear}`, { method: 'PATCH', body: { categories }, silent: true })
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
        {rules.map((entry) => (
          <div key={entry.cohortYear} hidden={entry.cohortYear !== rule.cohortYear}>
            <RuleConditions cohortYear={entry.cohortYear} conditions={entry.thresholds ?? []}
              onDirtyChange={(dirty) => setConditionDrafts((current) => ({ ...current, [entry.cohortYear]: dirty }))} />
          </div>
        ))}
      </div>
    </div>
  )
}
