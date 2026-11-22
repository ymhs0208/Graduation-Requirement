import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useI18n } from '../lib/i18n'
import { fetchAuthenticatedFile } from '../lib/api'
import { LoadError } from './feedback'

GlobalWorkerOptions.workerSrc = workerUrl

export function DocumentPreview({ fileId }: { fileId: string }) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [zoom, setZoom] = useState(1.1)

  useEffect(() => {
    let cancelled = false
    let imageUrl = ''
    setPdf(null)
    setImage(null)
    setError('')
    setPage(1)
    ;(async () => {
      const response = await fetchAuthenticatedFile(`/api/files/${fileId}?disposition=inline`)
      if (!response.ok) {
        if (!cancelled) setError('preview')
        return
      }
      const mime = response.headers.get('content-type') ?? ''
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (cancelled) return
      if (mime.includes('pdf')) {
        const doc = await getDocument({ data: bytes }).promise
        if (cancelled) return
        setPages(doc.numPages)
        setPdf(doc)
      } else if (/^image\/(png|jpeg)\b/.test(mime)) {
        imageUrl = URL.createObjectURL(new Blob([bytes], { type: mime }))
        setImage(imageUrl)
      } else {
        setError('preview')
      }
    })().catch(() => {
      if (!cancelled) setError('preview')
    })
    return () => {
      cancelled = true
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    }
  }, [fileId, attempt])

  useEffect(() => {
    if (!pdf || !canvasRef.current) return
    let cancelled = false
    const canvas = canvasRef.current
    ;(async () => {
      const pdfPage = await pdf.getPage(page)
      if (cancelled) return
      const viewport = pdfPage.getViewport({ scale: zoom })
      const context = canvas.getContext('2d')
      if (!context) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      await pdfPage.render({ canvas, canvasContext: context, viewport }).promise
    })().catch(() => { if (!cancelled) setError('preview') })
    return () => {
      cancelled = true
    }
  }, [pdf, page, zoom])

  return (
    <section className="card flex min-h-64 flex-col overflow-hidden bg-[#f6f7fb]" aria-label={t('preview')}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-3 py-2.5 text-sm" role="toolbar" aria-label={t('preview')}>
        <span className="mr-1 font-semibold text-ink" id="preview-label">{t('preview')}</span>
        <button className="btn btn-ghost px-2.5 py-1" type="button" onClick={() => setZoom((value) => Math.max(0.6, value - 0.2))} aria-label={t('zoomOut')}>
          {t('zoomOut')}
        </button>
        <button className="btn btn-ghost px-2.5 py-1" type="button" onClick={() => setZoom((value) => Math.min(2.4, value + 0.2))} aria-label={t('zoomIn')}>
          {t('zoomIn')}
        </button>
        {pdf && (
          <>
            <button className="btn btn-ghost px-2.5 py-1" type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label={t('prevPage')} disabled={page <= 1}>
              {t('prevPage')}
            </button>
            <span className="tabular-nums text-muted" aria-live="polite">
              {page} / {pages}
            </span>
            <button className="btn btn-ghost px-2.5 py-1" type="button" onClick={() => setPage((value) => Math.min(pages, value + 1))} aria-label={t('nextPage')} disabled={page >= pages}>
              {t('nextPage')}
            </button>
          </>
        )}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {error && <LoadError message={t('previewFailed')} onRetry={() => setAttempt((value) => value + 1)} />}
        {!error && !image && !pdf && <p role="status">{t('loading')}</p>}
        {!error && image && <img alt={t('preview')} src={image} onError={() => setError('preview')} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} className="rounded-lg bg-white shadow-md" />}
        <canvas ref={canvasRef} role="img" aria-label={t('preview')} className={pdf && !error ? 'rounded-lg bg-white shadow-md' : 'hidden'} />
      </div>
    </section>
  )
}
