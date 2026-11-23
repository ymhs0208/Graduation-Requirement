import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import { ActionDialog } from './action-dialog'

type ConfirmOptions = { title: string; body: string; confirm: string; danger?: boolean }
type Ask = ConfirmOptions & { trigger: HTMLElement | null; resolve: (value: boolean) => void }

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [ask, setAsk] = useState<Ask | null>(null)
  const current = useRef<Ask | null>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)

  function confirm(options: ConfirmOptions) {
    if (current.current) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const request = { ...options, trigger, resolve }
      current.current = request
      setAsk(request)
    })
  }

  function close(accepted: boolean) {
    const request = current.current
    current.current = null
    setAsk(null)
    request?.resolve(accepted)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {ask && (
        <ActionDialog title={ask.title} description={ask.body} onDismiss={() => close(false)} initialFocus={cancelButton}
          trigger={ask.trigger} compact showClose={false}>
          <div className="action-dialog-actions">
            <button ref={cancelButton} className="btn btn-ghost" type="button" onClick={() => close(false)}>{t('cancel')}</button>
            <button className={`btn ${ask.danger ? 'btn-miss' : 'btn-primary'}`} type="button" onClick={() => close(true)}>{ask.confirm}</button>
          </div>
        </ActionDialog>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  return useContext(ConfirmContext)
}

export function useUnsaved(dirty: boolean) {
  const { t } = useI18n()
  useEffect(() => {
    if (!dirty) return
    const message = t('unsaved')
    const onBefore = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = message
    }
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest('a')
      if (!anchor) return
      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBefore)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBefore)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty, t])
}

export function useLock() {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  async function run(task: () => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      await task()
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return { busy, run }
}
