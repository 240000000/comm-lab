import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cachedPageText,
  ocrCacheKey,
  recognizePages,
} from '../src/course/ocr.ts'
import {
  findTocPage,
  parseTocEntries,
  printedToPdfPage,
  mapPrintedPages,
} from '../src/course/outlineOcr.ts'

test('目录页选择：前 12 页里挑有「目录」和章名的那页', () => {
  const pages = [
    '封面 通信原理',
    '目 录\n第1章 绪论 …… 1\n1.1 通信系统的组成 …… 3',
    '第 1 章 绪论\n正文……',
  ]
  assert.equal(findTocPage(pages), 2)
  assert.equal(findTocPage(['封面', '也没有']), -1)
  const thirteen = Array.from({ length: 13 }, (_, index) =>
    index === 12 ? '目 录\n第1章 绪论 …… 1' : '正文',
  )
  assert.equal(findTocPage(thirteen, 12), -1, '只扫前 12 页')
})

test('目录行解析：章、节、小节和印在书上的页码', () => {
  const text = [
    '目 录',
    '第1章 绪论 ……… 1',
    '1.1 通信系统的组成 …… 3',
    '12.3.1 抽样定理 ...... 301',
    '第 2 章 信道 …… 25',
  ].join('\n')
  const entries = parseTocEntries(text)
  assert.equal(entries.length, 4)
  assert.deepEqual(entries[0], { rawTitle: '第 1 章 绪论', page: 1, depth: 0, chapterNo: 1 })
  assert.equal(entries[1].depth, 1)
  assert.equal(entries[1].chapterNo, 1)
  assert.equal(entries[1].page, 3)
  assert.equal(entries[2].depth, 2)
  assert.equal(entries[2].chapterNo, 12)
  assert.equal(entries[2].page, 301)
  assert.equal(entries[3].chapterNo, 2)
  assert.equal(entries[3].page, 25)
})

test('页码换算：书内页码 + 偏移量，最小夹到 1', () => {
  assert.equal(printedToPdfPage(130, 15), 145)
  assert.equal(printedToPdfPage(1, 15), 16)
  assert.equal(printedToPdfPage(0, -5), 1)
  const mapped = mapPrintedPages(
    [{ rawTitle: '第 6 章 数字调制', page: 130, depth: 0, chapterNo: 6 }],
    15,
  )
  assert.equal(mapped[0].page, 145)
})

test('识别结果缓存：命中就读、读不到或读错都当没命中', async () => {
  assert.equal(ocrCacheKey('book-a', 7), 'book-a:7')
  assert.equal(await cachedPageText('book-a:7', async () => '第 7 页的目录'), '第 7 页的目录')
  assert.equal(await cachedPageText('book-a:8', async () => null), null)
  assert.equal(
    await cachedPageText('book-a:9', async () => {
      throw new Error('db 挂了')
    }),
    null,
  )
})

test('缓存全命中时不再起引擎、不读 PDF', async () => {
  const outcome = await recognizePages(
    new Blob([]),
    [1, 2],
    undefined,
    {
      bookId: 'book-a',
      cacheRead: async (key) => (key.endsWith(':1') ? '第一页' : '第二页'),
      cacheWrite: async () => {},
    },
  )
  assert.equal(outcome.ok, true)
  if (outcome.ok) {
    assert.equal(outcome.cachedPages, 2)
    assert.deepEqual(outcome.pages.map((page) => page.text), ['第一页', '第二页'])
  }
})
