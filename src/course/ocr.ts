/**
 * 扫描件的 OCR（R107，只做目录页）。
 *
 * 三条纪律：
 * - 引擎、核、语言包全部从本机 `public/` 取，不碰 CDN，也不在运行时下载；
 * - 识别失败一律返回 `{ ok: false, message }`，不把异常抛给界面；
 * - 每页识别完立刻进 IndexedDB（`ocr` store），重进时同页直接命中。
 */
import { loadFromPdfjs, type PdfDocument } from './pdfSource.ts'
import { readOcrText, saveOcrText } from './shelfDb.ts'

export type OcrProgress = {
  /** loading=引擎在起；page=正在识别第几页。 */
  stage: 'loading' | 'page'
  page: number
  total: number
  message: string
}

export type OcrPageText = { page: number; text: string }

export type OcrOutcome =
  | { ok: true; pages: OcrPageText[]; elapsedMs: number; cachedPages: number }
  | { ok: false; message: string }

export type OcrWorker = {
  recognize: (image: unknown) => Promise<{ data: { text: string } }>
  terminate: () => Promise<unknown>
}

/** 引擎 90 秒内没起来就退回手动输入。 */
export const OCR_TIMEOUT_MS = 90_000
/** 页宽放大到 2 倍再认，小字才分得开。 */
export const OCR_RENDER_SCALE = 2

/** 逐页文本的缓存键：同一本书同一页永远同一个键。 */
export function ocrCacheKey(bookId: string, page: number): string {
  return `${bookId}:${page}`
}

/** 缓存命中就读出来；读不到或读错都当没命中。 */
export async function cachedPageText(
  key: string,
  read: (key: string) => Promise<string | null> = readOcrText,
): Promise<string | null> {
  try {
    const text = await read(key)
    return typeof text === 'string' && text.length > 0 ? text : null
  } catch {
    return null
  }
}

/** 站点根（`/comm-lab/` 或开发时的 `/`），资源都挂在它下面。 */
function assetBase(): string {
  if (typeof document === 'undefined') return '/'
  return new URL('.', document.baseURI).href
}

function withTimeout<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** 起一个本地引擎；路径全指 `public/`，`gzip: true` 对应 `.traineddata.gz`。 */
export async function createOcrWorker(): Promise<OcrWorker> {
  const base = assetBase()
  const { createWorker } = await import('tesseract.js')
  const worker = await withTimeout(
    createWorker('chi_sim', 1, {
      workerPath: `${base}tesseract/worker.min.js`,
      corePath: `${base}tesseract`,
      langPath: `${base}tessdata`,
      gzip: true,
    }),
    OCR_TIMEOUT_MS,
    '识别引擎 90 秒内没起来，请改用手动输入章名',
  )
  return worker as unknown as OcrWorker
}

export type RecognizeOptions = {
  bookId?: string
  signal?: AbortSignal
  worker?: OcrWorker
  /** 测试用：替换缓存读写。 */
  cacheRead?: (key: string) => Promise<string | null>
  cacheWrite?: (key: string, text: string) => Promise<void>
}

/**
 * 把指定页渲染成位图再逐页识别。
 *
 * 传入 `worker` 时调用方负责 terminate；不传就自己起自己收。
 */
export async function recognizePages(
  blob: Blob,
  pages: number[],
  onProgress?: (progress: OcrProgress) => void,
  options: RecognizeOptions = {},
): Promise<OcrOutcome> {
  const started = Date.now()
  const cacheRead = options.cacheRead ?? readOcrText
  const cacheWrite = options.cacheWrite ?? saveOcrText
  const bookId = options.bookId ?? 'adhoc'
  let worker: OcrWorker | null = options.worker ?? null
  let doc: PdfDocument | null = null
  try {
    const cachedTexts: Array<string | null> = []
    for (const pageNumber of pages) {
      cachedTexts.push(await cachedPageText(ocrCacheKey(bookId, pageNumber), cacheRead))
    }
    if (pages.length > 0 && cachedTexts.every((text) => text !== null)) {
      onProgress?.({
        stage: 'page',
        page: pages.length,
        total: pages.length,
        message: '全部命中缓存，不再跑识别引擎',
      })
      return {
        ok: true,
        pages: pages.map((page, index) => ({ page, text: cachedTexts[index] as string })),
        elapsedMs: Date.now() - started,
        cachedPages: pages.length,
      }
    }
    onProgress?.({ stage: 'loading', page: 0, total: pages.length, message: '正在唤醒识别引擎' })
    if (!worker) worker = await createOcrWorker()
    doc = await loadFromPdfjs(new Uint8Array(await blob.arrayBuffer()))
    const out: OcrPageText[] = []
    let cachedPages = 0
    for (let index = 0; index < pages.length; index += 1) {
      if (options.signal?.aborted) return { ok: false, message: '已取消' }
      const pageNumber = pages[index]
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) {
        throw new Error(`第 ${pageNumber} 页不在 PDF 里（共 ${doc.numPages} 页）`)
      }
      const key = ocrCacheKey(bookId, pageNumber)
      const cached = cachedTexts[index]
      if (cached !== null) {
        cachedPages += 1
        out.push({ page: pageNumber, text: cached })
        onProgress?.({
          stage: 'page',
          page: index + 1,
          total: pages.length,
          message: `第 ${pageNumber} 页命中缓存`,
        })
        continue
      }
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: OCR_RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('画不出离屏画布，识别不了')
      await page.render({ canvasContext: context, viewport }).promise
      const { data } = await withTimeout(
        worker.recognize(canvas),
        OCR_TIMEOUT_MS,
        `第 ${pageNumber} 页识别超时`,
      )
      const text = typeof data?.text === 'string' ? data.text : ''
      try {
        await cacheWrite(key, text)
      } catch {
        // 存不进缓存不算失败，下次再认一遍就是了。
      }
      out.push({ page: pageNumber, text })
      onProgress?.({
        stage: 'page',
        page: index + 1,
        total: pages.length,
        message: `正在识别目录页 ${index + 1}/${pages.length}`,
      })
    }
    await doc.destroy()
    doc = null
    return { ok: true, pages: out, elapsedMs: Date.now() - started, cachedPages }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '识别失败' }
  } finally {
    if (doc) await doc.destroy().catch(() => {})
    if (!options.worker && worker) await worker.terminate().catch(() => {})
  }
}
