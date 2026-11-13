import test from 'node:test'
import assert from 'node:assert/strict'
import type { ShelfBook } from '../src/course/shelf.ts'
import { bookFromSections, chapterPage, clampPage } from '../src/course/shelf.ts'
import type { PdfDocument } from '../src/course/pdfSource.ts'
import {
  closeBook,
  getBookPdf,
  hasTextLayer,
  isBookCached,
  loadDoc,
  parseCount,
} from '../src/course/pdfSource.ts'
import { bookFromRecord, toBookRecord } from '../src/course/shelfDb.ts'

const book: ShelfBook = {
  id: 'imported-1',
  title: '测试教材',
  chapters: [
    { no: 1, rawTitle: '第1章 绪论', topicId: '1', hits: [], page: 3 },
    { no: 2, rawTitle: '第2章 确定信号', topicId: '2', hits: [], page: 9 },
    { no: 3, rawTitle: '第3章 随机过程', topicId: null, hits: [], page: null },
  ],
}

test('章到页映射：topicId、章号都能找到起始页，找不到给 1', () => {
  assert.equal(chapterPage(book, 1), 3)
  assert.equal(chapterPage(book, 2), 9)
  assert.equal(chapterPage(book, 3), 1, '页码为空的章回退到第 1 页')
  assert.equal(chapterPage(book, 99), 1, '书里没有的章回退到第 1 页')
  assert.equal(chapterPage(book, null), 1)
})

test('bookFromSections 把章级条目的 page 带到章上，节级条目的页码不顶掉章页', () => {
  const parsed = bookFromSections(
    '测试教材',
    [
      { rawTitle: '第1章 绪论', page: 3, depth: 0, chapterNo: 1 },
      { rawTitle: '1.1 通信系统', page: 4, depth: 1, chapterNo: 1 },
      { rawTitle: '第2章 确定信号', page: 9, depth: 0, chapterNo: 2 },
    ],
    'imported-2',
  )
  assert.equal(parsed.chapters.find((chapter) => chapter.no === 1)?.page, 3)
  assert.equal(parsed.chapters.find((chapter) => chapter.no === 2)?.page, 9)
})

test('页码夹紧在 1..numPages：越界、小数、NaN 都收回来', () => {
  assert.equal(clampPage(0, 8), 1)
  assert.equal(clampPage(1, 8), 1)
  assert.equal(clampPage(8, 8), 8)
  assert.equal(clampPage(99, 8), 8)
  assert.equal(clampPage(2.6, 8), 3)
  assert.equal(clampPage(Number.NaN, 8), 1)
  assert.equal(clampPage(5, 0), 1, '页数未知时按 1 页算')
})

test('没有原文件时 getBookPdf 返回 null，不抛错', async () => {
  assert.equal(await getBookPdf('imported-none'), null)
})

test('目录存进 IndexedDB 再读回，页码不丢', () => {
  const back = bookFromRecord(toBookRecord(book, 1))
  assert.equal(back.chapters[0].page, 3)
  assert.equal(back.chapters[1].page, 9)
})

test('同一本书只解析一次；closeBook 销毁并清缓存，再打开才重新解析', async () => {
  let loads = 0
  let destroyed = 0
  const fakeDoc: PdfDocument = {
    numPages: 2,
    getPage: async () => ({
      getViewport: () => ({ width: 100, height: 100 }),
      render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
      getTextContent: async () => ({ items: [] }),
    }),
    destroy: async () => {
      destroyed += 1
    },
  }
  const read = async () => ({ bytes: new Uint8Array([37, 80, 68, 70]), meta: null })
  const load = async () => {
    loads += 1
    return fakeDoc
  }

  const first = await loadDoc('imported-cache', { read, load })
  const second = await loadDoc('imported-cache', { read, load })
  assert.equal(first, second, '两次拿到的是同一个 document')
  assert.equal(loads, 1, '同一本书只 parse 一次')
  assert.equal(parseCount('imported-cache'), 1)
  assert.equal(isBookCached('imported-cache'), true)

  await closeBook('imported-cache')
  assert.equal(destroyed, 1)
  assert.equal(isBookCached('imported-cache'), false)

  await loadDoc('imported-cache', { read, load })
  assert.equal(loads, 2, '关掉之后重新打开会重新解析')
})

test('hasTextLayer：前五页累计不足 50 个字符判扫描件', async () => {
  const docWith = (texts: string[]): PdfDocument => ({
    numPages: texts.length,
    getPage: async (pageNumber: number) => ({
      getViewport: () => ({ width: 100, height: 100 }),
      render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
      getTextContent: async () => ({ items: [{ str: texts[pageNumber - 1] ?? '' }] }),
    }),
    destroy: async () => undefined,
  })

  assert.equal(await hasTextLayer(docWith(['短', '短', '短', '短', '短'])), false)
  assert.equal(await hasTextLayer(docWith(['长'.repeat(60)])), true)
  assert.equal(await hasTextLayer(docWith(['长'.repeat(20), '长'.repeat(20), '长'.repeat(20)])), true)
})
