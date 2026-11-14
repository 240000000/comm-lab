import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ANSWER_BANK, problemByChapter } from '../src/answer/bank.ts'
import { channelCapacity } from '../src/core/course.ts'

test('示例题用 S/N = 30 dB，答案与 channelCapacity 复算一致', () => {
  const problem = problemByChapter(4)
  assert.ok(problem)
  assert.match(problem.prompt, /S\/N = 30 dB/)
  assert.doesNotMatch(problem.prompt, /S\/N₀/)

  // 题面给的是整段带宽上的总信噪比 S/N = 30 dB（1000 倍）；
  // channelCapacity 吃的是 1 kHz 参考带宽下的 S/N₀，先按 3 kHz 换算再复算。
  const snr0Db = 10 * Math.log10(1000 * 3)
  const expected = channelCapacity(3, snr0Db)
  assert.equal(Number(expected.toFixed(2)), 29.9)
  assert.equal(Number(expected.toFixed(1)), 29.9)

  const capacityParam = problem.answer.params.find((param) => param.key === 'capacityKbit')
  assert.ok(capacityParam)
  assert.equal(capacityParam.value, 29.9)
  assert.equal(Number(expected.toFixed(1)), capacityParam.value)
})

test('每题都带一行公式出处，答案卡直接显示', () => {
  for (const problem of ANSWER_BANK) {
    assert.ok(problem.formula.length > 0, `${problem.id} 缺 formula`)
  }
  assert.match(problemByChapter(4)!.formula, /C = B log₂\(1 \+ S\/N\)/)
})
