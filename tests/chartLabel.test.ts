import assert from 'node:assert/strict'
import test from 'node:test'
import { chartLabel } from '../src/labs/chartLabel.ts'

test('画布描述：带章号与章名，问句句尾的句号不念', () => {
  const label = chartLabel({
    no: 6,
    title: '数字基带传输系统',
    question: '眼图张开多大、判决门限怎么定？',
    readouts: [],
  })
  assert.ok(label.startsWith('第 6 章 · 数字基带传输系统：'))
  assert.ok(label.includes('眼图张开多大、判决门限怎么定'))
  // 问号已在问句里出现过，但句尾不允许再留一个标点
  assert.ok(!label.endsWith('？'))
  assert.ok(!label.endsWith('。'))
})

test('画布描述：含三个读数的名字与值', () => {
  const label = chartLabel({
    no: 9,
    title: '数字信号的最佳接收',
    question: '采样点上的信噪比剩多少',
    readouts: [
      { label: '采样点信噪比', value: '9.1 dB' },
      { label: '匹配滤波增益', value: '3.0 dB' },
      { label: '理论值', value: '11.0 dB' },
    ],
  })
  assert.ok(label.includes('；读数 '))
  assert.ok(label.includes('采样点信噪比 9.1 dB'))
  assert.ok(label.includes('匹配滤波增益 3.0 dB'))
  assert.ok(label.includes('理论值 11.0 dB'))
  // 三个读数之间用顿号，读屏器念起来有停顿
  assert.equal(label.split('、').length, 3)
})

test('画布描述：一位数章号不带前导零，空格与标点位置固定', () => {
  const label = chartLabel({
    no: 1,
    title: '绪论',
    question: '信息量到底怎么算。',
    readouts: [{ label: '单次信息量', value: '1.000 bit' }],
  })
  assert.equal(label, '第 1 章 · 绪论：信息量到底怎么算；读数 单次信息量 1.000 bit')
})