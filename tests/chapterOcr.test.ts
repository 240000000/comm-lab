import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TOPICS } from '../src/course/concepts.ts'
import { scanFromText, scoreChapterTexts } from '../src/course/chapterOcr.ts'
import { parseScanCache, scanCacheKey } from '../src/course/scanCache.ts'
import { findTocPage } from '../src/course/outlineOcr.ts'
import { stableBookId } from '../src/course/shelf.ts'

const toc = ['目录', ...Array.from({ length: 12 }, (_, i) => `第${i + 1}章 主题${i + 1} … ${(i + 1) * 10}`)].join('\n')

test('稳定书号：同文件同 id，换名字或换内容就换 id', async () => {
  const bytes = new Uint8Array(5000).fill(9)
  const a = await stableBookId('书.pdf', bytes)
  const b = await stableBookId('书.pdf', bytes)
  const c = await stableBookId('另一本.pdf', bytes)
  const d = await stableBookId('书.pdf', Uint8Array.from(bytes, (v, i) => (i === 10 ? 0 : v)))
  assert.equal(a.length, 16)
  assert.equal(a, b, '同一份文件必须落到同一个 id')
  assert.notEqual(a, c)
  assert.notEqual(a, d)
})

test('目录页扫描范围是前 20 页，不是前 12 页', () => {
  const pages = Array.from({ length: 20 }, () => '正文')
  pages[15] = toc
  assert.equal(findTocPage(pages), 16)
})

test('前 4 页出现高权重目录就早退', () => {
  const pages = Array.from({ length: 20 }, () => '正文')
  pages[0] = toc
  assert.equal(findTocPage(pages), 1)
})

test('没有目录页返回 -1', () => {
  assert.equal(findTocPage(Array.from({ length: 20 }, () => '正文')), -1)
})

test('正文打分：概念词够多就落到对应的实验', () => {
  const topic = TOPICS[0]
  const text = `${topic.terms.slice(0, 6).join('，')}。这一段在讲 ${topic.title}。`
  const scans = scoreChapterTexts(
    [{ no: 1, rawTitle: '第一章', topicId: '1', hits: [], page: 3 }],
    new Map([[1, text]]),
  )
  assert.equal(scans.length, 1)
  assert.equal(scans[0].chars > 0, true)
  assert.equal(scans[0].topicNo, Number(topic.topicId.replace(/^ch/i, '')))
  assert.equal(scans[0].hits.length > 0, true)
})

test('空正文不打分，也不进结果', () => {
  const scans = scoreChapterTexts(
    [{ no: 1, rawTitle: '第一章', topicId: '1', hits: [], page: 3 }],
    new Map([[1, '   \n  ']]),
  )
  assert.deepEqual(scans, [])
})

test('scanFromText 保留字数与耗时', () => {
  const scan = scanFromText(5, 42, '抽样 重建 频谱', 1234)
  assert.equal(scan.chapterNo, 5)
  assert.equal(scan.page, 42)
  assert.equal(scan.chars, 6)
  assert.equal(scan.ms, 1234)
})

test('章首页的节号优先于词频：5.1 就算正文全在讲通用词也判第 5 章', () => {
  const chapters = Array.from({ length: 13 }, (_, i) => ({
    no: i + 1,
    rawTitle: `第${i + 1}章`,
    topicId: String(i + 1),
    hits: [],
    page: 100 + i,
  }))
  const texts = new Map(
    chapters.map((chapter) => [
      chapter.no,
      `通信系统 调制 信道 噪声 ${chapter.no}.1 概述 第 1 章提到过信道`,
    ]),
  )
  const scans = scoreChapterTexts(chapters, texts)
  assert.deepEqual(
    scans.map((scan) => scan.topicNo),
    chapters.map((chapter) => chapter.no),
  )
})

test('没有节号时退回词频打分，不认「第 N 章」的交叉引用', () => {
  const topic = TOPICS[8]
  const text = `第 1 章提到过这件事。${topic.terms.slice(0, 6).join('，')}`
  const scans = scoreChapterTexts(
    [{ no: 9, rawTitle: '第九章', topicId: '9', hits: [], page: 265 }],
    new Map([[9, text]]),
  )
  assert.equal(scans[0].topicNo, Number(topic.topicId.replace(/^ch/i, '')))
})

test('扫描结果缓存：能原样读回，坏数据当没有', () => {
  const scans = [scanFromText(4, 78, '4.1 概述 模拟调制 载波 信噪比', 1200)]
  assert.equal(scanCacheKey('abc123'), 'scan:abc123')
  assert.deepEqual(parseScanCache(JSON.stringify(scans)), scans)
  assert.equal(parseScanCache(null), null, '没缓存')
  assert.equal(parseScanCache(''), null, '空串')
  assert.equal(parseScanCache('{'), null, '坏 JSON')
  assert.equal(parseScanCache('[]'), null, '空数组')
  assert.equal(parseScanCache('[{"chapterNo":4}]'), null, '缺页码与字数')
})
