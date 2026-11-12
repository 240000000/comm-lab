import assert from 'node:assert/strict'
import test from 'node:test'

import { berTicks } from '../src/labs/berTicks.ts'

// 这一条是为 BerCurveChart 的横轴服务的：0–20 dB 上按 0.5 dB 采样，
// 刻度不能再跟着采样步长走（旧写法 (snr − from) % 4 会一根都不剩）。
test('BerCurve 横轴：0.5 dB 步长时刻度仍有 4 根以上，且首尾覆盖量程', () => {
  const points: number[] = []
  for (let db = 0; db <= 20.0001; db += 0.5) points.push(Number(db.toFixed(1)))
  assert.equal(points.length, 41)
  const ticks = berTicks(points[0], points[points.length - 1])
  assert.ok(ticks.length >= 4, `刻度只有 ${ticks.length} 根：${ticks.join(', ')}`)
  assert.ok(ticks[0] <= points[0] + 1e-9)
  assert.ok(ticks[ticks.length - 1] >= points[points.length - 1] - 1e-9)
  // 刻度必须是等距的整数倍，不能带出 0.5 这种碎步。
  const step = ticks[1] - ticks[0]
  assert.ok(step >= 1, `步长 ${step} 太碎`)
  for (let i = 1; i < ticks.length; i += 1) {
    assert.ok(Math.abs((ticks[i] - ticks[i - 1]) - step) < 1e-9)
  }
})

test('BerCurve 横轴：0–20 dB 与 0–12 dB 的刻度都由 niceTicks 定，且不画到量程外', () => {
  assert.deepEqual(berTicks(0, 20), [0, 5, 10, 15, 20])
  // 12 dB 量程 niceTicks 选 2.5 的步长（最接近 5 根），最后一根落在 10，不越过 12。
  const short = berTicks(0, 12)
  assert.deepEqual(short, [0, 2.5, 5, 7.5, 10])
  for (const tick of short) assert.ok(tick >= 0 && tick <= 12)
})
