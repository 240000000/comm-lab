import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MISSIONS,
  NUMERIC_SEED,
  NUMERIC_SNR_DB,
  NUMERIC_SYMBOLS,
  NUMERIC_TOLERANCE,
  abilityRemainingErrors,
  gradeMission,
  gradeMissions,
  numericBer,
  phenomenonIntrusion,
  scoreMissions,
  type MissionAnswer,
} from '../src/core/missions.ts'
import { simulateAwgn } from '../src/core/metrics.ts'
import { runOfdm } from '../src/core/ofdm.ts'

const byId = (id: string) => {
  const mission = MISSIONS.find((item) => item.id === id)
  assert.ok(mission, `题库里应该有 ${id}`)
  return mission
}

test('五道题，题型不重样', () => {
  assert.equal(MISSIONS.length, 5)
  const kinds = MISSIONS.map((mission) => mission.kind).sort()
  assert.deepEqual(kinds, ['ability', 'concept', 'numeric', 'phenomenon', 'selection'])
})

test('数值题的期望值就是仿真现算的那个数，不是手抄', () => {
  const mission = byId('numeric')
  const fresh = simulateAwgn({
    order: 16,
    snrDb: NUMERIC_SNR_DB,
    symbolCount: NUMERIC_SYMBOLS,
    seed: NUMERIC_SEED,
    keepSamples: false,
  })
  assert.equal(mission.expected, numericBer())
  assert.equal(mission.expected, fresh.ber)
  assert.ok(Math.abs((mission.expected as number) - 0.0291375) < 1e-12)
})

test('数值题容差 ±10%：贴边算对，出界算错', () => {
  const mission = byId('numeric')
  const expected = mission.expected as number
  assert.equal(mission.tolerance, NUMERIC_TOLERANCE)

  const inside = gradeMission(mission, expected * 1.09)
  const outside = gradeMission(mission, expected * 1.11)
  assert.equal(inside.correct, true)
  assert.equal(outside.correct, false)

  const lowInside = gradeMission(mission, expected * 0.91)
  const lowOutside = gradeMission(mission, expected * 0.89)
  assert.equal(lowInside.correct, true)
  assert.equal(lowOutside.correct, false)
})

test('数值题收字符串写法，科学计数法也认', () => {
  const mission = byId('numeric')
  assert.equal(gradeMission(mission, '2.9e-2').correct, true)
  assert.equal(gradeMission(mission, 'abc').correct, false)
})

test('现象题的期望值就是 OFDM 仿真算出来的侵入采样数', () => {
  const mission = byId('phenomenon')
  const fresh = runOfdm({ cpLen: 16, delay: 21, symbolCount: 4, seed: 20261027 })
  assert.equal(mission.expected, phenomenonIntrusion())
  assert.equal(mission.expected, fresh.wave.intrudingSamples)
  assert.equal(mission.expected, 5)
})

test('能力题的期望值与卷积码页关噪声、翻四位之后的读数一致', () => {
  const mission = byId('ability')
  assert.equal(mission.expected, abilityRemainingErrors())
  assert.equal(mission.expected, 1)
  assert.equal(gradeMission(mission, 1).correct, true)
  assert.equal(gradeMission(mission, 3).correct, false)
})

test('概念题与选型题的答案在数据里，判分照数据走', () => {
  assert.equal(byId('concept').expected, '不能')
  assert.equal(byId('selection').expected, '不行')
  assert.equal(gradeMission(byId('concept'), '不能').correct, true)
  assert.equal(gradeMission(byId('concept'), '能').correct, false)
  assert.equal(gradeMission(byId('selection'), '不行').correct, true)
  assert.equal(gradeMission(byId('selection'), '行').correct, false)
})

test('边界一：五题全对是五比五', () => {
  const answers: Record<string, MissionAnswer | null> = {}
  for (const mission of MISSIONS) answers[mission.id] = mission.expected
  const grades = gradeMissions(answers)
  const score = scoreMissions(grades)
  assert.equal(score.correct, 5)
  assert.equal(score.total, 5)
  assert.equal(score.allCorrect, true)
})

test('边界二：五题全错是零比五', () => {
  const wrong: Record<string, MissionAnswer> = {
    numeric: 1,
    phenomenon: 0,
    ability: 5,
    concept: '能',
    selection: '行',
  }
  const grades = gradeMissions(wrong)
  const score = scoreMissions(grades)
  assert.equal(score.correct, 0)
  assert.equal(score.total, 5)
  assert.equal(score.allCorrect, false)
  assert.ok(grades.every((grade) => grade.correct === false))
})

test('一道题没填：判错，但理由说清是「还没填」而不是「答错」', () => {
  const grade = gradeMission(byId('numeric'), null)
  assert.equal(grade.correct, false)
  assert.match(grade.reason, /还没填/)
})

test('判分是纯函数：同一份答案判两遍结果一样，且不改输入', () => {
  const answers: Record<string, MissionAnswer> = { numeric: 0.0291, concept: '不能', selection: '不行' }
  const snapshot = JSON.stringify(answers)
  const first = JSON.stringify(gradeMissions(answers))
  const second = JSON.stringify(gradeMissions(answers))
  assert.equal(first, second)
  assert.equal(JSON.stringify(answers), snapshot)
})
