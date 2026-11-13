/**
 * 书稿原文件的读取与 PDF 文档缓存。
 *
 * 只做三件事：从 IndexedDB 的 `pdfs` store 取 blob、按 id 缓存 PDFDocumentProxy、
 * 抽样判断有没有文字层。渲染在 PdfPane，目录解析仍在 pdfOutline，本文件不碰界面。
 *
 * 两条纪律：
 * - 取不到原文件返回 null，不抛错——默认那本是代码生成的，本来就没有 PDF；
 * - 同一本书在一次会话里只 parse 一次：缓存的是 Promise，并发调用也只解析一次；
 *   closeBook 负责 destroy 并清缓存，调用后下一次 loadDoc 会重新解析。
 */
import { STORE_PDFS, readPdfRecord } from './shelfDb.ts'

/** 取原文件失败时给界面看的一句话。 */
export const MISSING_PDF_MESSAGE = '本书只保存了目录，要看正文请重新导入并勾选保存原文件'

/** PDF 文档的最小形状，只用到渲染与抽文字这几件事。 */
export type PdfDocument = {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPage>
  destroy(): Promise<void>
}

export type PdfPage = {
  getViewport(params: { scale: number }): { width: number; height: number }
  render(params: {
    canvasContext: CanvasRenderingContext2D
    viewport: unknown
    transform?: number[]
  }): { promise: Promise<void>; cancel(): void }
  getTextContent(): Promise<{ items: Array<{ str?: string }> }>
}

type Loader = (bytes: Uint8Array) => Promise<PdfDocument>
export type PdfMeta = { numPages: number; head: string }
export type PdfRecord = { bytes: Uint8Array; meta: PdfMeta | null }
export type LoadResult =
  | { status: 'ok'; doc: PdfDocument }
  | { status: 'mismatch'; expected: number; actual: number }
type ReadBytes = (id: string) => Promise<PdfRecord | null>

const DB_NAME = 'comm-lab-shelf'

function openShelfDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('这个环境没有 IndexedDB'))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    // 库不存在时不要顺手建表：读不到原文件就是 null，建表是 shelfDb 的事。
    request.onupgradeneeded = () => undefined
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打不开'))
    request.onblocked = () => reject(new Error('IndexedDB 被另一个标签页占着'))
  })
}

/** 按书 id 取原文件；没有、读不到、环境不支持，一律 null，不抛错。 */
export async function getBookPdf(id: string): Promise<Blob | null> {
  if (!id || typeof indexedDB === 'undefined') return null
  let db: IDBDatabase | null = null
  try {
    db = await openShelfDb()
    if (!db.objectStoreNames.contains(STORE_PDFS)) return null
    const record = await new Promise<{ blob?: Blob } | undefined>((resolve, reject) => {
      const tx = db!.transaction(STORE_PDFS, 'readonly')
      const request = tx.objectStore(STORE_PDFS).get(id)
      request.onsuccess = () => resolve(request.result as { blob?: Blob } | undefined)
      request.onerror = () => reject(request.error ?? new Error('读 pdfs 失败'))
    })
    return record && record.blob ? record.blob : null
  } catch {
    return null
  } finally {
    db?.close()
  }
}

async function readRecordFromDb(id: string): Promise<PdfRecord | null> {
  const record = await readPdfRecord(id)
  if (!record) return null
  return { bytes: new Uint8Array(await record.blob.arrayBuffer()), meta: record.meta }
}

async function loadFromPdfjs(bytes: Uint8Array): Promise<PdfDocument> {
  const pdfjs = (await import('pdfjs-dist')) as unknown as {
    getDocument: (source: { data: Uint8Array; disableWorker?: boolean }) => {
      promise: Promise<unknown>
      destroy: () => Promise<void>
    }
    GlobalWorkerOptions?: { workerSrc: string }
  }
  // 浏览器里配 worker；Node（测试）里没有 window，禁用 worker 直接在主线程解析。
  if (typeof window !== 'undefined' && pdfjs.GlobalWorkerOptions) {
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')) as { default: string }
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  }
  const task = pdfjs.getDocument({
    // pdf.js 会把这个 buffer 转移走，给一份副本，调用方手里的还在。
    data: bytes.slice(),
    ...(typeof window === 'undefined' ? { disableWorker: true } : {}),
  })
  const doc = (await task.promise) as { numPages: number; getPage: (page: number) => Promise<unknown> }
  // pdfjs 6 的 PDFDocumentProxy 没有 destroy；销毁要落在 loadingTask 上。
  return {
    numPages: doc.numPages,
    getPage: (page: number) => doc.getPage(page) as ReturnType<PdfDocument['getPage']>,
    destroy: () => task.destroy(),
  }
}

