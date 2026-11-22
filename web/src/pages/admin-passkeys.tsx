import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useConfirm, useLock } from '../components/confirm'
import { LoadError, PageSkeleton, PendingButton } from '../components/feedback'
import { EmptyState } from '../components/shell'
import { api, errorMessage } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { passkeyError, registerPasskey, supportsPasskeys, type Passkey } from '../lib/passkeys'

type Settings = { keys: Passkey[]; origin: string | null }
const endpoint = '/api/auth/passkeys'
const queryKey = ['admin-passkeys']

export function AdminPasskeys() {
  const { t, locale } = useI18n()
  const confirm = useConfirm()
  const client = useQueryClient()
  const { busy, run } = useLock()
  const query = useQuery({ queryKey, queryFn: () => api<Settings>(endpoint, { silent: true }), retry: false })
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [action, setAction] = useState('')
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })

  if (query.isPending && query.isFetching) return <PageSkeleton />
  if (query.isError || !query.data) return <LoadError pending={query.isFetching} onRetry={() => void query.refetch()} />
  const { keys, origin } = query.data
  const correctOrigin = origin === window.location.origin
  const canRegister = correctOrigin && supportsPasskeys() && keys.length < 10

  function updateKeys(update: (keys: Passkey[]) => Passkey[]) {
    client.setQueryData<Settings>(queryKey, (settings) => settings && { ...settings, keys: update(settings.keys) })
  }

  return (
    <div className="space-y-4">
      {message && <p className={`login-result ${message.error ? '' : 'login-result-success'}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      {!correctOrigin && <div className="card space-y-3 p-4">
        <p role="alert" className="login-result">{t('passkeyOriginMismatch')}</p>
        {origin && <a className="btn btn-ghost" href={`${origin}/admin/security`}>{t('passkeyOpenOrigin')}</a>}
      </div>}
      {correctOrigin && !supportsPasskeys() && <p role="alert" className="login-result">{t('passkeyBrowserUnavailable')}</p>}
      <div className="workspace-columns">
        <section className="card self-start p-5">
          <h2 className="section-title">{t('passkeyAdd')}</h2>
          <p className="mt-2 text-sm text-muted">{t('passkeyRegisterHint')}</p>
          {keys.length >= 10 && <p role="alert" className="login-result mt-3">{t('passkeyLimit')}</p>}
          <form className="mt-4 space-y-4" onSubmit={(event) => {
            event.preventDefault()
            if (!canRegister || !name.trim() || !/^\d{6}$/.test(token)) return
            void run(async () => {
              setMessage(null)
              setAction('register')
              try {
                const key = await registerPasskey(token, name.trim())
                updateKeys((current) => [key, ...current.filter((item) => item.id !== key.id)])
                setName('')
                setToken('')
                setMessage({ text: t('passkeyAdded'), error: false })
              } catch (error) {
                setMessage({ text: passkeyError(error, locale, t('passkeyTryAgain'), t('passkeyInterrupted')), error: true })
              } finally {
                setAction('')
              }
            })
          }}>
            <fieldset disabled={busy || !canRegister} className="space-y-4">
              <label className="block text-sm font-semibold">
                {t('passkeyName')}
                <input className="field w-full" placeholder={t('passkeyNameExample')} required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="block text-sm font-semibold">
                {t('totp')}
                <input className="field w-full" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={token}
                  onChange={(event) => setToken(event.target.value.replace(/\D/g, '').slice(0, 6))} />
              </label>
              <PendingButton type="submit" className="btn btn-primary" pending={action === 'register'} disabled={!name.trim() || token.length !== 6}>
                <KeyRound size={17} aria-hidden />{t('passkeyAdd')}
              </PendingButton>
            </fieldset>
          </form>
        </section>
        <section className="card min-w-0">
          <h2 className="section-title panel-heading">{t('passkeyRegistered')}</h2>
          {keys.length === 0 ? <EmptyState>{t('passkeyEmpty')}</EmptyState> : (
            <ul>
              {keys.map((key) => (
                <li className="advisor-item flex flex-wrap items-center justify-between gap-3" key={key.id}>
                  <div className="min-w-0 break-words">
                    <p className="font-semibold">{key.name}</p>
                    <p className="mt-1 text-sm text-muted">{t('passkeyCreated')} <time dateTime={key.createdAt}>{date.format(new Date(key.createdAt))}</time></p>
                    {key.lastUsedAt && <p className="text-sm text-muted">{t('passkeyLastUsed')} <time dateTime={key.lastUsedAt}>{date.format(new Date(key.lastUsedAt))}</time></p>}
                  </div>
                  <PendingButton type="button" className="btn btn-ghost" pending={action === key.id} disabled={busy || !correctOrigin}
                    aria-label={`${t('passkeyRemove')} ${key.name}`} onClick={() => void run(async () => {
                      if (!await confirm({ title: t('passkeyRemove'), body: key.name, confirm: t('passkeyRemove'), danger: true })) return
                      setMessage(null)
                      setAction(key.id)
                      try {
                        await api(`${endpoint}/${encodeURIComponent(key.id)}`, { method: 'DELETE', silent: true })
                        updateKeys((current) => current.filter((item) => item.id !== key.id))
                        setMessage({ text: t('passkeyRemoved'), error: false })
                      } catch (error) {
                        setMessage({ text: errorMessage(error, locale, t('error')), error: true })
                      } finally {
                        setAction('')
                      }
                    })}>
                    <Trash2 size={16} aria-hidden />{t('passkeyRemove')}
                  </PendingButton>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
