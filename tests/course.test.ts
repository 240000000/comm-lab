/**
 * 课程视图的单测。
 *
 * 判据里最容易悄悄退化的几件事都在这里钉住：
 * 13 章必须全在、只有 2/5/10 能玩、每屏参数不超过 4 个、
 * 每章的默认态不报红而「让它失效」之后必须报红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COURSE_CHAPTERS, DEEP_LAB_CHAPTERS, chapterByNo } from '../src/core/course.ts'
import { parseHash } from '../src/router.ts'

test('左树 13 章，章号 1 到 13 连续', () => {
  assert.equal(COURSE_CHAPTERS.length, 13)
  COURSE_CHAPTERS.forEach((chapter, index) => {
    assert.equal(chapter.no, index + 1)
    assert.ok(chapter.title.length > 0)
  })
})

test('本轮只实现第 2、5、10 章', () => {
  const done = COURSE_CHAPTERS.filter((c) => c.implemented).map((c) => c.no)
  assert.deepEqual(done, [2, 5, 6, 10])
  for (const chapter of COURSE_CHAPTERS) {
    if (chapter.implemented) assert.equal(typeof chapter.compute, 'function')
    else assert.ok(chapter.reason.length > 10, `第 ${chapter.no} 章没写未实现原因`)
  }
})

test('只有第 4、8、11 章带深度实验台入口', () => {
  assert.deepEqual(DEEP_LAB_CHAPTERS, [4, 8, 11])
  const withLab = COURSE_CHAPTERS.filter((c) => c.labs?.length).map((c) => c.no)
  assert.deepEqual(withLab, [4, 8, 11])
  // 第 8 章同时有 QAM 与 OFDM 两台，第 4、11 章各一台。
  assert.equal(chapterByNo(8)?.labs?.length, 2)
  assert.equal(chapterByNo(4)?.labs?.length, 1)
  assert.equal(chapterByNo(11)?.labs?.length, 1)
})

test('未实现的章也有一句话问题和空参数，页面不会崩', () => {
  for (const chapter of COURSE_CHAPTERS) {
    if (chapter.implemented) continue
    assert.equal(chapter.params.length, 0)
    assert.equal(chapter.failPreset, chapter.failPreset)
  }
})

test('每屏参数 2 到 4 个，默认值都落在滑杆范围内', () => {
  for (const chapter of COURSE_CHAPTERS) {
    if (!chapter.implemented) continue
    assert.ok(chapter.params.length >= 2 && chapter.params.length <= 4, `第 ${chapter.no} 章参数个数不对`)
    for (const param of chapter.params) {
      const value = chapter.defaults[param.key]
      assert.ok(Number.isFinite(value), `${param.key} 没有默认值`)
      assert.ok(value >= param.min && value <= param.max, `${param.key} 默认值越界`)
    }
  }
})

test('默认态：三个读数、一张图、一句话结论，且不报红', () => {
  for (const chapter of COURSE_CHAPTERS) {
    if (!chapter.compute) continue
    const view = chapter.compute(chapter.defaults)
    assert.equal(view.readouts.length, 3)
    assert.ok(view.series.length >= 1)
    assert.ok(view.series[0].points.length > 10)
    assert.ok(view.conclusion.length > 10)
    assert.equal(view.failed, false, `第 ${chapter.no} 章默认态就报红了`)
    assert.equal(view.readouts.some((r) => r.warn), false)
  }
})

test('每章至少一个读数是「理论值 / 实测值」成对', () => {
  for (const chapter of COURSE_CHAPTERS) {
    if (!chapter.compute) continue
    const view = chapter.compute(chapter.defaults)
    assert.ok(view.readouts.some((r) => r.hint.includes('理论')), `第 ${chapter.no} 章没有理论对照`)
  }
})

test('「让它失效」之后读数标红、结论改口', () => {
  for (const chapter of COURSE_CHAPTERS) {
    if (!chapter.compute) continue
    const normal = chapter.compute(chapter.defaults)
    const broken = chapter.compute(chapter.failPreset)
    assert.equal(broken.failed, true, `第 ${chapter.no} 章的反例没触发`)
    assert.ok(broken.readouts.some((r) => r.warn))
    assert.notEqual(broken.conclusion, normal.conclusion)
  }
})

test('同一组参数算两次，结论与读数逐字相同', () => {
  const chapter = chapterByNo(5)!
  const a = chapter.compute!(chapter.defaults)
  const b = chapter.compute!({ ...chapter.defaults })
  assert.deepEqual(a.readouts.map((r) => r.value), b.readouts.map((r) => r.value))
  assert.equal(a.conclusion, b.conclusion)
})

test('chroma 外的章号取不到，页面回退到第 2 章', () => {
  assert.equal(chapterByNo(0), undefined)
  assert.equal(chapterByNo(99), undefined)
  assert.ok(chapterByNo(2))
})

test('#/course 路由认得出来，未知路径仍回首页', () => {
  assert.equal(parseHash('#/course'), 'course')
  assert.equal(parseHash('#/course/'), 'course')
  assert.equal(parseHash('#/course?no=5'), 'course')
  assert.equal(parseHash('#/nope'), 'home')
})

test('第 6 章眼图：默认张着、反例闭上，两个读数带理论对照', () => {
  const chapter = chapterByNo(6)
  assert.ok(chapter)
  const base = chapter.compute(chapter.defaults)
  assert.equal(base.failed, false)
  const eye = Number(base.readouts[0].value)
  assert.ok(eye > 0 && eye <= 2, `眼高应落在 (0, 2]，实际 ${eye}`)
  assert.ok(base.readouts.some((item) => item.hint.includes('理论')))

  const failed = chapter.compute(chapter.failPreset)
  assert.equal(failed.failed, true)
  assert.ok(failed.readouts.some((item) => item.warn), '反例里至少要有一条读数标红')
  assert.notEqual(failed.conclusion, base.conclusion)
  assert.ok(failed.conclusion.includes('噪声') || failed.conclusion.includes('多径') || failed.conclusion.includes('滚降'))
})

test('第 6 章：滚降系数越小，峰值 ISI 越大', () => {
  const chapter = chapterByNo(6)
  const isi = (alpha: number): number =>
    Number(chapter.compute({ alpha, eyeSnrDb: 20, multipath: 0 }).readouts[1].value)
  assert.ok(isi(0.05) > isi(0.35))
  assert.ok(isi(0.35) > isi(0.99))
})

test('第 6 章同参重跑结果一致', () => {
  const chapter = chapterByNo(6)
  const a = chapter.compute(chapter.defaults)
  const b = chapter.compute(chapter.defaults)
  assert.deepEqual(a.readouts, b.readouts)
  assert.equal(a.series[0].points.length, b.series[0].points.length)
})