const cache = new Map<string, Promise<LoadResult>>()
const parseCounts = new Map<string, number>()

/** 这本书解析过几次；跨章节切换应当一直是 1。 */
export function parseCount(id: string): number {
  return parseCounts.get(id) ?? 0
}

/** 当前缓存里有没有这本（不触发解析）。 */
export function isBookCached(id: string): boolean {
  return cache.has(id)
}

/**
 * 取（或复用）一本书的 PDFDocumentProxy。
 *
 * 缓存的是 Promise 而不是解析好的对象：同一帧里两个组件同时要书，也只 parse 一次。
 * `options` 只为测试留口子；正常调用不传。
 */
export async function loadDoc(
  id: string,
  options: { load?: Loader; read?: ReadBytes } = {},
): Promise<LoadResult> {
  const hit = cache.get(id)
  if (hit) return hit
  const read = options.read ?? readRecordFromDb
  const load = options.load ?? loadFromPdfjs
  const task = (async (): Promise<LoadResult> => {
    const record = await read(id)
    if (!record) throw new Error(MISSING_PDF_MESSAGE)
    // 空 blob 是没存成，不是「身份不符」：别把 0 字节交给 pdf.js。
    if (record.bytes.length === 0) throw new Error(MISSING_PDF_MESSAGE)
    parseCounts.set(id, (parseCounts.get(id) ?? 0) + 1)
    const doc = await load(record.bytes)
    if (record.meta && record.meta.numPages > 0 && record.meta.numPages !== doc.numPages) {
      await doc.destroy()
      return { status: 'mismatch', expected: record.meta.numPages, actual: doc.numPages }
    }
    return { status: 'ok', doc }
  })()
  cache.set(id, task)
  // 失败不要留在缓存里，否则一次读失败会让这本书这一辈子都打不开。
  task.catch(() => {
    if (cache.get(id) === task) cache.delete(id)
  })
  return task
}

/** 关掉一本书：destroy 并把缓存清干净；没加载过就什么也不做。 */
export async function closeBook(id: string): Promise<void> {
  const task = cache.get(id)
  cache.delete(id)
  if (!task) return
  try {
    const result = await task
    if (result.status === 'ok') await result.doc.destroy()
  } catch {
    // 本来就没加载成功，没有可销毁的 document。
  }
}

/**
 * 一本书的身份：页数 + 首页开头 80 字。
 *
 * 导入时存进 pdfs 记录；打开时比对页数，对不上就是「记录与 blob 不是同一本」。
 */
export async function readPdfMeta(source: Blob | Uint8Array): Promise<PdfMeta> {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer())
  const doc = await loadFromPdfjs(bytes)
  try {
    const page = await doc.getPage(1)
    const content = await page.getTextContent()
    const head = content.items
      .map((item) => (typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
    return { numPages: doc.numPages, head }
  } finally {
    await doc.destroy()
  }
}

/** 抽样页数：只看前五页，扫描件的判据是这些页加起来不到 50 个字符。 */
export const TEXT_SAMPLE_PAGES = 5
export const TEXT_LAYER_MIN_CHARS = 50

/** 判断 PDF 有没有文字层；扫描件返回 false（R106 才用得到）。 */
export async function hasTextLayer(doc: PdfDocument, samplePages = TEXT_SAMPLE_PAGES): Promise<boolean> {
  const pages = Math.max(0, Math.min(samplePages, doc.numPages))
  let chars = 0
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    for (const item of content.items) {
      if (typeof item.str === 'string') chars += item.str.trim().length
    }
    if (chars >= TEXT_LAYER_MIN_CHARS) return true
  }
  return chars >= TEXT_LAYER_MIN_CHARS
}
