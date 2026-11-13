/**
 * 书架的持久层：IndexedDB。
 *
 * 这一层只管存与读，不 import react、不碰界面。库里三个 store：
 *
 * - `books`：一本书的目录记录 `{ id, title, savedAt, chapters }`，keyPath 是 `id`；
 * - `pdfs`：原文件，keyPath 也是 `id`。目录和原件分两个 store 是刻意的——
 *   一百多兆的 blob 不能和几 KB 的目录挤在一次事务里：存目录要快，存原件可以慢、可以失败；
 * - `meta`：一条 `{ key: 'activeId', value }`，记上次用的是哪本。
 *
 * 落盘前一律过一遍 JSON：`chapters` 里只允许字符串、数字、null、数组和纯对象。
 * 塞进来的函数、Map、类实例都在这一层被抹平成普通字段，读回来才不用猜。
 */

import type { ShelfBook, ShelfChapter } from './shelf.ts'

export const SHELF_DB_NAME = 'comm-lab-shelf'
export const SHELF_DB_VERSION = 1
export const STORE_BOOKS = 'books'
export const STORE_PDFS = 'pdfs'
export const STORE_META = 'meta'
export const ACTIVE_KEY = 'activeId'

/** `books` 里一条记录的形状，字段名写死，别处不许另起名字。 */
export type BookRecord = {
  id: string
  title: string
  savedAt: number
  chapters: ShelfChapter[]
}

/** 一次读盘的结果：目录、上次用的那本、哪些 id 有原文件（附带字节数）。 */
export type ShelfDisk = {
  books: ShelfBook[]
  activeId: string | null
  pdfBytes: Record<string, number>
}

/**
 * 把一章抹平成纯 JSON。
 *
 * 同一个数组过两遍要一模一样（幂等）：第一遍就丢掉了多余字段，第二遍没有可丢的。
 */
export function plainChapter(chapter: ShelfChapter): ShelfChapter {
  const no = typeof chapter.no === 'number' && Number.isFinite(chapter.no) ? chapter.no : null
  const rawTitle = typeof chapter.rawTitle === 'string' ? chapter.rawTitle : ''
  const topicId = typeof chapter.topicId === 'string' ? chapter.topicId : null
  const hits: string[] = []
  if (Array.isArray(chapter.hits)) {
    for (const hit of chapter.hits) {
      if (typeof hit === 'string') hits.push(hit)
    }
  }
  const plain: ShelfChapter = { no, rawTitle, topicId, hits }
  // R105 起页码要跟着目录一起存：同屏看书靠它把章翻到起始页。
  if (typeof chapter.page === 'number' && Number.isFinite(chapter.page) && chapter.page >= 1) {
    plain.page = Math.round(chapter.page)
  }
  if (Array.isArray(chapter.sectionHits)) {
    const sectionHits: string[] = []
    for (const hit of chapter.sectionHits) {
      if (typeof hit === 'string') sectionHits.push(hit)
    }
    plain.sectionHits = sectionHits
  }
  return plain
}

/** 一本书 → 一条落盘记录。 */
export function toBookRecord(book: ShelfBook, savedAt: number): BookRecord {
  return {
    id: book.id,
    title: book.title,
    savedAt,
    chapters: book.chapters.map(plainChapter),
  }
}

/** 落盘记录 → 一本书；脏记录（缺字段、类型不对）宁可丢掉也不要带进界面。 */
export function bookFromRecord(record: BookRecord): ShelfBook {
  return {
    id: record.id,
    title: typeof record.title === 'string' && record.title.trim() ? record.title : '未命名教材',
    chapters: Array.isArray(record.chapters) ? record.chapters.map(plainChapter) : [],
  }
}

/** 给人看的字节数：146 MB / 900 KB / 512 B。 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round(bytes)} B`
}

let opening: Promise<IDBDatabase> | null = null

/** 打开库；同一个页面只开一次，升级时补三个 store。 */
export function openDb(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('这个浏览器没有 IndexedDB，书架只能活在这一次会话里'))
      return
    }
    const request = indexedDB.open(SHELF_DB_NAME, SHELF_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_BOOKS)) db.createObjectStore(STORE_BOOKS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_PDFS)) db.createObjectStore(STORE_PDFS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('打开本机书架失败'))
    request.onblocked = () => reject(new Error('本机书架被另一个标签页占用，关掉那个标签再试'))
  })
  return opening
}

