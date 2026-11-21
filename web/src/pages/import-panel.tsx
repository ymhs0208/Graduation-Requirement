import { useRef, useState } from 'react'
import { useLock, useUnsaved } from '../components/confirm'
import { PendingLabel, StepStatus, UploadProgress } from '../components/feedback'
import { api, errorMessage } from '../lib/api'
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
  valid: 'bg-[#e7f6ee]',
  error: 'bg-[#fdeceb]',
  duplicate: 'bg-[#fff4dc]',
  conflict: 'bg-[#e7f3fa]',
}

async function download(path: string, filename: string) {
  const response = await fetch(path, { credentials: 'include' })
  if (!response.ok) return
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function ImportPanel() {
  const { t, locale } = useI18n()
  const { busy, run } = useLock()
  const [kind, setKind] = useState<Kind>('accounts')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [conflict, setConflict] = useState<'skip' | 'update'>('skip')
  const [message, setMessage] = useState('')
  const [passwords, setPasswords] = useState<{ account: string; tempPassword: string }[]>([])
  const [percent, setPercent] = useState<number | null>(null)
  const [commitStep, setCommitStep] = useState(-1)
  const uploadAbort = useRef<AbortController | null>(null)
  useUnsaved(Boolean(preview || percent !== null))
  const fileNote = !file ? t('importNeedCsv') : !file.name.toLowerCase().endsWith('.csv') ? t('importCsvType') : file.size > 500_000 ? t('importCsvSize') : ''
  const writable = (preview?.counts.valid ?? 0) + (conflict === 'update' ? preview?.counts.conflict ?? 0 : 0)
  const commitDisabled = busy || !preview || writable === 0
  return (
    <section className="card space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="text-lg font-bold">{t('importTitle')}</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{t('importHint')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(['accounts', 'credits'] as const).map((item) => (
          <button key={item} className={`btn ${kind === item ? 'btn-ink' : 'btn-ghost'}`} type="button" aria-pressed={kind === item} onClick={() => { setKind(item); setPreview(null); setPasswords([]) }}>
            {item === 'accounts' ? t('importKindAccounts') : t('importKindCredits')}
          </button>
        ))}
        <button className="btn btn-ghost" type="button" onClick={() => download(`/api/admin/import/template?kind=${kind}`, `${kind}-template.csv`)}>
          {t('importTemplate')}
        </button>
      </div>
      <label className="block text-sm font-medium">
        CSV
        <input
          className="field w-full"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setPreview(null)
            setPasswords([])
            setMessage('')
          }}
        />
      </label>
      {fileNote && <p className="text-sm font-medium text-[#9b1c16]">{fileNote}</p>}
      <button
        className="btn btn-primary"
        type="button"
        disabled={busy || Boolean(fileNote)}
        title={fileNote || undefined}
        onClick={() =>
          run(async () => {
            if (!file || fileNote) return
            setMessage('')
            setPasswords([])
            const form = new FormData()
            form.set('kind', kind)
            form.set('file', file)
            const controller = new AbortController()
            uploadAbort.current = controller
            setPercent(0)
            try {
              setPreview(await api<Preview>('/api/admin/import/preview', { method: 'POST', form, onProgress: setPercent, signal: controller.signal }))
            } catch (error) {
              setPreview(null)
              setMessage(errorMessage(error, locale, t('error')))
            } finally {
              uploadAbort.current = null
              setPercent(null)
            }
          })
        }
      >
        <PendingLabel pending={busy && percent !== null}>{t('importPreview')}</PendingLabel>
      </button>
      {percent !== null && <UploadProgress percent={percent} onCancel={() => uploadAbort.current?.abort()} />}
      {preview && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-[#e7f6ee] px-3 py-1 font-semibold text-[#08663a]">{t('importValid')} {preview.counts.valid}</span>
            <span className="rounded-full bg-[#fdeceb] px-3 py-1 font-semibold text-[#9b1c16]">{t('importError')} {preview.counts.error}</span>
            <span className="rounded-full bg-[#fff4dc] px-3 py-1 font-semibold text-[#7a4e00]">{t('importDuplicate')} {preview.counts.duplicate}</span>
            <span className="rounded-full bg-[#e7f3fa] px-3 py-1 font-semibold text-[#0f5f8a]">{t('importConflict')} {preview.counts.conflict}</span>
            <span className="rounded-full bg-[#eef5f1] px-3 py-1 text-muted">{t('importEncoding')} {preview.encoding}</span>
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
              className="btn btn-primary"
              type="button"
              disabled={commitDisabled}
              title={writable === 0 ? t('importNoValid') : undefined}
              onClick={() =>
                run(async () => {
                  if (commitDisabled || !preview) return
                  setMessage('')
                  setCommitStep(0)
                  try {
                    setCommitStep(1)
                    const result = await api<{ committed: number; updated: number; skipped: number; activations?: { account: string; tempPassword: string }[] }>('/api/admin/import/commit', {
                      method: 'POST',
                      body: { previewId: preview.previewId, conflict, confirm: true },
                      timeout: 120000,
                      success: t('importDone'),
                    })
                    setCommitStep(2)
                    setPasswords(result.activations ?? [])
                    setMessage(`${t('importResult')} ${result.committed} / ${result.updated} / ${result.skipped}`)
                    setPreview(null)
                    setFile(null)
                  } catch (error) {
                    setMessage(errorMessage(error, locale, t('error')))
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
      {message && <p className="text-sm font-medium">{message}</p>}
      {passwords.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-[#fff4dc] px-3 py-2 text-sm text-[#7a4e00]">
          {passwords.map((item) => (
            <li key={item.account}>{item.account}：{item.tempPassword}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
