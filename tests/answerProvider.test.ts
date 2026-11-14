import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractJson, parseModelAnswer } from '../src/answer/provider.ts'

const GOOD = {
  transcript: '某恒参信道带宽 3 kHz，S/N = 30 dB',
  headline: '信道容量 C ≈ 29.9 kbit/s',
  answer: '29.9 kbit/s',
  steps: ['C = B·log₂(1+S/N)', 'log₂ 1001 ≈ 9.967', 'C ≈ 29.9 kbit/s'],
  params: [{ key: 'snDb', label: '信噪比（dB）', value: 30 }],
  chapter: 4,
  confidence: 0.9,
}

test('裸 JSON 直接解析', () => {
  assert.deepEqual(extractJson(JSON.stringify(GOOD)), GOOD)
})

test('```json 代码块包裹也能取出来', () => {
  const raw = '```json\n' + JSON.stringify(GOOD) + '\n```'
  assert.deepEqual(extractJson(raw), GOOD)
})

test('前后有杂字时取首尾花括号之间的内容', () => {
  const raw = `好，我算一下：\n${JSON.stringify(GOOD)}\n以上就是答案。`
  assert.deepEqual(extractJson(raw), GOOD)
})

test('完全不是 JSON 时返回 null，调用方必须给 error 而不是演示答案', () => {
  assert.equal(extractJson('抱歉，这张图看不清。'), null)
})

test('parseModelAnswer 把字段摊平成 AnswerOk，并带上置信度与章节', () => {
  const reply = parseModelAnswer(GOOD, { model: 'test-vl', ms: 1234, promptTokens: 900, completionTokens: 120 })
  assert.equal(reply.status, 'ok')
  if (reply.status !== 'ok') return
  assert.equal(reply.headline, GOOD.headline)
  assert.equal(reply.steps.length, 3)
  assert.equal(reply.meta.chapter, 4)
  assert.equal(reply.meta.confidence, 0.9)
  assert.equal(reply.meta.ms, 1234)
  assert.equal(reply.meta.transcript, GOOD.transcript)
})

test('缺 headline 或 steps 时返 error，绝不回退', () => {
  assert.equal(parseModelAnswer({ answer: '29.9 kbit/s' }).status, 'error')
  assert.equal(parseModelAnswer({ headline: 'x', steps: [] }).status, 'error')
  assert.equal(parseModelAnswer('不是对象').status, 'error')
})
