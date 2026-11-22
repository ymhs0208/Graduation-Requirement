import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CalendarDays, ChevronDown, ClipboardCheck, Megaphone } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLock } from '../components/confirm'
import { LoadError, PendingButton, TableSkeleton } from '../components/feedback'
import { EmptyState } from '../components/shell'
import { ApiError, api, errorMessage } from '../lib/api'
import { useI18n } from '../lib/i18n'

type Notice = {
  id: string; kind: string; titleZh: string; titleEn: string; bodyZh: string; bodyEn: string
  readAt: string | null; createdAt: string
}
type Inbox = { notifications: Notice[] }
const queryKey = ['notes']
const filters = [
  ['all', 'inboxAll', 'inboxEmpty'],
  ['unread', 'inboxUnread', 'inboxEmptyUnread'],
  ['announcement', 'announcementBadge', 'inboxEmptyAnnouncements'],
] as const

function category(kind: string) {
  if (kind === 'announcement') return { Icon: Megaphone, label: 'announcementBadge' } as const
  if (kind.startsWith('review.')) return { Icon: ClipboardCheck, label: 'inboxReview' } as const
  if (kind.startsWith('deadline:') || kind.startsWith('preaudit')) return { Icon: CalendarDays, label: 'inboxReminder' } as const
  return { Icon: Bell, label: 'inboxSystem' } as const
}

export function NotificationsPage({ canPublish }: { canPublish: boolean }) {
  const { t, locale } = useI18n()
  const client = useQueryClient()
  const { busy, run } = useLock()
  const [filter, setFilter] = useState<(typeof filters)[number][0]>('all')
  const [marking, setMarking] = useState('')
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null)
  const unreadFilter = useRef<HTMLButtonElement>(null)
  const query = useQuery({
    queryKey,
    queryFn: () => api<Inbox>('/api/inbox', { silent: true }),
  })

  if (query.isLoading) return <TableSkeleton />
  if (query.isError || !query.data) return <LoadError pending={query.isFetching} onRetry={() => void query.refetch()} />

  const { notifications } = query.data
  const unreadCount = notifications.filter((notice) => !notice.readAt).length
  const visible = notifications.filter((notice) => filter === 'all' || (filter === 'unread' ? !notice.readAt : notice.kind === 'announcement'))
  const empty = filters.find(([value]) => value === filter)![2]
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Asia/Taipei' })

  function markRead(id: string, button: HTMLButtonElement) {
    const startedWithFocus = document.activeElement === button
    void run(async () => {
      setFailure(null)
      setMarking(id)
      try {
        const result = await api<{ readAt: string }>('/api/inbox/read', { body: { id }, silent: true })
        if (!Number.isFinite(Date.parse(result.readAt))) throw new ApiError('SERVER')
        await client.cancelQueries({ queryKey })
        const focusTarget = filter === 'unread' ? unreadFilter.current : button.closest('details')?.querySelector('summary')
        const restoreFocus = startedWithFocus && (document.activeElement === button || document.activeElement === document.body)
        client.setQueryData<Inbox>(queryKey, (current) => current && {
          notifications: current.notifications.map((notice) => notice.id === id ? { ...notice, readAt: result.readAt } : notice),
        })
        if (restoreFocus) requestAnimationFrame(() => focusTarget?.focus())
      } catch (error) {
        setFailure({ id, message: errorMessage(error, locale, t('inboxMarkFailed')) })
      } finally {
        setMarking('')
      }
    })
  }

  return (
    <section className="card inbox" aria-label={t('notifications')}>
      <div className="inbox-toolbar">
        <div className="inbox-filters" role="group" aria-label={t('inboxFilter')}>
          {filters.map(([value, label]) => (
            <button type="button" key={value} ref={value === 'unread' ? unreadFilter : undefined} aria-pressed={filter === value}
              onClick={() => setFilter(value)}>
              {t(label)}{value === 'unread' && <span className="inbox-count">{unreadCount}</span>}
            </button>
          ))}
        </div>
        {canPublish && <Link className="btn btn-primary" to="/admin/announcements"><Megaphone size={17} aria-hidden />{t('announcementCompose')}</Link>}
      </div>
      {visible.length === 0 ? <EmptyState>{t(empty)}</EmptyState> : (
        <ul className="inbox-list">
          {visible.map((notice) => {
            const { Icon, label } = category(notice.kind)
            const title = locale === 'en' ? notice.titleEn || notice.titleZh : notice.titleZh
            const body = locale === 'en' ? notice.bodyEn || notice.bodyZh : notice.bodyZh
            return (
              <li key={notice.id}>
                <details className="inbox-notice" data-unread={!notice.readAt}>
                  <summary className="inbox-summary">
                    <span className="inbox-icon" aria-hidden="true"><Icon size={19} /></span>
                    <span className="inbox-subject">
                      <span className="inbox-category">
                        {t(label)}{!notice.readAt && <span className="inbox-unread">{t('inboxUnread')}</span>}
                      </span>
                      <span className="inbox-title">{title}</span>
                    </span>
                    <time className="inbox-date" dateTime={notice.createdAt}>{date.format(new Date(notice.createdAt))}</time>
                    <ChevronDown className="inbox-chevron" size={17} aria-hidden />
                  </summary>
                  <div className="inbox-content">
                    <p className="inbox-body">{body}</p>
                    {failure?.id === notice.id && <p className="login-result mt-2" role="alert">{failure.message}</p>}
                    {!notice.readAt && <PendingButton type="button" className="btn btn-ghost" pending={marking === notice.id} disabled={busy}
                      onClick={(event) => markRead(notice.id, event.currentTarget)}>{t('inboxMarkRead')}</PendingButton>}
                  </div>
                </details>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
