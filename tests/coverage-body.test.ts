/**
 * R126：覆盖判定先读正文、标题只兜底——这三条测试是它的反例守卫。
 *
 * 1) 正文对得上的书：13 条功能全部由正文认定，来源都是 body；
 * 2) 与通信无关的书：一条都不许认（0 覆盖），标题再像也不算；
 * 3) 两个功能分数咬得很近：margin 不够就判「本书未涉及」，不许硬挑一个。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { TOPICS, scoreBody } from '../src/course/concepts.ts'
import { attachTextLayer } from '../src/course/chapterBody.ts'
import { DEFAULT_BOOK_ID, bookFromSections, coverageOf, type ShelfBook } from '../src/course/shelf.ts'

type Section = { rawTitle: string; page: number; depth: number; chapterNo: number }

const CHAPTERS: Section[] = TOPICS.map((topic) => {
  const no = Number(topic.topicId.replace(/^ch/i, ''))
  // 章名故意写成中性词：这一轮要验的是正文，标题层的兜底不该参与。
  return { rawTitle: `第${no}章 第 ${no} 部分`, page: no * 5 - 4, depth: 0, chapterNo: no }
})

/** 每章 20 页，第 no 章的首页放它自己的概念词。 */
function pagesFor(textOf: (no: number) => string): string[] {
  const pages: string[] = []
  for (let no = 1; no <= TOPICS.length; no += 1) {
    const head = textOf(no)
    for (let offset = 0; offset < 5; offset += 1) {
      pages.push(offset === 0 ? head : `${head} 这一页继续讲同一个题目。`)
    }
  }
  return pages
}

function bookFromPages(pages: string[]): ShelfBook {
  const book = bookFromSections('测试教材', CHAPTERS, 'test-book')
  // 章号由标题里的「第 N 章」认；页码按目录给的走。
  return attachTextLayer(book, pages)
}

test('R126 正文对得上的书：26 个档位全部按正文认定', () => {
  const pages = pagesFor((no) => {
    const topic = TOPICS.find((item) => item.topicId === `ch${String(no).padStart(2, '0')}`)
    assert.ok(topic)
    return `${topic.title}。${topic.terms.slice(0, 6).join('，')}。`
  })
  const coverage = coverageOf(bookFromPages(pages))
  assert.equal(coverage.covered, 26)
  assert.equal(coverage.fromBody, 26)
  assert.equal(coverage.fromTitle, 0)
  for (const row of coverage.rows) {
    assert.equal(row.basis, 'body', `第 ${row.no} 章 ${row.preset} 档应该由正文认定`)
  }
})

test('R126 无关的书：一条都不认，覆盖数是 0', () => {
  const unrelated = [
    '第 1 章 预算管理',
    '预算是把未来一年的花销先摊开。应收账款、固定资产、现金流量表、资产负债表，这些词在这本书里反复出现。',
    '第 2 章 财务报表',
    '报表要看三张：资产负债表、利润表、现金流量表。审计意见写在附注里。',
  ].join('\n')
  const pages = pagesFor(() => unrelated)
  const coverage = coverageOf(bookFromPages(pages))
  assert.equal(coverage.covered, 0)
  assert.equal(coverage.fromBody, 0)
  assert.equal(coverage.missing, 26)
  for (const row of coverage.rows) assert.equal(row.basis, 'none')
})

test('R126 两个功能分数接近：margin 不够就判未涉及，不硬挑', () => {
  const qam = TOPICS.find((topic) => topic.topicId === 'ch02')
  const noise = TOPICS.find((topic) => topic.topicId === 'ch03')
  assert.ok(qam && noise)
  // 只挑对方词表里没有的词，各出现一次：两个功能分数一样，领先 0，低于 MIN_MARGIN，
  // 但单看最高分又够 MIN_SCORE —— 所以要判未涉及，正好卡在领先幅度这一条上。
  const only = (terms: string[], other: string[]) =>
    terms.filter((term) => !other.some((item) => item.includes(term) || term.includes(item))).slice(0, 3)
  const mixed = `${only(qam.terms, noise.terms).join('，')}；${only(noise.terms, qam.terms).join('，')}。`
  const probe = scoreBody(mixed)
  assert.ok(probe)
  assert.ok(probe.score >= 3, '最高分要够 MIN_SCORE，否则这条测试测不到领先幅度')
  assert.ok(probe.margin < 2, '两边的分数要咬得够近')
  // 只让这一页出现一次：分数与领先幅度都不该被重复次数放大。
  const pages: string[] = []
  for (let no = 1; no <= TOPICS.length; no += 1) {
    for (let offset = 0; offset < 5; offset += 1) {
      pages.push(no === 1 && offset === 0 ? mixed : '这一页讲别的内容，与那两个功能无关。')
    }
  }
  const coverage = coverageOf(bookFromPages(pages))
  const row2 = coverage.rows.find((row) => row.no === 2)
  const row3 = coverage.rows.find((row) => row.no === 3)
  assert.ok(row2 && row3)
  assert.equal(row2.basis, 'none')
  assert.equal(row3.basis, 'none')
})

test('R127 正文取样太薄：命中总次数不到 10 就降级成标题，并写明取样不足', () => {
  const topic = TOPICS[0]
  // 只放 6 个词、每个一次：分数够 3 分，但总次数 6 < 10 —— 这正是「目录页/整页图」
  // 那种薄样本长出来的假象，必须降级而不是认下。
  const thinText = topic.terms.slice(0, 6).join('，')
  const score = scoreBody(thinText)
  assert.ok(score)
  assert.ok(score.score >= 3, '分数本身要够，才验得到总次数这道闸')
  assert.ok(score.total < 10, '总次数必须低于 10')

  // 用内置书的 id：标题兜底只对「本来就有目录证据」的书开口，这里要验的是
  // 「正文太薄就降级」，不是「标题像不像」。
  const base = bookFromSections('测试教材', CHAPTERS, DEFAULT_BOOK_ID)
  const book: ShelfBook = {
    ...base,
    chapters: base.chapters.map((chapter) =>
      chapter.no === 1
        ? {
            ...chapter,
            topicId: '1',
            hits: [topic.terms[0]],
            body: { text: thinText, source: 'text-layer' as const, pages: 'p.1–1' },
          }
        : chapter,
    ),
  }
  const row = coverageOf(book).rows.find((item) => item.no === 1)
  assert.ok(row)
  assert.equal(row.basis, 'title', '总次数不够时不许按正文认下')
  assert.ok(row.title.startsWith('正文取样不足，仅按标题'), row.title)
})
