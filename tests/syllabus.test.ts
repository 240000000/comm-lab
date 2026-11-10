/**
 * 教材抽层的单测。
 *
 * 这里钉三件事：
 * 1. 目录本身自洽——13 章、序号连续、原名不带前缀、topicId 与章号一致；
 * 2. 抽出来的目录和 course.ts 对得上——每个 topicId 都能找到那一章；
 * 3. 抽层没有偷偷改变行为——13 章默认参数下的读数逐字不变。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BOOK_COMMUNICATION, type BookChapter } from '../src/course/syllabus.ts'
import { COURSE_CHAPTERS, chapterByNo } from '../src/core/course.ts'

/** 教材 13 章的原名，照抄教材，不带「第N章」。 */
const RAW_TITLES = [
  '绪论',
  '确知信号',
  '随机过程',
  '信道',
  '模拟调制系统',
  '数字基带传输系统',
  '数字带通传输系统',
  '新型数字带通调制技术',
  '数字信号的最佳接收',
  '信源编码',
  '差错控制编码',
  '正交编码与伪随机序列',
  '同步原理',
]

/**
 * 13 章在默认参数下的读数，逐字抄自 R66 改动之前的实跑结果。
 * 这一层只是把目录搬了个家，任何一格读数变了都说明动到了计算。
 */
const GOLDEN_READOUTS: Array<{ no: number; readouts: string[]; failed: boolean }> = [
  { no: 1, readouts: ['单次信息量 I(p)=1.00 bit', '熵 H(p)=1.000 bit', '实测平均信息量=1.000 bit'], failed: false },
  { no: 2, readouts: ['自相关峰值 R(0)=1.5000', '对偶偏差=0（机器精度）', '相关峰宽度=1.50 ms'], failed: false },
  {
    no: 3,
    readouts: ['理论统计平均=0.000', '时间平均的实测标准差 σ_T=0.036', '带外比例（±4σ_T 之外）=0.0 %'],
    failed: false,
  },
  {
    no: 4,
    readouts: ['容量 C（kbit/s）=6.66 kbit/s', '频谱效率 C/B（bit/s/Hz）=6.658 bit/s/Hz', '占无限带宽极限=4.6 %'],
    failed: false,
  },
  { no: 5, readouts: ['占用带宽=3.00 kHz', '解调失真=0.0%', '输出信噪比=19.8 dB'], failed: false },
  {
    no: 6,
    readouts: ['眼高（实测）=1.70', '峰值 ISI（采样偏 0.00Ts）=0.000', '误码率（实测）=0（本批没出错）'],
    failed: false,
  },
  {
    no: 7,
    readouts: ['2PSK 理论误码率=1.91e-4', '实测误码率（20000 比特）=1.00e-4', '相对 2FSK 的增益=3.0 dB'],
    failed: false,
  },
  { no: 8, readouts: ['谱效率=2.96 bit/s/Hz', '理论误码率=1.39e-4', '实测误码率=1.50e-4'], failed: false },
  { no: 9, readouts: ['峰值信噪比（理论）=11.0 dB', '失配损失=0.00 dB', '误码率=1.91e-4'], failed: false },
  { no: 10, readouts: ['混叠误差=0.00e+0', '量化信噪比=49.99 dB', 'PCM 码率=32.0 kb/s'], failed: false },
  { no: 11, readouts: ['最小距离 d=3', '可纠位数 t=1', '正确率（e = 1）=100.0%'], failed: false },
  {
    no: 12,
    readouts: [
      '周期 N=127',
      '峰值自相关=1.0000',
      '最大旁瓣=-0.0079',
      '平衡性（1 的个数 − 0 的个数）=1',
      '当前延迟 τ 的 R(τ)=1.0000',
      '序列前 8 位=11111110',
    ],
    failed: false,
  },
  { no: 13, readouts: ['剩余相位误差（实测 / 理论）=0.000 / 0.000', '收敛步数=7', '环路锁定=锁住'], failed: false },
]

test('教材目录：13 章、序号连续、原名是教材原字', () => {
  const chapters: BookChapter[] = BOOK_COMMUNICATION.chapters
  assert.equal(chapters.length, 13)
  assert.equal(BOOK_COMMUNICATION.title, '通信原理')
  assert.equal(BOOK_COMMUNICATION.id, 'communication-principles')

  chapters.forEach((chapter, index) => {
    assert.equal(chapter.no, index + 1, `第 ${index + 1} 条的章号应连续`)
    assert.equal(chapter.rawTitle, RAW_TITLES[index])
    // 原名是教材原字：不带「第N章」前缀，也没有首尾空白。
    assert.equal(chapter.rawTitle, chapter.rawTitle.trim())
    assert.doesNotMatch(chapter.rawTitle, /^第[一二三四五六七八九十百零〇\d]+章/)
    // topicId 就是 course.ts 里那一章的 no，不另造命名空间。
    assert.equal(chapter.topicId, String(chapter.no))
  })

  // 章名不许重复，否则按名字回溯会撞车。
  assert.equal(new Set(chapters.map((chapter) => chapter.rawTitle)).size, 13)
  assert.equal(new Set(chapters.map((chapter) => chapter.topicId)).size, 13)
})

test('教材目录与课程视图对得上：每个 topicId 都能找到那一章', () => {
  assert.equal(BOOK_COMMUNICATION.chapters.length, COURSE_CHAPTERS.length)

  for (const chapter of BOOK_COMMUNICATION.chapters) {
    const target = chapterByNo(Number(chapter.topicId))
    assert.ok(target, `topicId ${chapter.topicId} 在 course.ts 里找不到`)
    assert.equal(target!.no, chapter.no)
    // course.ts 的标题是教材原名的缩写（「模拟调制」对「模拟调制系统」），必须真是前缀。
    assert.ok(
      chapter.rawTitle.startsWith(target!.title),
      `「${target!.title}」不是「${chapter.rawTitle}」的前缀`,
    )
  }
})

test('抽层没有改变行为：13 章默认参数下的读数逐字不变', () => {
  const actual = COURSE_CHAPTERS.map((chapter) => {
    const view = chapter.compute(chapter.defaults)
    return {
      no: chapter.no,
      readouts: view.readouts.map((readout) => `${readout.label}=${readout.value}`),
      failed: view.failed,
    }
  })

  assert.deepEqual(actual, GOLDEN_READOUTS)
})
