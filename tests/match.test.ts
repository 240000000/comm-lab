/**
 * 章名匹配的单测。
 *
 * 三组：教材 13 条原名必须各自回到自己那一章；20 条外来章名一半要映射对、
 * 一半必须老老实实返回 null；外加打分规则的几个边角（完全一致、长词优先、空串）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchChapter } from '../src/course/match.ts'
import { BOOK_COMMUNICATION } from '../src/course/syllabus.ts'

test('教材 13 条原名，逐条都能匹配回它自己的主题', () => {
  for (const chapter of BOOK_COMMUNICATION.chapters) {
    const hit = matchChapter(chapter.rawTitle)
    assert.ok(hit, `「${chapter.rawTitle}」没能匹配上`)
    assert.equal(hit!.topicId, chapter.topicId, `「${chapter.rawTitle}」匹配到了第 ${hit!.topicId} 章`)
    // 整条章名与关键词完全一致，拿的是最高档的分。
    assert.ok(hit!.score >= 1000, `「${chapter.rawTitle}」应拿到整条命中的加分，实际 ${hit!.score}`)
  }
})

test('20 条外来章名：10 条真章名映射对，10 条无关的必须返回 null', () => {
  // 三本书里能真映射到现有仿真的章名（《信号与系统》《信息论与编码》与通信原理的同义写法）。
  const mappable: Array<[string, string]> = [
    ['第三章 随机过程', '3'],
    ['信道模型与信道容量', '4'],
    ['调幅与调频', '5'],
    ['基带传输与眼图', '6'],
    ['数字频带传输', '7'],
    ['QAM 与 OFDM', '8'],
    ['匹配滤波器', '9'],
    ['抽样定理与 PCM', '10'],
    ['汉明码', '11'],
    ['载波同步与位同步', '13'],
  ]

  // 故意拿无关学科的章名，一条都不许误命中。
  const unrelated = [
    '操作系统概论',
    '财务报表分析',
    '线性代数初步',
    '微观经济学导论',
    '数据库系统原理',
    '计算机网络体系结构',
    '算法设计与分析',
    '大学物理实验',
    '英语听说教程',
    '化工原理',
  ]

  for (const [title, expected] of mappable) {
    const hit = matchChapter(title)
    assert.ok(hit, `「${title}」应该能匹配到第 ${expected} 章，实际返回 null`)
    assert.equal(hit!.topicId, expected, `「${title}」应匹配第 ${expected} 章`)
  }

  for (const title of unrelated) {
    assert.equal(matchChapter(title), null, `「${title}」与通信原理无关，不该匹配到任何一章`)
  }

  assert.equal(mappable.length + unrelated.length, 20)
})

test('打分规则：完全一致最高，长词压过短词，空输入不猜', () => {
  // 整条命中比部分命中分高。
  const exact = matchChapter('差错控制编码')
  const partial = matchChapter('差错控制')
  assert.ok(exact && partial)
  assert.ok(exact!.score > partial!.score)

  // 「信道编码」同时含「信道」与「信道编码」，长词赢，落到第 11 章而不是第 4 章。
  assert.equal(matchChapter('信道编码')?.topicId, '11')
  // 「最小频移键控」比「频移键控」长，落到第 8 章而不是第 7 章。
  assert.equal(matchChapter('最小频移键控')?.topicId, '8')

  // 空白与标点不影响判断，但空输入不许硬凑。
  assert.equal(matchChapter('  第 5 章 · 模拟调制系统  ')?.topicId, '5')
  assert.equal(matchChapter(''), null)
  assert.equal(matchChapter('   '), null)
})
