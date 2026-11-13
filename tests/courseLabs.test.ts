/**
 * 深度实验台入口的守卫。
 *
 * 1.6 表「实验台入口」那一列是 check-docs 从 `src/core/course.ts` 的 labs 现算的，
 * 所以文档跟着数据走；这条测试反过来把表里那几格的意思钉成字面量——
 * 数据一侧少写了 labs、或 href 换成别的路由，这里直接红。
 *
 * 它测不出「界面上有没有按钮」（那件事靠截图验收），但至少钉住数据与文档两头不再各漂各的：
 * 表里非「—」的章，必须真有对应实验台，且只指向已经存在的三个交互页。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COURSE_CHAPTERS, chapterByNo } from '../src/core/course.ts'

/** 抄自 docs/tech-report.md 1.6 表「实验台入口」列；「—」写成空数组。 */
const TABLE_LABS: Record<number, string[]> = {
  1: [],
  2: [],
  3: [],
  4: ['#/ofdm'],
  5: [],
  6: [],
  7: [],
  8: ['#/qam', '#/ofdm'],
  9: [],
  10: [],
  11: ['#/conv'],
  12: [],
  13: [],
}

/** 站内确实存在的实验台路由（`src/router.ts` 认得的那几个）。 */
const LAB_ROUTES = ['#/ofdm', '#/qam', '#/conv']

test('1.6 表里非「—」的章，labs 必须与表逐条对上', () => {
  for (const [no, hrefs] of Object.entries(TABLE_LABS)) {
    const chapter = chapterByNo(Number(no))
    assert.ok(chapter, `第 ${no} 章不存在`)
    const actual = (chapter.labs ?? []).map((lab) => lab.href)
    assert.deepEqual(actual, hrefs, `第 ${no} 章的实验台入口与 1.6 表对不上`)
  }
})

test('实验台入口只指向三个已存在的交互页', () => {
  const hrefs = COURSE_CHAPTERS.flatMap((chapter) => (chapter.labs ?? []).map((lab) => lab.href))
  // 表里三章共四个入口：第 4 章一个、第 8 章两个、第 11 章一个。
  assert.deepEqual(hrefs, ['#/ofdm', '#/qam', '#/ofdm', '#/conv'])
  for (const href of hrefs) assert.ok(LAB_ROUTES.includes(href), `${href} 不是实验台路由`)
})

test('每个入口都带一句人话名字，按钮上才不会只剩个箭头', () => {
  for (const chapter of COURSE_CHAPTERS) {
    for (const lab of chapter.labs ?? []) {
      assert.ok(lab.label.trim().length >= 2, `第 ${chapter.no} 章的实验台没有名字`)
      assert.ok(!lab.label.startsWith('去'), `第 ${chapter.no} 章的实验台名字重复了「去」`)
    }
  }
})
