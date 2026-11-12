/**
 * 书架状态提到模块级：首页和课程视图读同一份。
 *
 * 内存快照是唯一真源，IndexedDB 是它的副本（见 shelfDb.ts）：写操作先改内存、再异步落盘。
 * 落盘失败不回滚——用户看到的书架不能因为写盘失败而倒退，那一行提示写在面板上就够了。
 *
 * 启动时 `hydrate()` 读一次盘。读完之前 `ready` 是 false：面板显示「正在读取本机书架…」，
 * 课程视图左树照旧用默认那本书渲染——首屏不能空白，也不能先闪一下默认书再跳。
 *
 * 不变量：两次写操作之间 `getShelf()` 返回同一个对象，`useSyncExternalStore` 才不会死循环。
 */
import { useSyncExternalStore } from 'react'

import { DEFAULT_BOOK_ID, addBook, defaultShelfBook, removeBook, type ShelfBook } from './shelf.ts'
import { deleteBook, formatBytes, loadAll, saveActive, saveBook, savePdf } from './shelfDb.ts'

export type ShelfSnapshot = {
  books: ShelfBook[]
  activeId: string
  /** 本机书架读完了没有。 */
  ready: boolean
  /** 目录已经落盘的 id。 */
  storedIds: string[]
  /** 有原文件的 id → 字节数。 */
  pdfBytes: Record<string, number>
  /** 落盘/存原件失败时面板上那一行；没事时是 null。 */
  persistNote: string | null
  /** 「导入时同时保存原文件」开关，默认开。 */
  keepPdf: boolean
}

function defaultSnapshot(): ShelfSnapshot {
  return {
    books: [defaultShelfBook()],
    activeId: DEFAULT_BOOK_ID,
    ready: false,
    storedIds: [],
    pdfBytes: {},
    persistNote: null,
    keepPdf: true,
  }
}

let snapshot: ShelfSnapshot = defaultSnapshot()
const listeners = new Set<() => void>()

