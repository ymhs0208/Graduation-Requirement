import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'
import { useLock, useUnsaved } from '../components/confirm'
import { PendingLabel, StepStatus, UploadProgress } from '../components/feedback'
import { ApiError, api, downloadCsv, errorMessage } from '../lib/api'
import { useI18n } from '../lib/i18n'

type Kind = 'accounts' | 'credits'
type Status = 'valid' | 'error' | 'duplicate' | 'conflict'
type Preview = {
  previewId: string
  kind: Kind
  encoding: string
  counts: { valid: number; error: number; duplicate: number; conflict: number }
  rows: { line: number; status: Status; errors: { code: string; zh: string; en: string }[]; fields: Record<string, string> }[]
}

const tone: Record<Status, string> = {
  valid: 'bg-[#e5f6ee]',
  error: 'bg-[#fdecee]',
  duplicate: 'bg-[#fff6e0]',
  conflict: 'bg-[#e8eef6]',
}

export function ImportPanel() {
  const { t, locale } = useI18n()
  const { busy, run } = useLock()
  const client = useQueryClient()
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [kind, setKind] = useState<Kind>('accounts')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [conflict, setConflict] = useState<'skip' | 'update'>('skip')
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [passwords, setPasswords] = useState<{ account: string; tempPassword: string }[]>([])
  const [percent, setPercent] = useState<number | null>(null)
  const [commitStep, setCommitStep] = useState(-1)
  const uploadAbort = useRef<AbortController | null>(null)
  useUnsaved(Boolean(preview || percent !== null))
  const fileNote = !file ? t('importNeedCsv') : !file.name.toLowerCase().endsWith('.csv') ? t('importCsvType') : file.size > 500_000 ? t('importCsvSize') : ''
  const writable = (preview?.counts.valid ?? 0) + (conflict === 'update' ? preview?.counts.conflict ?? 0 : 0)
  const commitDisabled = busy || !preview || writable === 0
  async function download(path: string, filename: string) {
    setMessage(null)
    try {
      await downloadCsv(path, filename)
    } catch (error) {
      setMessage({ text: errorMessage(error, locale, t('exportFailed')), error: true })
    }
  }
  return (
    <section className="card" aria-labelledby="accounts-import-title">
      <header className="directory-panel-heading directory-heading-copy">
        <span className="directory-icon"><FileUp size={20} aria-hidden /></span>
        <div>
          <h2 id="accounts-import-title" className="section-title">{t('importTitle')}</h2>
          <p className="mt-1 text-sm text-muted">{t('importPreviewNote')}</p>
        </div>
      </header>
      <div className="directory-import-body">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-2 text-sm font-semibold">{t('importPickType')}</legend>
          {(['accounts', 'credits'] as const).map((item) => (
            <button key={item} className={`btn ${kind === item ? 'btn-ink' : 'btn-ghost'}`} type="button" disabled={busy} aria-pressed={kind === item} onClick={() => {
              if (kind === item) return
              setKind(item)
              setPreview(null)
              setFile(null)
              setConflict('skip')
              setPasswords([])
              setMessage(null)
              if (fileInput.current) fileInput.current.value = ''
            }}>
              {item === 'accounts' ? t('importKindAccounts') : t('importKindCredits')}
            </button>
          ))}
          <button className="btn btn-ghost" type="button" onClick={() => download(`/api/admin/import/template?kind=${kind}`, `${kind}-template.csv`)}>
            {t('importTemplate')}
          </button>
        </fieldset>
        <label className="directory-import-file block text-sm font-medium">
          {t('importPickFile')}
          <input
            className="field w-full"
            ref={fileInput}
            disabled={busy}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              setPreview(null)
              setConflict('skip')
              setPasswords([])
              setMessage(null)
            }}
          />
        </label>
        {fileNote && <p className={`text-sm ${file ? 'font-medium text-[#9e1d22]' : 'text-muted'}`}>{fileNote}</p>}
        <button
          className="btn btn-primary directory-primary justify-self-start"
          type="button"
          disabled={busy || Boolean(fileNote)}
          title={fileNote || undefined}
          onClick={() =>
            run(async () => {
              if (!file || fileNote) return
              setMessage(null)
              setPasswords([])
              const form = new FormData()
              form.set('kind', kind)
              form.set('file', file)
              const controller = new AbortController()
              uploadAbort.current = controller
              setPercent(0)
              try {
                const result = await api<Preview>('/api/admin/import/preview', { method: 'POST', form, onProgress: setPercent, signal: controller.signal, silent: true })
                if (!result.previewId || !result.counts || !Array.isArray(result.rows)) throw new ApiError('SERVER')
                setPreview(result)
              } catch (error) {
                setPreview(null)
                setMessage({ text: errorMessage(error, locale, t('error')), error: true })
              } finally {
                uploadAbort.current = null
                setPercent(null)
              }
            })
          }
        >
          <PendingLabel pending={busy && percent !== null}>{t('importCheckFile')}</PendingLabel>
        </button>
        {percent !== null && <UploadProgress percent={percent} onCancel={() => uploadAbort.current?.abort()} />}
        {preview && (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-[#e5f6ee] px-3 py-1 font-semibold text-[#0d6b45]">{t('importValid')} {preview.counts.valid}</span>
              <span className="rounded-full bg-[#fdecee] px-3 py-1 font-semibold text-[#9e1d22]">{t('importError')} {preview.counts.error}</span>
              <span className="rounded-full bg-[#fff6e0] px-3 py-1 font-semibold text-[#8a5600]">{t('importDuplicate')} {preview.counts.duplicate}</span>
              <span className="rounded-full bg-[#e8eef6] px-3 py-1 font-semibold text-[#314e78]">{t('importConflict')} {preview.counts.conflict}</span>
              <span className="rounded-full bg-[#eef1f6] px-3 py-1 text-muted">{t('importEncoding')} {preview.encoding}</span>
            </div>
            <div className="overflow-auto rounded-xl border border-line">
              <table className="data-table">
                <caption className="sr-only">{t('importTitle')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('line')}</th>
                    <th scope="col">{locale === 'en' ? 'Status' : '狀態'}</th>
                    <th scope="col">{locale === 'en' ? 'Details' : '說明'}</th>
                    <th scope="col">{t('account')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.line} className={tone[row.status]}>
                      <td>{row.line}</td>
                      <td className="font-semibold">{row.status === 'valid' ? t('importValid') : row.status === 'error' ? t('importError') : row.status === 'duplicate' ? t('importDuplicate') : t('importConflict')}</td>
                      <td>{row.errors.map((item) => (locale === 'en' ? item.en : item.zh)).join('；') || '—'}</td>
                      <td>{row.fields.account || row.fields.courseNameZh || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">{t('importConflict')}</legend>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="conflict" checked={conflict === 'skip'} onChange={() => setConflict('skip')} />
                {t('importSkip')}
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="conflict" checked={conflict === 'update'} onChange={() => setConflict('update')} />
                {t('importUpdate')}
              </label>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-primary directory-primary"
                type="button"
                disabled={commitDisabled}
                title={writable === 0 ? t('importNoValid') : undefined}
                onClick={() =>
                  run(async () => {
                    if (commitDisabled || !preview) return
                    setMessage(null)
                    setCommitStep(0)
                    try {
                      setCommitStep(1)
                      const result = await api<{ committed: number; updated: number; skipped: number; activations?: { account: string; tempPassword: string }[]; activationFailures?: string[] }>('/api/admin/import/commit', {
                        method: 'POST',
                        body: { previewId: preview.previewId, conflict, confirm: true },
                        timeout: 120000,
                        silent: true,
                      })
                      if (![result.committed, result.updated, result.skipped].every(Number.isInteger)) throw new ApiError('SERVER')
                      setCommitStep(2)
                      setPasswords(result.activations ?? [])
                      const counts = `${t('importResult')} ${result.committed} / ${result.updated} / ${result.skipped}`
                      const failures = result.activationFailures ?? []
                      setMessage(failures.length
                        ? { text: `${counts}。 ${t('importActivationFailed')} ${failures.join('、')}`, error: true }
                        : { text: counts, error: false })
                      setPreview(null)
                      setFile(null)
                      if (fileInput.current) fileInput.current.value = ''
                      if (kind === 'accounts') await client.invalidateQueries({ queryKey: ['users'] })
                    } catch (error) {
                      setCommitStep(-1)
                      const code = error instanceof ApiError ? error.code : ''
                      const text = ['OFFLINE', 'TIMEOUT', 'SERVER'].includes(code) ? t('importUnconfirmed') : errorMessage(error, locale, t('error'))
                      setMessage({ text, error: true })
                    } finally {
                      window.setTimeout(() => setCommitStep(-1), 1200)
                    }
                  })
                }
              >
                <PendingLabel pending={busy && commitStep >= 0}>{t('importCommit')}</PendingLabel>
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={preview.counts.error + preview.counts.duplicate === 0}
                title={preview.counts.error + preview.counts.duplicate === 0 ? t('empty') : undefined}
                onClick={() => download(`/api/admin/import/${preview.previewId}/errors`, 'import-errors.csv')}
              >
                {t('importErrors')}
              </button>
            </div>
            {commitStep >= 0 && <StepStatus steps={[t('stepCheck'), t('stepWrite'), t('stepDone')]} current={commitStep} />}
            {commitDisabled && preview && writable === 0 && <p className="text-sm text-muted">{t('importNoValid')}</p>}
          </>
        )}
        {message && <p role={message.error ? 'alert' : 'status'} className={`login-result ${message.error ? '' : 'login-result-success'}`}>{message.text}</p>}
        {passwords.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-[#fff6e0] px-3 py-2 text-sm text-[#8a5600]">
            {passwords.map((item) => (
              <li key={item.account}>{item.account}：{item.tempPassword}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
