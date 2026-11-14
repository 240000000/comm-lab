import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cachedPageText,
  ocrCacheKey,
  recognizePages,
} from '../src/course/ocr.ts'
import {
  findTocPage,
  parseTocChapters,
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

test('扫描件目录：按 N.1 跨页定章，不认被认错的「第 针 章」', () => {
  const pages = [
    '目 录\n1.1 通信系统的组成 3\n1.2 通信系统的分类 6',
    '第 针 章 随机 过 程 .36\n2.1 随机过程的基本概念 38',
    '2.2 平稳随机过程 40\n3.1 随机过程通过线性系统 51',
    '第 $ 章 模拟 调制 系统 PP 86\n4.1 幅度调制的原理 88',
    '5.1 线性调制系统的抗噪声性能 101\n6.1 数字基带传输概述 130',
    '7.1 二进制数字调制原理 191\n8.1 正交振幅调制 243',
    '9.1 数字信号的统计特性 265\n10.1 引言 294',
    '11.1 差错控制编码 346\n12.1 伪随机序列 394',
    '13.1 同步的基本概念 425',
  ]
  const entries = parseTocChapters(pages)
  assert.equal(entries.length, 13)
  assert.deepEqual(entries.map((entry) => entry.chapterNo), Array.from({ length: 13 }, (_, i) => i + 1))
  assert.deepEqual(entries.map((entry) => entry.page), [3, 38, 51, 88, 101, 130, 191, 243, 265, 294, 346, 394, 425])
  const mapped = mapPrintedPages(entries, 5)
  assert.equal(mapped[0].page, 8)
})

test('扫描件目录：N.1.1 这样的子节不算章起点', () => {
  const entries = parseTocChapters(['1.1.1 通信的发展 2\n1.1 通信系统的组成 3'])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].page, 3)
})

test('扫描件目录：N.1 行整行被认坏时，用「第 N 章」兜底并允许页码为空', () => {
  const pages = [
    '1.1 通信系统的组成\n', // 页码在下一行，且没有「第 1 章」这一行
    '3',
    '4.2 信道的数学模型 88\n第 $ 章 模拟调制系统 86', // 4.1 整行丢了，只有错认的章号
    '第 4 章 信道 88\n5.1 线性调制 101',
  ]
  const entries = parseTocChapters(pages)
  const four = entries.find((entry) => entry.chapterNo === 4)
  assert.ok(four)
  assert.equal(four?.page, 88)
  const one = entries.find((entry) => entry.chapterNo === 1)
  assert.equal(one?.page, 3)
})

test('扫描件目录：兜底认出的页码比前一章还小，就当没认出来', () => {
  const pages = ['1.1 绪论 3\n2.1 确知信号 17\n3.1 随机过程 36\n4.2 信道 8\n5.1 模拟调制 86']
  const entries = parseTocChapters(pages)
  assert.deepEqual(entries.map((entry) => entry.page), [3, 17, 36, null, 86])
})
