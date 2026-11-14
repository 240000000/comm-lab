import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ANSWER_BANK, pickProblem, problemByChapter, problemById } from '../src/answer/bank.ts'
import { channelCapacity } from '../src/core/course.ts'

test('示例题用 S/N = 30 dB，答案与 channelCapacity 复算一致', () => {
  const problem = problemByChapter(4)
  assert.ok(problem)
  assert.match(problem.prompt, /S\/N = 30 dB/)
  assert.doesNotMatch(problem.prompt, /S\/N₀/)

  // 题面给的是整段带宽上的总信噪比 S/N = 30 dB（1000 倍）；
  // channelCapacity 吃的是 1 kHz 参考带宽下的 S/N₀，先按 5 kHz 换算再复算。
  const snr0Db = 10 * Math.log10(1000 * 5)
  const expected = channelCapacity(5, snr0Db)
  assert.equal(Number(expected.toFixed(2)), 49.84)
  assert.equal(Number(expected.toFixed(1)), 49.8)

  const capacityParam = problem.answer.params.find((param) => param.key === 'capacityKbit')
  assert.ok(capacityParam)
  assert.equal(capacityParam.value, 49.8)
  assert.equal(Number(expected.toFixed(1)), capacityParam.value)
})

test('3 kHz 那道题照旧是 29.9，只是不带 preset', () => {
  const problem = problemById('capacity-3k')
  assert.ok(problem)
  assert.match(problem.prompt, /3 kHz/)
  assert.equal(problem.answer.preset, undefined)
  const capacityParam = problem.answer.params.find((param) => param.key === 'capacityKbit')
  assert.ok(capacityParam)
  assert.equal(capacityParam.value, 29.9)
})

test('同章两题按题面带宽挑，3 kHz 不会被挑成 5 kHz 那题', () => {
  assert.equal(pickProblem('带宽为 3 kHz', 4)?.id, 'capacity-3k')
  assert.equal(pickProblem('带宽为 5 kHz', 4)?.id, 'capacity')
  assert.equal(pickProblem('看不出带宽', 4)?.id, 'capacity')
})

test('每题都带一行公式出处，答案卡直接显示', () => {
  for (const problem of ANSWER_BANK) {
    assert.ok(problem.formula.length > 0, `${problem.id} 缺 formula`)
  }
  assert.match(problemByChapter(4)!.formula, /C = B log₂\(1 \+ S\/N\)/)
})
