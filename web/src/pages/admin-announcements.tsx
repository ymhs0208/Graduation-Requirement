import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import { useRef, useState } from 'react'
import { useConfirm, useLock, useUnsaved } from '../components/confirm'
import { PageSkeleton, PendingButton } from '../components/feedback'
import { EmptyState } from '../components/shell'
import { api, errorMessage } from '../lib/api'
import { useI18n } from '../lib/i18n'

const audiences = { ALL: 'announcementEveryone', STUDENT: 'announcementStudents', TEACHER: 'announcementTeachers' } as const
type Audience = keyof typeof audiences
const initialDraft = { audience: '' as Audience | '', titleZh: '', bodyZh: '', titleEn: '', bodyEn: '' }
type Announcement = Omit<typeof initialDraft, 'audience'> & { id: string; createdAt: string; audience: Audience; recipientCount: number }

export function AdminAnnouncements() {
  const { t, locale } = useI18n()
  const confirm = useConfirm()
  const { busy, run } = useLock()
  const client = useQueryClient()
  const [draft, setDraft] = useState(initialDraft)
  const [message, setMessage] = useState('')
  const [published, setPublished] = useState<number | null>(null)
  const requestId = useRef<string | null>(null)
  useUnsaved(Boolean(draft.titleZh || draft.bodyZh || draft.titleEn || draft.bodyEn))
  const history = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api<{ announcements: Announcement[] }>('/api/admin/announcements'),
  })

  function update<K extends keyof typeof draft>(field: K, value: (typeof draft)[K]) {
    requestId.current = null
    setDraft((current) => ({ ...current, [field]: value }))
    setPublished(null)
  }

  return (
    <div className="workspace-columns">
      <section className="card p-4 sm:p-6">
        <h2 className="section-title">{t('announcementCompose')}</h2>
        <p className="mt-1 text-sm text-muted">{t('announcementInboxOnly')}</p>
        <form className="mt-4 space-y-4" onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            setMessage('')
            const { audience } = draft
            if (!audience || !draft.titleZh.trim() || !draft.bodyZh.trim()) {
              setMessage(t('announcementRequired'))
              return
            }
            const body = [t('announcementConfirmBody'), `${t('announcementAudience')}：${t(audiences[audience])}`, `${t('announcementTitle')}：${draft.titleZh.trim()}`].join('\n')
            if (!await confirm({ title: t('announcementConfirm'), body, confirm: t('announcementPublish') })) return
            try {
              const id = requestId.current ?? crypto.randomUUID()
              requestId.current = id
              const { announcement } = await api<{ announcement: Announcement }>('/api/admin/announcements', {
                method: 'POST', body: { ...draft, requestId: id }, timeout: 35000, silent: true,
              })
              requestId.current = null
              setDraft(initialDraft)
              setPublished(announcement.recipientCount)
              client.setQueryData<{ announcements: Announcement[] }>(['announcements'], (current) => ({
                announcements: [announcement, ...(current?.announcements ?? []).filter((entry) => entry.id !== announcement.id)].slice(0, 50),
              }))
              await client.invalidateQueries({ queryKey: ['announcements'] })
            } catch (error) {
              setMessage(errorMessage(error, locale, t('error')))
            }
          })
        }}>
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            <label className="block text-sm font-semibold">{t('announcementAudience')}
              <select className="field w-full" required value={draft.audience} onChange={(event) => update('audience', event.target.value as Audience | '')}>
                <option value="" disabled>{t('announcementChooseAudience')}</option>
                {Object.entries(audiences).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold">{t('announcementTitle')}
              <input className="field w-full" required maxLength={120} value={draft.titleZh} onChange={(event) => update('titleZh', event.target.value)} />
            </label>
            <label className="block text-sm font-semibold">{t('announcementBody')}
              <textarea className="field w-full" required rows={5} maxLength={4000} value={draft.bodyZh} onChange={(event) => update('bodyZh', event.target.value)} />
            </label>
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-teal">{t('conditionEnglish')}</summary>
              <div className="mt-3 space-y-3">
                <label className="block text-sm font-semibold">{t('announcementEnglishTitle')}
                  <input className="field w-full" maxLength={120} value={draft.titleEn} onChange={(event) => update('titleEn', event.target.value)} />
                </label>
                <label className="block text-sm font-semibold">{t('announcementEnglishBody')}
                  <textarea className="field w-full" maxLength={4000} value={draft.bodyEn} onChange={(event) => update('bodyEn', event.target.value)} />
                </label>
              </div>
            </details>
          </fieldset>
          {message && <p className="login-result" role="alert">{message}</p>}
          {published != null && <p className="login-result login-result-success" role="status">{t('announcementPublished')} · {published} {t('announcementRecipients')}</p>}
          <PendingButton type="submit" className="btn btn-primary" pending={busy}>{t('announcementConfirm')}</PendingButton>
        </form>
      </section>
      <section className="card">
        <h2 className="panel-heading section-title">{t('announcementHistory')}</h2>
        {history.isLoading ? <div className="p-4"><PageSkeleton /></div> : history.isError ? (
          <div className="p-4">
            <p role="alert" className="login-result">{t('loadFailed')}</p>
            <button type="button" className="btn btn-ghost mt-2" onClick={() => void history.refetch()}>{t('tryAgain')}</button>
          </div>
        ) : history.data?.announcements.length ? (
          <div>
            {history.data.announcements.map((item) => (
              <details key={item.id} className="border-t border-line px-4 py-3 sm:px-5">
                <summary className="cursor-pointer break-words font-bold text-pine">{(locale === 'en' && item.titleEn) || item.titleZh}</summary>
                <p className="mt-2 text-xs text-muted">
                  <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(locale)}</time> · {t(audiences[item.audience])} · {item.recipientCount} {t('announcementRecipients')}
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{(locale === 'en' && item.bodyEn) || item.bodyZh}</p>
              </details>
            ))}
          </div>
        ) : <EmptyState>{t('announcementEmpty')}</EmptyState>}
      </section>
    </div>
  )
}
