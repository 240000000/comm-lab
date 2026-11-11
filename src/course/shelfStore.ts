/**
 * 书架状态提到模块级：首页和课程视图读同一份。
 *
 * 只有这一份内存状态，没有 localStorage、没有 DOM 依赖——刷新页面就回到默认那本，
 * 这是既有设计的边界（见 shelf.ts 的头注释），本轮不破例。
 *
 * 写操作只有四个：切当前书、加一本、删一本、整体重置（给测试用）。
 * 每次写都换一个新的快照对象，useSyncExternalStore 才认得出「变了」。
 */
import { useSyncExternalStore } from 'react'

import { DEFAULT_BOOK_ID, addBook, defaultShelfBook, removeBook, type ShelfBook } from './shelf.ts'

export type ShelfSnapshot = {
  books: ShelfBook[]
  activeId: string
}

function defaultSnapshot(): ShelfSnapshot {
  return { books: [defaultShelfBook()], activeId: DEFAULT_BOOK_ID }
}

let snapshot: ShelfSnapshot = defaultSnapshot()
const listeners = new Set<() => void>()

function commit(next: ShelfSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

/** 读当前快照。两次写操作之间返回同一个对象，useSyncExternalStore 才不会死循环。 */
export function getShelf(): ShelfSnapshot {
  return snapshot
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 切当前书；同一个 id 不重复通知。 */
export function setActive(id: string): void {
  if (id === snapshot.activeId) return
  commit({ books: snapshot.books, activeId: id })
}

/**
 * 往书架里加一本。
 *
 * 这里只负责「加」，切不切过去交给调用方：课程视图要先把账单摆给用户看，
 * 点了「用这本书」才换；首页没有账单这一步，导完直接 setActive。
 */
export function importBook(book: ShelfBook): ShelfBook {
  const books = addBook(snapshot.books, book)
  commit({ books, activeId: snapshot.activeId })
  return book
}

/** 删一本；默认那本删不掉，删的是当前书就退回默认那本。 */
export function removeBookById(id: string): void {
  if (!snapshot.books.some((book) => book.id === id)) return
  const books = removeBook(snapshot.books, id)
  if (books === snapshot.books) return
  commit({
    books,
    activeId: snapshot.activeId === id ? DEFAULT_BOOK_ID : snapshot.activeId,
  })
}

/** 回到默认那本。测试用，也让「刷新等于重置」这件事有个能直接调的入口。 */
export function resetShelf(): void {
  commit(defaultSnapshot())
}

/** 给 React 用；测试直接调 getShelf/subscribe，不必进渲染。 */
export function useShelf(): ShelfSnapshot {
  return useSyncExternalStore(subscribe, getShelf, getShelf)
}
