import test from 'node:test'
import assert from 'node:assert/strict'

import {
  EYE_ALPHA,
  EYE_SAMPLES,
  EYE_SPAN,
  EYE_TRACES,
  eyeAmplitude,
  eyePoint,
  eyePointCount,
  eyePoints,
  eyeSymbol,
  raisedCosinePulse,
} from '../src/labs/eyePoints.ts'

test('眼图点数：60 条迹 × 100 列，一次算成 18000 个 float', () => {
  assert.equal(EYE_TRACES, 60)
  assert.equal(EYE_SAMPLES, 100)
  assert.equal(eyePointCount(), 6000)
  assert.equal(eyePoints().length, 6000 * 3)
})

test('横向是时间相位：每条迹都从 −1 走到 +1，步长均匀', () => {
  const points = eyePoints()
  const step = 2 / (EYE_SAMPLES - 1)
  for (const trace of [0, 17, EYE_TRACES - 1]) {
    const base = trace * EYE_SAMPLES * 3
    assert.ok(Math.abs(points[base] + 1) < 1e-6)
    assert.ok(Math.abs(points[base + (EYE_SAMPLES - 1) * 3] - 1) < 1e-6)
    assert.ok(Math.abs(points[base + 3] - points[base] - step) < 1e-6)
  }
})

test('深度方向：60 条迹等距排开，首尾正好是 ±EYE_SPAN/2', () => {
  const points = eyePoints()
  const step = EYE_SPAN / (EYE_TRACES - 1)
  assert.ok(Math.abs(points[2] + EYE_SPAN / 2) < 1e-6)
  assert.ok(Math.abs(points[(EYE_TRACES - 1) * EYE_SAMPLES * 3 + 2] - EYE_SPAN / 2) < 1e-6)
  for (let trace = 1; trace < EYE_TRACES; trace += 1) {
    const prev = points[(trace - 1) * EYE_SAMPLES * 3 + 2]
    const now = points[trace * EYE_SAMPLES * 3 + 2]
    assert.ok(Math.abs(now - prev - step) < 1e-6)
  }
})

test('码元中心处眼睛是张开的：60 条迹都聚在 ±1 附近，没有落在 0 附近', () => {
  const center = EYE_SAMPLES / 2
  for (let trace = 0; trace < EYE_TRACES; trace += 1) {
    const value = eyeAmplitude(trace, center)
    assert.ok(Math.abs(value) > 0.9, `第 ${trace} 条迹中心列 ${value}`)
    assert.ok(Math.abs(value) < 1.2)
  }
})

test('升余弦脉冲：滚降系数 0.35，t=0 取 1、t=1 过零、t=0.5 在 0.6 以上', () => {
  assert.equal(EYE_ALPHA, 0.35)
  assert.equal(raisedCosinePulse(0), 1)
  assert.ok(Math.abs(raisedCosinePulse(1)) < 1e-6)
  assert.ok(raisedCosinePulse(0.5) > 0.6)
  // t = ±1/(2α) 是公式的极点，必须取到有限值而不是 NaN。
  const pole = raisedCosinePulse(1 / (2 * EYE_ALPHA))
  assert.ok(Number.isFinite(pole))
})

test('60 条迹的码型不止一种：至少分出 8 种组合，否则转起来是一张薄片', () => {
  const patterns = new Set<string>()
  for (let trace = 0; trace < EYE_TRACES; trace += 1) {
    patterns.add([-2, -1, 0, 1, 2].map((k) => eyeSymbol(trace, k)).join(','))
  }
  assert.ok(patterns.size >= 8, `只有 ${patterns.size} 种码型`)
})

test('多数迹穿过上下两支，剩下的趴在 ±1 两条横轨上——眼图本来就长这样', () => {
  const points = eyePoints()
  const swings: number[] = []
  let lowest = Infinity
  let highest = -Infinity
  for (let trace = 0; trace < EYE_TRACES; trace += 1) {
    let lo = Infinity
    let hi = -Infinity
    for (let sample = 0; sample < EYE_SAMPLES; sample += 1) {
      const value = points[(trace * EYE_SAMPLES + sample) * 3 + 1]
      lo = Math.min(lo, value)
      hi = Math.max(hi, value)
      lowest = Math.min(lowest, value)
      highest = Math.max(highest, value)
    }
    swings.push(hi - lo)
  }
  // 连着一串同号码元的那几条迹不会穿眼，只在自己的横轨上起伏——它们正是眼图的两条边。
  const crossing = swings.filter((swing) => swing > 2).length
  assert.ok(crossing >= 30, `只有 ${crossing} 条迹穿过中心`)
  assert.ok(lowest < -1.2 && highest > 1.2)
  assert.ok(lowest > -1.8 && highest < 1.8)
})

test('eyePoint 与批量数组逐点一致，关掉动效时静态一帧画的就是这批点', () => {
  const points = eyePoints()
  for (const [trace, sample] of [
    [0, 0],
    [13, 37],
    [EYE_TRACES - 1, EYE_SAMPLES - 1],
  ] as const) {
    const point = eyePoint(trace, sample)
    const at = (trace * EYE_SAMPLES + sample) * 3
    assert.ok(Math.abs(points[at] - point.x) < 1e-6)
    assert.ok(Math.abs(points[at + 1] - point.y) < 1e-6)
    assert.ok(Math.abs(points[at + 2] - point.z) < 1e-6)
  }
})
