import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'

type Ask = { title: string; body: string; confirm: string; danger?: boolean; resolve: (value: boolean) => void }

const ConfirmContext = createContext<(options: Omit<Ask, 'resolve'>) => Promise<boolean>>(async () => false)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [ask, setAsk] = useState<Ask | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const confirm = (options: Omit<Ask, 'resolve'>) => new Promise<boolean>((resolve) => setAsk({ ...options, resolve }))
  const close = (accepted: boolean) => {
    ask?.resolve(accepted)
    setAsk(null)
  }
  useEffect(() => {
    if (!ask) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])]
    focusable()[0]?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(false)
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      returnFocus.current?.focus()
    }
  }, [ask])
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {ask && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-pine/40 p-4" role="presentation">
          <div
            ref={panelRef}
            className="card w-full max-w-md space-y-3 p-5"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-body"
          >
            <h2 id="confirm-title" className="text-lg font-bold">{ask.title}</h2>
            <p id="confirm-body" className="max-h-[55svh] overflow-auto whitespace-pre-line text-sm leading-6">{ask.body}</p>
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" type="button" onClick={() => close(false)}>
                {t('cancel')}
              </button>
              <button className={`btn ${ask.danger ? 'btn-miss' : 'btn-primary'}`} type="button" onClick={() => close(true)}>
                {ask.confirm}
              </button>
            </div>
          </div>
        </div>
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
