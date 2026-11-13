/**
 * 教材原文窗格：把当前这本教材的 PDF 按页画到 canvas 上。
 *
 * 只负责渲染，不负责目录：目录在 CoursePage 左边，PDF 解析缓存在 pdfSource。
 * 三条纪律：
 * - 位图尺寸一律走 syncCanvasSize，尺寸没变就不重设（重设会清屏）；
 * - 翻页、缩放前先 cancel 上一条 renderTask，避免旧页画到新页上；
 * - 加载中只显示骨架条，旧图先藏起来，不压着看。
 */
import { useEffect, useRef, useState } from 'react'
import './book-pane.css'
import { syncCanvasSize } from './canvasSize.ts'
import { MISSING_PDF_MESSAGE, loadDoc, parseCount, type PdfDocument, type PdfPage } from '../course/pdfSource.ts'
import { clampPage } from '../course/shelf.ts'

/** 三档缩放：适宽按容器宽度算，其余是绝对倍率。 */
export type PdfScale = 'fit' | number

const ZOOM_LEVELS: Array<{ value: PdfScale; label: string }> = [
  { value: 'fit', label: '适宽' },
  { value: 1, label: '100%' },
  { value: 1.5, label: '150%' },
]

type RenderTask = { promise: Promise<void>; cancel(): void }

type Props = {
  bookId: string
  page: number
  onPageChange: (page: number) => void
  scale: PdfScale
  onScaleChange?: (scale: PdfScale) => void
}

export function PdfPane({ bookId, page, onPageChange, scale, onScaleChange }: Props) {
  const [loaded, setLoaded] = useState<{ bookId: string; doc: PdfDocument } | null>(null)
  const [failure, setFailure] = useState<{ bookId: string; message: string } | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [widthTick, setWidthTick] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const renderRef = useRef<RenderTask | null>(null)
  const lastWidth = useRef(0)

  // 一本书只解析一次：同一个 bookId 换章节不会重新 parse（缓存看 pdfSource）。
  useEffect(() => {
    let alive = true
    loadDoc(bookId)
      .then((next) => {
        if (alive) setLoaded({ bookId, doc: next })
      })
      .catch((error: unknown) => {
        if (!alive) return
        const text = error instanceof Error ? error.message : String(error)
        setFailure({ bookId, message: text })
      })
    return () => {
      alive = false
    }
  }, [bookId])

  // 状态都从 bookId 派生：换书就自动回到 loading，不必在 effect 里同步清状态。
  const doc = loaded !== null && loaded.bookId === bookId ? loaded.doc : null
  const failureMessage = failure !== null && failure.bookId === bookId ? failure.message : ''
  const status: 'loading' | 'ready' | 'missing' | 'error' =
    doc !== null
      ? 'ready'
      : failureMessage === ''
        ? 'loading'
        : failureMessage === MISSING_PDF_MESSAGE
          ? 'missing'
          : 'error'
  const numPages = doc?.numPages ?? 0
  const message = failureMessage

  // 窄屏、拉伸窗口时重新算「适宽」，只在容器宽度真的变了才触发。
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (Math.abs(width - lastWidth.current) < 2) return
      lastWidth.current = width
      setWidthTick((tick) => tick + 1)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!doc || status !== 'ready' || !canvas) return
    let cancelled = false
    const previous = renderRef.current
    if (previous) {
      previous.cancel()
      renderRef.current = null
    }
    const run = async () => {
      setRendering(true)
      setRenderError(null)
      try {
        const target = clampPage(page, doc.numPages)
        const pdfPage: PdfPage = await doc.getPage(target)
        if (cancelled) return
        const container = containerRef.current
        const available = container ? container.clientWidth - 24 : 0
        const base = pdfPage.getViewport({ scale: 1 })
        const fit = available > 0 ? Math.max(0.2, Math.min(2, available / base.width)) : 1
        const renderScale = scale === 'fit' ? fit : scale
        const viewport = pdfPage.getViewport({ scale: renderScale })
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        syncCanvasSize(canvas, viewport.width, viewport.height, dpr)
        canvas.style.width = `${Math.round(viewport.width)}px`
        canvas.style.height = `${Math.round(viewport.height)}px`
        const context = canvas.getContext('2d')
        if (!context) throw new Error('画布拿不到 2d context')
        context.save()
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.restore()
        const task = pdfPage.render({
          canvasContext: context,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        })
        renderRef.current = task
        await task.promise
        if (!cancelled) setRendering(false)
      } catch (error) {
        if (cancelled) return
        const name = (error as { name?: string } | null)?.name
        if (name === 'RenderingCancelledException') return
        setRendering(false)
        setRenderError(error instanceof Error ? error.message : String(error))
      }
    }
    void run()

    return () => {
      cancelled = true
      const task = renderRef.current
      if (task) {
        task.cancel()
        renderRef.current = null
      }
    }
  }, [doc, page, scale, status, widthTick])

  const total = numPages || 1
  const go = (next: number) => onPageChange(clampPage(next, total))
  const zoom = (value: PdfScale) => onScaleChange?.(value)

  return (
    <div className="pdf-pane" ref={containerRef} data-parse-count={parseCount(bookId)}>
      <div className="pdf-toolbar">
        <button type="button" className="pdf-btn" onClick={() => go(page - 1)} disabled={page <= 1}>
          上一页
        </button>
        <input
          className="pdf-page-input"
          type="number"
          min={1}
          max={total}
          value={page}
          aria-label="页码"
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) go(next)
          }}
        />
        <span className="pdf-page-total">/ {numPages || '—'}</span>
        <button type="button" className="pdf-btn" onClick={() => go(page + 1)} disabled={page >= total}>
          下一页
        </button>
        <span className="pdf-zoom" role="group" aria-label="缩放">
          {ZOOM_LEVELS.map((level) => (
            <button
              key={String(level.value)}
              type="button"
              className={`pdf-btn${scale === level.value ? ' active' : ''}`}
              onClick={() => zoom(level.value)}
              disabled={!onScaleChange}
            >
              {level.label}
            </button>
          ))}
        </span>
      </div>

      {status === 'missing' ? <p className="pdf-hint">{MISSING_PDF_MESSAGE}</p> : null}
      {status === 'error' ? <p className="pdf-hint">这本 PDF 打不开：{message}</p> : null}
      {status === 'loading' ? <div className="pdf-skeleton tall" aria-label="正在打开教材" /> : null}

      {status === 'ready' ? (
        <div className="pdf-stage">
          {rendering ? <div className="pdf-skeleton" aria-label="正在渲染这一页" /> : null}
          {renderError ? <p className="pdf-hint">第 {page} 页渲染失败：{renderError}</p> : null}
          <canvas ref={canvasRef} className={`pdf-canvas${rendering ? ' is-rendering' : ''}`} />
        </div>
      ) : null}
    </div>
  )
}
