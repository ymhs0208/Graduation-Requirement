import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { onConnectionProblem } from '../lib/api'
import { useI18n } from '../lib/i18n'

export function Spinner() {
  return <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
}

export function PendingLabel({ pending, children }: { pending?: boolean; children: ReactNode }) {
  const { t } = useI18n()
  if (!pending) return <>{children}</>
  return (
    <span className="inline-flex items-center gap-2" aria-live="polite">
      <Spinner />
      {t('sending')}
    </span>
  )
}

export function PendingButton({ pending, children, className, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { pending?: boolean }) {
  return (
    <button {...rest} className={className} disabled={disabled || pending} aria-busy={pending || undefined}>
      <PendingLabel pending={pending}>{children}</PendingLabel>
    </button>
  )
}

export function UploadProgress({ percent, onCancel }: { percent: number; onCancel: () => void }) {
  const { t } = useI18n()
  const width = Math.max(0, Math.min(100, percent))
  return (
    <div className="space-y-2 rounded-xl border border-line bg-[#f4faf7] p-3">
      <div className="flex items-center justify-between text-sm font-medium">
        <span className="inline-flex items-center gap-2">
          <Spinner />
          {t('uploading')}
        </span>
        <span>{width}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-[#e4eee9]" role="progressbar" aria-valuenow={width} aria-valuemin={0} aria-valuemax={100} aria-label={t('uploading')}>
        <div className="h-full rounded-full bg-teal" style={{ width: `${width}%` }} />
      </div>
      <button className="btn btn-ghost" type="button" onClick={onCancel}>
        {t('cancel')}
      </button>
    </div>
  )
}

export function StepStatus({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="space-y-1 text-sm" aria-live="polite">
      {steps.map((step, index) => (
        <li key={step} className={index < current ? 'font-medium text-teal' : index === current ? 'font-semibold text-ink' : 'text-muted'}>
          <span className="mr-2 inline-flex w-4 justify-center">{index < current ? '✓' : index === current ? <Spinner /> : '·'}</span>
          {step}
        </li>
      ))}
    </ol>
  )
}

export function PageSkeleton() {
  const { t } = useI18n()
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label={t('loading')}>
      <div className="h-8 w-48 animate-pulse rounded-xl bg-[#e4eee9]" />
      <div className="card h-40 animate-pulse bg-[#f7faf8]" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card h-28 animate-pulse bg-[#f7faf8]" />
        <div className="card h-28 animate-pulse bg-[#f7faf8]" />
      </div>
    </div>
  )
}

export function TableSkeleton() {
  const { t } = useI18n()
  return (
    <div className="card space-y-3 p-4" role="status" aria-busy="true" aria-label={t('loading')}>
      <div className="h-8 animate-pulse rounded-lg bg-[#e7f1ec]" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="h-8 animate-pulse rounded-lg bg-[#e4eee9]" />
      ))}
    </div>
  )
}

export function RouteProgress() {
  const { t } = useI18n()
  const location = useLocation()
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState(false)
  const running = useRef(false)
  useEffect(() => {
    const start = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest('a')
      const href = anchor?.getAttribute('href') ?? ''
      if (!href.startsWith('/') || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      running.current = true
      setVisible(true)
      setWidth(18)
    }
    document.addEventListener('click', start)
    return () => document.removeEventListener('click', start)
  }, [])
  useEffect(() => {
    if (!visible) return
    const timer = window.setInterval(() => setWidth((value) => (value >= 88 ? value : value + 7)), 280)
    return () => window.clearInterval(timer)
  }, [visible])
  useEffect(() => {
    if (!running.current) return
    running.current = false
    setWidth(100)
    const timer = window.setTimeout(() => {
      setVisible(false)
      setWidth(0)
    }, 280)
    return () => window.clearTimeout(timer)
  }, [location.pathname])
  if (!visible) return null
  return <div className="route-progress" style={{ width: `${width}%` }} role="progressbar" aria-label={t('loading')} aria-valuenow={width} aria-valuemin={0} aria-valuemax={100} />
}

export function ConnectionBanner() {
  const { t } = useI18n()
  const client = useQueryClient()
  const [down, setDown] = useState(typeof navigator !== 'undefined' ? navigator.onLine === false : false)
  useEffect(() => {
    const off = () => setDown(true)
    const on = () => setDown(false)
    window.addEventListener('offline', off)
    window.addEventListener('online', on)
    const stop = onConnectionProblem(off)
    return () => {
      window.removeEventListener('offline', off)
      window.removeEventListener('online', on)
      stop()
    }
  }, [])
  if (!down) return null
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(100%-2rem,32rem)] items-center justify-between gap-3 rounded-2xl bg-pine px-4 py-3 text-sm text-white shadow-lg" role="alert">
      <span>{t('offline')}</span>
      <button
        className="btn bg-white text-pine"
        type="button"
        onClick={() => {
          if (navigator.onLine) {
            setDown(false)
            void client.invalidateQueries()
          } else {
            window.location.reload()
          }
        }}
      >
        {t('retry')}
      </button>
    </div>
  )
}