function ask<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('本机书架读写失败'))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('本机书架写入失败'))
    tx.onabort = () => reject(tx.error ?? new Error('本机书架写入被中断'))
  })
}

/** 读全部：目录、activeId、有原文件的 id 与字节数。 */
export async function loadAll(): Promise<ShelfDisk> {
  const db = await openDb()
  const tx = db.transaction([STORE_BOOKS, STORE_PDFS, STORE_META], 'readonly')
  const booksReq = tx.objectStore(STORE_BOOKS).getAll() as IDBRequest<BookRecord[]>
  const pdfsReq = tx.objectStore(STORE_PDFS).getAll() as IDBRequest<{ id: string; bytes?: number; blob?: Blob }[]>
  const activeReq = tx.objectStore(STORE_META).get(ACTIVE_KEY) as IDBRequest<{ key: string; value: string } | undefined>
  const [records, pdfs, active] = await Promise.all([ask(booksReq), ask(pdfsReq), ask(activeReq)])

  const books: ShelfBook[] = []
  for (const record of records) {
    if (record && typeof record.id === 'string') books.push(bookFromRecord(record))
  }
  const pdfBytes: Record<string, number> = {}
  for (const entry of pdfs) {
    if (!entry || typeof entry.id !== 'string') continue
    const bytes = typeof entry.bytes === 'number' ? entry.bytes : entry.blob?.size ?? 0
    pdfBytes[entry.id] = bytes
  }
  const activeId = active && typeof active.value === 'string' ? active.value : null
  return { books, activeId, pdfBytes }
}

/** 存一本书的目录（原件不在这里）。 */
export async function saveBook(book: ShelfBook, savedAt = Date.now()): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_BOOKS, 'readwrite')
  tx.objectStore(STORE_BOOKS).put(toBookRecord(book, savedAt))
  await done(tx)
}

/** 删一本书：目录与原件一起删，别留一条没人认领的 blob。 */
export async function deleteBook(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([STORE_BOOKS, STORE_PDFS], 'readwrite')
  tx.objectStore(STORE_BOOKS).delete(id)
  tx.objectStore(STORE_PDFS).delete(id)
  await done(tx)
}

/** 原文件的身份：页数 + 首页开头，用来发现「记录与 blob 不是同一本」。 */
export type PdfMeta = { numPages: number; head: string }

/** 一条原件记录：blob 与它的身份。 */
export type PdfRecord = { blob: Blob; meta: PdfMeta | null }

/** 读一条原件记录（含身份）；没存过原件返回 null。 */
export async function readPdfRecord(id: string): Promise<PdfRecord | null> {
  const db = await openDb()
  const record = await new Promise<{ blob?: Blob; meta?: PdfMeta | null } | undefined>((resolve, reject) => {
    const request = db.transaction(STORE_PDFS, 'readonly').objectStore(STORE_PDFS).get(id)
    request.onsuccess = () => resolve(request.result as { blob?: Blob; meta?: PdfMeta | null } | undefined)
    request.onerror = () => reject(request.error)
  })
  if (!record || !record.blob) return null
  return { blob: record.blob, meta: record.meta ?? null }
}

/** 删原件，目录一个字段都不动。 */
export async function deletePdf(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_PDFS, 'readwrite')
  tx.objectStore(STORE_PDFS).delete(id)
  await done(tx)
}

/** 存原文件（带身份）。慢、可能失败，调用方要接住。 */
export async function savePdf(id: string, blob: Blob, meta: PdfMeta | null): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_PDFS, 'readwrite')
  tx.objectStore(STORE_PDFS).put({ id, blob, bytes: blob.size, meta, savedAt: Date.now() })
  await done(tx)
}

/** 记下当前用的是哪本；刷新后回到这本。 */
export async function saveActive(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_META, 'readwrite')
  tx.objectStore(STORE_META).put({ key: ACTIVE_KEY, value: id })
  await done(tx)
}
