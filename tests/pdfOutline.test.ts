/**
 * PDF 目录解析的单测（只打纯函数，不碰 pdf.js 本体）。
 *
 * 四条底线：章级和节级要分清、两位数与双空格要认、文字层兜底扫不到就是空数组、
 * 对不上主题就是 null——不许猜，也不许抛。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chapterEntriesFromOutline,
  chaptersFromTextLines,
  chapterNumberOf,
  isChapterTitle,
  toBook,
} from '../src/course/pdfOutline.ts'

test('书签树里只挑章级：两位数第10章要认，4.3 与 13.2.1 这类节级要滤掉', () => {
  const tree = [
    {
      title: '目录',
      items: [
        { title: '第1章  绪论', items: [{ title: '1.1 通信系统的组成' }] },
        { title: '第10章　信源编码', items: [{ title: '10.3 量化' }] },
        { title: '4.3 恒参信道' },
        { title: '13.2.1 载波同步的方法' },
        { title: 'Chapter 12  Orthogonal codes' },
      ],
    },
  ]
  const entries = chapterEntriesFromOutline(tree)
  assert.deepEqual(
    entries.map((entry) => entry.rawTitle),
    ['第1章  绪论', '第10章　信源编码', 'Chapter 12  Orthogonal codes'],
  )
  // 章级条目一律不在这里解页码，页码留给拿得到 doc 的那一层。
  for (const entry of entries) assert.equal(entry.page, null)

  assert.equal(isChapterTitle('4.3 恒参信道'), false)
  assert.equal(isChapterTitle('13.2.1 载波同步的方法'), false)
  assert.equal(isChapterTitle('Chapter 12  Orthogonal codes'), true)
})

test('章号与章名之间允许空格，两位数和中文数字都要读对', () => {
  assert.equal(chapterNumberOf('第10章  信源编码'), 10)
  assert.equal(chapterNumberOf('第 5 章　模拟调制系统'), 5)
  assert.equal(chapterNumberOf('第十章 同步原理'), 10)
  assert.equal(chapterNumberOf('Chapter 12  Orthogonal codes'), 12)
  assert.equal(chapterNumberOf('4.3 恒参信道'), null)
  assert.equal(chapterNumberOf('13.2.1 载波同步的方法'), null)
  assert.equal(chapterNumberOf('这部分不是章'), null)
})

test('书签不可用时退到文字层：混了噪声行也只捞出那三章', () => {
  const lines = [
    '本书目录',
    '第2章  确知信号',
    '2.1 信号的分类',
    '第8章  新型数字带通调制技术',
    'Chapter 12  Orthogonal codes',
    '随便一行噪声',
    '第2章  确知信号',
  ]
  const entries = chaptersFromTextLines(lines)
  assert.deepEqual(
    entries.map((entry) => entry.rawTitle),
    ['第2章  确知信号', '第8章  新型数字带通调制技术', 'Chapter 12  Orthogonal codes'],
  )
})

test('对不上主题就留 null，不猜也不抛', () => {
  const book = toBook([
    { rawTitle: '第3章  随机过程', page: 51 },
    { rawTitle: '第99章  宇宙通信概论', page: null },
  ])
  assert.equal(book.chapters[0].no, 3)
  assert.equal(book.chapters[0].topicId, '3')
  assert.equal(book.chapters[0].page, 51)
  assert.equal(book.chapters[1].no, 99)
  assert.equal(book.chapters[1].topicId, null)
  assert.equal(book.chapters[1].page, null)
})

test('页码读不出来时按 null 传下去，不抛异常', () => {
  const book = toBook([{ rawTitle: 'Chapter 7  数字带通传输系统', page: null }])
  assert.equal(book.chapters.length, 1)
  assert.equal(book.chapters[0].page, null)
  assert.equal(book.chapters[0].topicId, '7')
})

test('空输入返回空数组', () => {
  assert.deepEqual(chapterEntriesFromOutline(null), [])
  assert.deepEqual(chapterEntriesFromOutline([]), [])
  assert.deepEqual(chaptersFromTextLines([]), [])
  assert.deepEqual(toBook([]).chapters, [])
  assert.deepEqual(chapterEntriesFromOutline(undefined), [])
})
