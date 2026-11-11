/**
 * 书架 store 的单测。
 *
 * 这一层的存在理由只有一个：首页和课程视图要读同一份书架。所以钉四件事——
 * 快照在两次写之间是同一个对象（useSyncExternalStore 靠它，不是同一引用会死循环）、
 * 导入只加不切（课程视图要先出账单）、删掉当前书能退回默认那本、重置真的回到默认。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_BOOK_ID, bookById, type ShelfBook } from '../src/course/shelf.ts'
import {
  getShelf,
  importBook,
  removeBookById,
  resetShelf,
  setActive,
  subscribe,
} from '../src/course/shelfStore.ts'

/** 一本两章的导入书；章名与 topicId 都是现编的，这一层只关心书怎么进怎么出。 */
function importedBook(id: string): ShelfBook {
  return {
    id,
    title: `书 ${id}`,
    chapters: [
      { no: 1, rawTitle: '第一章 抽样定理', topicId: '10', hits: ['抽样定理'] },
      { no: 2, rawTitle: '第二章 无关主题', topicId: null, hits: [] },
    ],
  }
}

test('初始只有默认那本，两次读拿到同一个快照对象', () => {
  resetShelf()
  const first = getShelf()
  const second = getShelf()
  assert.equal(first.books.length, 1)
  assert.equal(first.books[0].id, DEFAULT_BOOK_ID)
  assert.equal(first.activeId, DEFAULT_BOOK_ID)
  assert.equal(first, second)
})

test('导入只加不切：切不切由调用方决定', () => {
  resetShelf()
  importBook(importedBook('imported-1'))
  const shelf = getShelf()
  assert.equal(shelf.books.length, 2)
  assert.equal(shelf.activeId, DEFAULT_BOOK_ID, '导入后当前书不该被悄悄换掉')
  assert.equal(bookById(shelf.books, 'imported-1').title, '书 imported-1')
})

test('切换通知一次，同一个 id 再切不重复通知', () => {
  resetShelf()
  let calls = 0
  const off = subscribe(() => {
    calls += 1
  })
  importBook(importedBook('imported-1'))
  setActive('imported-1')
  assert.equal(calls, 2, '一次导入 + 一次切换')
  setActive('imported-1')
  assert.equal(calls, 2, '切到当前这本不该再通知')
  off()
})

test('退订之后不再收到通知', () => {
  resetShelf()
  let calls = 0
  const off = subscribe(() => {
    calls += 1
  })
  off()
  setActive('whatever')
  assert.equal(calls, 0)
  assert.equal(getShelf().activeId, 'whatever')
})

test('删书：默认那本删不掉，删当前书退回默认，删别的书不动当前', () => {
  resetShelf()
  importBook(importedBook('imported-1'))
  importBook(importedBook('imported-2'))
  setActive('imported-2')

  removeBookById(DEFAULT_BOOK_ID)
  assert.equal(getShelf().books.length, 3, '默认那本不许删')

  removeBookById('imported-1')
  assert.equal(getShelf().books.length, 2)
  assert.equal(getShelf().activeId, 'imported-2', '删的不是当前书，当前书不变')

  removeBookById('imported-2')
  assert.equal(getShelf().books.length, 1)
  assert.equal(getShelf().activeId, DEFAULT_BOOK_ID, '删掉当前书要退回默认那本')

  removeBookById('imported-2')
  assert.equal(getShelf().books.length, 1, '删不存在的 id 不该改书架')
})

test('重置回到默认：一本书、当前书是默认那本', () => {
  resetShelf()
  importBook(importedBook('imported-1'))
  setActive('imported-1')
  resetShelf()
  const shelf = getShelf()
  assert.equal(shelf.books.length, 1)
  assert.equal(shelf.books[0].id, DEFAULT_BOOK_ID)
  assert.equal(shelf.activeId, DEFAULT_BOOK_ID)
})
