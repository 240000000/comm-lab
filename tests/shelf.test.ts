/**
 * 书架的单测。
 *
 * 书架是「导入教材」变成主入口之后的那层内存状态：默认那本通信原理常驻，
 * 导入的书只活在这一次会话里。这里钉住四件事——账单的 N/M/N−M 必须能自己算、
 * 认不出来的章只有一句统一说明（不许写空话）、增删切换不会把默认那本弄丢、
 * 书的编号不撞车。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_BOOK_ID,
  MISSING_MATCH,
  UNCOVERED_NOTE,
  addBook,
  billOf,
  bookById,
  bookFromOutline,
  defaultShelfBook,
  evidenceOf,
  isPlayable,
  nextBookId,
  removeBook,
} from '../src/course/shelf.ts'
import { matchChapter } from '../src/course/match.ts'
import { BOOK_COMMUNICATION } from '../src/course/syllabus.ts'
import type { OutlinedBook } from '../src/course/pdfOutline.ts'

/** 把一串章名当成一本「目录里只有这些」的书，走真实的匹配器。 */
function outlineOf(rawTitles: string[]): OutlinedBook {
  return {
    id: 'probe',
    title: '靶子书',
    chapters: rawTitles.map((rawTitle, index) => {
      const hit = matchChapter(rawTitle)
      return {
        no: index + 1,
        rawTitle,
        topicId: hit ? hit.topicId : null,
        hits: hit ? hit.hits : [],
        page: index + 1,
      }
    }),
  }
}

test('默认书架：13 章全都能玩，账单是 13 / 13 / 0', () => {
  const book = defaultShelfBook()
  assert.equal(book.id, DEFAULT_BOOK_ID)
  assert.equal(book.chapters.length, 13)
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.rawTitle),
    BOOK_COMMUNICATION.chapters.map((chapter) => chapter.rawTitle),
  )
  assert.ok(book.chapters.every((chapter) => isPlayable(chapter)))
  assert.deepEqual(billOf(book), { total: 13, playable: 13, uncovered: 0 })
})

test('靶子书 9 个章名：账单 9 / 2 / 7，只有抽样定理与信号分析认到', () => {
  const book = bookFromOutline(
    '靶子书',
    outlineOf([
      '连续时间系统的时域分析',
      '傅里叶变换',
      '拉普拉斯变换',
      'z 变换',
      '离散信号与系统',
      '系统的频域分析',
      '状态变量分析',
      '抽样定理',
      '信号分析',
    ]),
    'chal',
  )

  assert.equal(book.chapters.length, 9)
  assert.deepEqual(billOf(book), { total: 9, playable: 2, uncovered: 7 })

  const sampled = book.chapters.find((chapter) => chapter.rawTitle === '抽样定理')
  assert.ok(sampled, '抽样定理那一章没进书架')
  assert.equal(sampled!.topicId, '10')
  assert.ok(sampled!.hits.includes('抽样定理'), `hits 应记下认出来的词，实际 ${sampled!.hits.join('/')}`)
  assert.ok(evidenceOf(sampled!).startsWith('→'), '认到的章要写清映射到哪一章')
  assert.ok(evidenceOf(sampled!).includes('抽样定理'), '匹配证据里要把凭的词写出来')

  for (const chapter of book.chapters) {
    if (isPlayable(chapter)) continue
    assert.equal(chapter.topicId, null)
    assert.equal(evidenceOf(chapter), MISSING_MATCH)
  }
})

test('认不出来的章只有一句统一说明，不写「即将支持」这类空话', () => {
  assert.equal(UNCOVERED_NOTE, '本书这部分暂未覆盖，识别不出来的章不提供只能看的假仿真。')
  assert.equal(MISSING_MATCH, '未识别到对应模型')
  for (const word of ['即将支持', '敬请期待', '后续版本', '正在开发']) {
    assert.ok(!UNCOVERED_NOTE.includes(word), `说明里不该出现「${word}」`)
    assert.ok(!MISSING_MATCH.includes(word), `说明里不该出现「${word}」`)
  }
  // 中文一句话：句号只出现一次，且结尾就是它。
  assert.equal(UNCOVERED_NOTE.split('。').length, 2)
  assert.ok(UNCOVERED_NOTE.endsWith('。'))
})

test('书架增删：同 id 换掉不重复，新书排末尾，默认那本删不掉', () => {
  const base = [defaultShelfBook()]
  const a = bookFromOutline('A 书', outlineOf(['抽样定理']), 'a')
  const b = bookFromOutline('B 书', outlineOf(['信号分析']), 'b')

  const two = addBook(base, a)
  assert.equal(two.length, 2)
  assert.equal(two[1].id, 'a')

  const replaced = addBook(two, { ...a, title: 'A 书（改过名）' })
  assert.equal(replaced.length, 2)
  assert.equal(replaced[1].title, 'A 书（改过名）')

  const three = addBook(replaced, b)
  assert.equal(three.length, 3)
  assert.equal(three[2].id, 'b')

  const withoutDefault = removeBook(three, DEFAULT_BOOK_ID)
  assert.equal(withoutDefault.length, 3, '默认那本不许删')
  assert.equal(withoutDefault[0].id, DEFAULT_BOOK_ID)

  const withoutA = removeBook(three, 'a')
  assert.deepEqual(
    withoutA.map((book) => book.id),
    [DEFAULT_BOOK_ID, 'b'],
  )

  // 删到一本也不剩时回原样，界面不会出现「书架空了」这种状态。
  assert.deepEqual(removeBook([a], 'a').map((book) => book.id), ['a'])
})

test('切换找得到书；找不到就退回第一本，编号不撞车', () => {
  const shelf = addBook(addBook([defaultShelfBook()], bookFromOutline('A', outlineOf(['抽样定理']), 'a')), bookFromOutline('B', outlineOf(['信号分析']), 'b'))

  assert.equal(bookById(shelf, 'b').title, 'B')
  assert.equal(bookById(shelf, 'nope').id, DEFAULT_BOOK_ID)
  assert.equal(bookById(shelf, null).id, DEFAULT_BOOK_ID)

  const id = nextBookId(shelf)
  assert.ok(!shelf.some((book) => book.id === id), `新编号 ${id} 与已有书撞了`)

  // 真的把这本书加进去之后，下一个编号还得是新的——不能出现两本同 id。
  const grown = addBook(shelf, { ...shelf[1], id })
  const id2 = nextBookId(grown)
  assert.notEqual(id2, id)
  assert.ok(!grown.some((book) => book.id === id2), `新编号 ${id2} 与已有书撞了`)
})

test('从目录转成书架条目：保留 topicId 与 hits，不把页码带进内存书架', () => {
  const book = bookFromOutline('靶子书', outlineOf(['抽样定理', '傅里叶变换']), 'chal')
  const [first, second] = book.chapters

  assert.equal(first.no, 1)
  assert.equal(first.rawTitle, '抽样定理')
  assert.equal(first.topicId, '10')
  assert.deepEqual(first.hits, ['抽样定理'])
  assert.ok(!('page' in first), '页码只用于预览，不该留在书架里')

  assert.equal(second.topicId, null)
  assert.deepEqual(second.hits, [])
  assert.equal(evidenceOf(second), MISSING_MATCH)
})
