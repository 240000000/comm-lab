/**
 * R90：节名聚合的验收钉子。
 *
 * 这一组只测规则本身——投票阈值、抢主题的裁决、章名回退——不碰 pdf.js、不碰真书。
 * 真书跑出来的数（296 条书签命中几条、13 章映射有没有变）是探针的事，不是单测的事。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { matchChapter } from '../src/course/match.ts'
import { sectionEntriesFromOutline, sectionNumberOf } from '../src/course/pdfOutline.ts'
import { SECTION_MIN_HITS, assignTopics, groupSections, matchBySections } from '../src/course/sections.ts'
import { evidenceOf } from '../src/course/shelf.ts'

test('groupSections：只把挂在这一章下面的节收进来，章外的条目不塞给任何章', () => {
  const chapters = groupSections([
    { rawTitle: '第 5 章 模拟调制系统', depth: 0, chapterNo: 5 },
    { rawTitle: '5.1 幅度调制原理', depth: 1, chapterNo: 5 },
    { rawTitle: '5.1.1 双边带调幅', depth: 2, chapterNo: 5 },
    { rawTitle: '第 3 章 随机过程', depth: 0, chapterNo: 3 },
    { rawTitle: '3.1 平稳随机过程', depth: 1, chapterNo: 3 },
  ])
  assert.equal(chapters.length, 2)
  assert.deepEqual(chapters[0].sections, ['5.1 幅度调制原理', '5.1.1 双边带调幅'])
  assert.deepEqual(chapters[1].sections, ['3.1 平稳随机过程'])
})

test('matchBySections：同一主题要两条节名才认，只有一条不算数', () => {
  // 先确认这两条节名各自真的认到主题 5，否则下面比的就不是阈值。
  assert.equal(matchChapter('5.1 幅度调制原理')?.topicId, '5')
  assert.equal(matchChapter('5.2 调频波的频谱')?.topicId, '5')

  assert.equal(SECTION_MIN_HITS, 2)
  assert.equal(matchBySections(['5.1 幅度调制原理']), null, '一条节名不许认章')
  const two = matchBySections(['5.1 幅度调制原理', '5.2 调频波的频谱'])
  assert.equal(two?.topicId, '5')
  assert.equal(two?.count, 2)
  assert.deepEqual(two?.hits, ['5.1 幅度调制原理', '5.2 调频波的频谱'])
})

test('assignTopics：只有一条节名命中的章不许认章，退回章名；章名也不认就判未覆盖', () => {
  const rows = assignTopics([
    // 节名只命中一条（主题 5），章名「附录」认不出任何主题 → 必须未覆盖。
    { no: 9, rawTitle: '第九章 附录', sections: ['5.1 幅度调制原理'] },
    // 节名一条都没命中，但章名本身就是「随机过程」→ 走章名回退，老行为不变。
    { no: 3, rawTitle: '第三章 随机过程', sections: ['3.9 本章小结'] },
  ])
  assert.equal(rows[0].topicId, null)
  assert.equal(rows[0].by, 'none')
  assert.deepEqual(rows[0].sectionHits, [])

  assert.equal(rows[1].topicId, '3')
  assert.equal(rows[1].by, 'chapter')
  assert.deepEqual(rows[1].hits, ['随机过程'])
})

test('assignTopics：两章抢同一主题，命中条数多者得（票数优先于章号）', () => {
  const rows = assignTopics([
    // 章号更小、票数更少：抢不过下面的，章名「附录」又认不出 → 未覆盖。
    { no: 1, rawTitle: '第一章 附录', sections: ['5.1 幅度调制原理', '5.2 调频波的频谱'] },
    {
      no: 8,
      rawTitle: '第八章 附录',
      sections: ['5.1 幅度调制原理', '5.2 调频波的频谱', '5.3 角度调制与解调'],
    },
  ])
  assert.equal(rows[1].topicId, '5')
  assert.equal(rows[1].by, 'section')
  assert.equal(rows[1].count, 3)
  assert.equal(rows[0].topicId, null)
  assert.equal(rows[0].by, 'none')
})

test('assignTopics：票数相同时按章号小者得，章号相同按目录里先出现的得', () => {
  const tie = assignTopics([
    { no: 7, rawTitle: '第七章 附录', sections: ['2.1 确知信号的定义', '2.2 确知信号的频谱'] },
    { no: 4, rawTitle: '第四章 附录', sections: ['2.3 确知信号的分类', '2.4 确知信号的能量'] },
  ])
  // 两条节名都指向主题 2（确知信号），票数 2:2 → 章号小的第 4 章拿走。
  assert.equal(tie[1].topicId, '2')
  assert.equal(tie[1].by, 'section')
  assert.equal(tie[0].topicId, null)

  const sameNo = assignTopics([
    { no: null, rawTitle: '附录甲', sections: ['2.1 确知信号的定义', '2.2 确知信号的频谱'] },
    { no: null, rawTitle: '附录乙', sections: ['2.3 确知信号的分类', '2.4 确知信号的能量'] },
  ])
  assert.equal(sameNo[0].topicId, '2', '都没章号时先出现的得')
  assert.equal(sameNo[1].topicId, null)
})

test('evidenceOf：节名认的章要把触发它的节名原文印出来，章名认的仍旧印关键词', () => {
  const bySection = evidenceOf({
    no: 5,
    rawTitle: '第 5 章 模拟调制系统',
    topicId: '5',
    hits: [],
    sectionHits: ['5.4.3 小信噪比时的门限效应'],
  })
  assert.equal(bySection, '→ 模拟调制系统，节名命中「5.4.3 小信噪比时的门限效应」')

  const byChapter = evidenceOf({ no: 3, rawTitle: '第三章 随机过程', topicId: '3', hits: ['随机过程'] })
  assert.equal(byChapter, '→ 随机过程，命中「随机过程」')
})

test('sectionNumberOf：编号才知道节归哪章，没编号的（本章小结 / 章标题）一律 null', () => {
  assert.deepEqual(sectionNumberOf('5.4.3 小信噪比时的门限效应'), { chapterNo: 5, depth: 2 })
  assert.deepEqual(sectionNumberOf('5.1 幅度调制原理'), { chapterNo: 5, depth: 1 })
  assert.deepEqual(sectionNumberOf('13.2.1 伪随机序列'), { chapterNo: 13, depth: 2 })
  assert.equal(sectionNumberOf('第5章 模拟调制系统'), null)
  assert.equal(sectionNumberOf('本章小结'), null)
})

test('sectionEntriesFromOutline：扁平书签（章与节都排在顶层）也要按编号归到章', () => {
  const entries = sectionEntriesFromOutline([
    { title: '封面' },
    { title: '第5章 模拟调制系统' },
    { title: '5.1 幅度调制原理' },
    { title: '5.2 调频波的频谱' },
    { title: '本章小结' },
  ])
  assert.deepEqual(entries.map((entry) => entry.depth), [2, 0, 1, 1, 2])
  assert.deepEqual(entries.map((entry) => entry.chapterNo), [null, 5, 5, 5, 5])
  assert.deepEqual(
    entries.map((entry) => entry.rawTitle),
    ['封面', '第5章 模拟调制系统', '5.1 幅度调制原理', '5.2 调频波的频谱', '本章小结'],
  )
})
