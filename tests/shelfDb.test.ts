/**
 * 书架落盘与状态文案的纯函数测试。
 *
 * IndexedDB 在 node 里没有，所以这里只钉不需要浏览器的那几件：
 * 记录 JSON 化是否幂等、读盘合并时谁说了算、activeId 指丢了怎么办、
 * 有目录没原文件时状态怎么写。读写 IndexedDB 本身用浏览器验，不在这里硬凑。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_BOOK_ID,
  DEFAULT_SHELF_TITLE,
  defaultShelfBook,
  type ShelfBook,
  type ShelfChapter,
} from '../src/course/shelf.ts'
import { bookFromRecord, plainChapter, toBookRecord } from '../src/course/shelfDb.ts'
import { mergeBooks, pickActive, shelfStatusOf } from '../src/course/shelfStore.ts'

function chapter(no: number, rawTitle: string, topicId: string | null): ShelfChapter {
  return { no, rawTitle, topicId, hits: topicId ? [rawTitle] : [] }
}

test('记录 JSON 化是幂等的，脏字段在第一次就丢掉', () => {
  const dirty = {
    no: 5,
    rawTitle: '第五章 模拟调制系统',
    topicId: '5',
    hits: ['模拟调制系统', 7],
    sectionHits: ['5.4.3 小信噪比时的门限效应', null],
    // 落盘记录里不该有的东西：数组外的东西、函数、类实例，一律不许带下去
    extra: '这块不该留下',
    fn: () => 1,
  } as unknown as ShelfChapter

  const once = plainChapter(dirty)
  const twice = plainChapter(once)

  assert.deepEqual(once, {
    no: 5,
    rawTitle: '第五章 模拟调制系统',
    topicId: '5',
    hits: ['模拟调制系统'],
    sectionHits: ['5.4.3 小信噪比时的门限效应'],
  })
  assert.deepEqual(twice, once, '过两遍要一模一样')
  assert.equal(JSON.stringify(twice).includes('fn'), false)
})

test('一本书存成记录再读回来，章与标题都不丢', () => {
  const book: ShelfBook = {
    id: 'imported-1',
    title: '信号与系统',
    chapters: [chapter(1, '第一章 绪论', '1'), chapter(2, '第二章 傅里叶变换', null)],
  }
  const record = toBookRecord(book, 1_700_000_000_000)
  const back = bookFromRecord(record)

  assert.equal(record.id, 'imported-1')
  assert.equal(record.savedAt, 1_700_000_000_000)
  assert.deepEqual(back, book)
})

test('读盘合并：同 id 以磁盘为准，但默认那本永远由代码生成', () => {
  const disk: ShelfBook[] = [
    { id: DEFAULT_BOOK_ID, title: '磁盘上被改坏的默认书', chapters: [] },
    { id: 'imported-1', title: '信号与系统', chapters: [chapter(1, '第一章 绪论', '1')] },
    { id: 'imported-2', title: '数字信号处理', chapters: [] },
  ]

  const merged = mergeBooks(disk)

  assert.equal(merged[0].id, DEFAULT_BOOK_ID)
  assert.equal(merged[0].title, DEFAULT_SHELF_TITLE)
  assert.deepEqual(merged[0].chapters, defaultShelfBook().chapters)
  assert.deepEqual(
    merged.slice(1).map((book) => book.id),
    ['imported-1', 'imported-2'],
  )
})

test('activeId 指向一本已经删掉的书时，回落到默认那本', () => {
  const books = [defaultShelfBook(), { id: 'imported-1', title: '信号与系统', chapters: [] }]

  assert.equal(pickActive(books, 'imported-1'), 'imported-1')
  assert.equal(pickActive(books, 'imported-9'), DEFAULT_BOOK_ID)
  assert.equal(pickActive(books, null), DEFAULT_BOOK_ID)
})

test('状态文案四档：内置 / 正在读 / 仅目录 / 目录 + 原文件', () => {
  const base = { ready: true, storedIds: ['imported-1'], pdfBytes: {} }

  assert.equal(shelfStatusOf(DEFAULT_BOOK_ID, base), '内置书，随应用生成')
  assert.equal(shelfStatusOf('imported-1', { ...base, ready: false }), '正在读取本机书架…')
  assert.equal(shelfStatusOf('imported-1', base), '已存到本机（仅目录）')
  assert.equal(shelfStatusOf('imported-2', base), '未存')
  assert.equal(
    shelfStatusOf('imported-1', { ...base, pdfBytes: { 'imported-1': 153_540_231 } }),
    '已存到本机（目录 + 原文件 146 MB）',
  )
})