function commit(next: ShelfSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

/** 读当前快照。两次写操作之间返回同一个对象。 */
export function getShelf(): ShelfSnapshot {
  return snapshot
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** node 里没有 IndexedDB（单测就跑在那儿）：没有落盘可谈，也就没有那行提示。 */
function canPersist(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * 把盘上的目录并进内存。
 *
 * 同 id 以磁盘为准（磁盘是上一次真的存下来的），但默认那本永远由代码生成、
 * 不被磁盘记录覆盖——它没有 savedAt，也不该被一条旧记录顶掉。
 */
export function mergeBooks(diskBooks: ShelfBook[]): ShelfBook[] {
  const kept = diskBooks.filter((book) => book.id !== DEFAULT_BOOK_ID)
  return [defaultShelfBook(), ...kept]
}

/** activeId 指向一本已经删掉的书时，回落到默认那本。 */
export function pickActive(books: ShelfBook[], activeId: string | null): string {
  if (activeId && books.some((book) => book.id === activeId)) return activeId
  return DEFAULT_BOOK_ID
}

let hydrating: Promise<void> | null = null

/** 读一次本机书架；重复调用共用同一次读盘。 */
export function hydrate(): Promise<void> {
  if (hydrating) return hydrating
  hydrating = (async () => {
    try {
      const disk = await loadAll()
      const books = mergeBooks(disk.books)
      commit({
        ...snapshot,
        books,
        activeId: pickActive(books, disk.activeId),
        ready: true,
        storedIds: disk.books.filter((book) => book.id !== DEFAULT_BOOK_ID).map((book) => book.id),
        pdfBytes: disk.pdfBytes,
        persistNote: null,
      })
    } catch (error) {
      commit({ ...snapshot, ready: true, persistNote: `读本机书架失败：${describeError(error)}` })
    }
  })()
  return hydrating
}

/** 测试用：把内存打回默认，并把「读过盘了」这件事也一起复位。 */
export function resetShelf(): void {
  hydrating = null
  commit(defaultSnapshot())
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

async function persist(task: () => Promise<void>): Promise<void> {
  if (!canPersist()) return
  try {
    await task()
  } catch (error) {
    commit({ ...snapshot, persistNote: `保存到本机失败：${describeError(error)}` })
  }
}

/** 切当前书；同一个 id 不重复通知。连 activeId 一起落盘，刷新后回到这本。 */
export function setActive(id: string): void {
  if (id === snapshot.activeId) return
  commit({ ...snapshot, activeId: id })
  void persist(() => saveActive(id))
}

/**
 * 往书架里加一本。只负责「加」，切不切过去交给调用方。
 * 目录落盘是异步的，失败也不影响这一轮能不能用这本书。
 */
export function importBook(book: ShelfBook): ShelfBook {
  const books = addBook(snapshot.books, book)
  const storedIds = snapshot.storedIds.includes(book.id)
    ? snapshot.storedIds
    : [...snapshot.storedIds, book.id]
  commit({ ...snapshot, books, storedIds })
  void persist(() => saveBook(book))
  return book
}

/** 删一本；默认那本删不掉，删的是当前书就退回默认那本。目录与原件一起删。 */
export function removeBookById(id: string): void {
  if (id === DEFAULT_BOOK_ID) return
  if (!snapshot.books.some((book) => book.id === id)) return
  const books = removeBook(snapshot.books, id)
  if (books === snapshot.books) return
  const activeId = snapshot.activeId === id ? DEFAULT_BOOK_ID : snapshot.activeId
  const pdfBytes = { ...snapshot.pdfBytes }
  delete pdfBytes[id]
  commit({
    ...snapshot,
    books,
    activeId,
    storedIds: snapshot.storedIds.filter((stored) => stored !== id),
    pdfBytes,
  })
  void persist(async () => {
    await deleteBook(id)
    if (activeId !== snapshot.activeId) await saveActive(activeId)
  })
}

/** 原文件存好了：记下字节数，面板据此显示「目录 + 原文件 146 MB」。 */
export function markPdfSaved(id: string, bytes: number): void {
  commit({ ...snapshot, pdfBytes: { ...snapshot.pdfBytes, [id]: bytes }, persistNote: null })
}

/** 存原件被跳过或失败时，面板上那一行原话（不许吞掉错误）。 */
export function noteStorage(message: string | null): void {
  if (snapshot.persistNote === message) return
  commit({ ...snapshot, persistNote: message })
}

/** 「导入时同时保存原文件」开关；关掉只影响下一次导入，不动已经存下的。 */
export function setKeepPdf(keepPdf: boolean): void {
  if (snapshot.keepPdf === keepPdf) return
  commit({ ...snapshot, keepPdf })
}

/**
 * 存原文件（体积大、可能失败），失败一律降级成「只存目录」并把原话交回去。
 * 空文件、默认那本（没有原件）由调用方先拦掉。
 */
export async function storePdf(id: string, blob: Blob): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await savePdf(id, blob)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: describeError(error) }
  }
}

/** 给 React 用；测试直接调 getShelf/subscribe，不必进渲染。 */
export function useShelf(): ShelfSnapshot {
  return useSyncExternalStore(subscribe, getShelf, getShelf)
}

/** 这本书的目录/原件在本机存到哪一步了：面板那一行状态用它。 */
export function pdfStatusOf(
  id: string,
  snapshotLike: Pick<ShelfSnapshot, 'ready' | 'storedIds' | 'pdfBytes'>,
): { catalog: boolean; bytes: number } {
  const catalog = snapshotLike.storedIds.includes(id)
  const bytes = Object.prototype.hasOwnProperty.call(snapshotLike.pdfBytes, id)
    ? snapshotLike.pdfBytes[id]
    : 0
  return { catalog, bytes }
}

/**
 * 书架上一行状态文案：内置 / 正在读 / 未存 / 只有目录 / 目录 + 原文件。
 * 纯函数，测试直接喂一个假快照就能钉住四档。
 */
export function shelfStatusOf(
  id: string,
  view: { ready: boolean; storedIds: string[]; pdfBytes: Record<string, number> },
): string {
  if (id === DEFAULT_BOOK_ID) return '内置书，随应用生成'
  if (!view.ready) return '正在读取本机书架…'
  const { catalog, bytes } = pdfStatusOf(id, view)
  if (catalog && bytes > 0) return `已存到本机（目录 + 原文件 ${formatBytes(bytes)}）`
  if (catalog) return '已存到本机（仅目录）'
  return '未存'
}
