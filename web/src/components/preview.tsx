import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useI18n } from '../lib/i18n'

GlobalWorkerOptions.workerSrc = workerUrl

export function DocumentPreview({ fileId }: { fileId: string }) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [error, setError] = useState('')
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
      const response = await fetch(`/api/files/${fileId}?disposition=inline`, { credentials: 'include' })
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
      } else {
        imageUrl = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }))
        setImage(imageUrl)
      }
    })().catch(() => {
      if (!cancelled) setError('preview')
    })
    return () => {
      cancelled = true
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    }
  }, [fileId])

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
    })().catch(() => setError('preview'))
    return () => {
      cancelled = true
    }
  }, [pdf, page, zoom])

  return (
    <div className="flex min-h-[420px] flex-col rounded-2xl border border-line bg-stone-100 dark:border-zinc-700 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm dark:border-zinc-700">
        <span className="font-medium">{t('preview')}</span>
        <button className="rounded-lg border px-2 py-1" type="button" onClick={() => setZoom((value) => Math.max(0.6, value - 0.2))}>
          {t('zoomOut')}
        </button>
        <button className="rounded-lg border px-2 py-1" type="button" onClick={() => setZoom((value) => Math.min(2.4, value + 0.2))}>
          {t('zoomIn')}
        </button>
        {pdf && (
          <>
            <button className="rounded-lg border px-2 py-1" type="button" onClick={() => setPage((value) => Math.max(1, value - 1))}>
              {t('prevPage')}
            </button>
            <span>
              {page} / {pages}
            </span>
            <button className="rounded-lg border px-2 py-1" type="button" onClick={() => setPage((value) => Math.min(pages, value + 1))}>
              {t('nextPage')}
            </button>
          </>
        )}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {error && <p className="text-rose-700">{t('error')}</p>}
        {image && <img alt="" src={image} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} className="bg-white shadow" />}
        <canvas ref={canvasRef} className={pdf ? 'bg-white shadow' : 'hidden'} />
      </div>
    </div>
  )
}
