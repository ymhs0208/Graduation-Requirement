import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useRef, type ReactNode, type RefObject } from 'react'
import { useI18n } from '../lib/i18n'

export function ActionDialog({
  title, description, children, onDismiss, busy = false, compact = false,
  initialFocus, trigger, triggerRef, fallbackFocus, showClose = true,
}: {
  title: string
  description?: string
  children: ReactNode
  onDismiss: () => void
  busy?: boolean
  compact?: boolean
  initialFocus?: RefObject<HTMLElement | null>
  trigger?: HTMLElement | null
  triggerRef?: RefObject<HTMLElement | null>
  fallbackFocus?: RefObject<HTMLElement | null>
  showClose?: boolean
}) {
  const { t } = useI18n()
  const previousFocus = useRef<HTMLElement | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onDismiss() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="action-dialog-overlay" />
        <Dialog.Content
          className="action-dialog"
          data-compact={compact}
          aria-modal="true"
          {...(!description && { 'aria-describedby': undefined })}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !(event.target instanceof Element) ||
              event.target.closest('.action-dialog') !== event.currentTarget) return
            event.preventDefault()
            event.stopPropagation()
            if (!busy && !event.repeat) onDismiss()
          }}
          onOpenAutoFocus={(event) => {
            previousFocus.current = trigger ?? triggerRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
            event.preventDefault()
            const target = initialFocus?.current ?? heading.current
            target?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = previousFocus.current
            if (target?.isConnected && !target.matches(':disabled')) target.focus({ preventScroll: true })
            else {
              const fallback = fallbackFocus?.current ?? target?.closest('.action-dialog')?.querySelector<HTMLElement>('h2')
              if (fallback?.isConnected) fallback.focus({ preventScroll: true })
            }
          }}
        >
          <header className="action-dialog-heading">
            <div>
              <Dialog.Title ref={heading} tabIndex={-1} className="section-title">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-1 whitespace-pre-line text-sm text-muted">{description}</Dialog.Description>}
            </div>
            {showClose && <Dialog.Close className="action-dialog-close" type="button" aria-label={t('dialogClose')} disabled={busy}><X size={20} aria-hidden /></Dialog.Close>}
          </header>
          <div className="action-dialog-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
