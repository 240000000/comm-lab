import test from 'node:test'
import assert from 'node:assert/strict'

import { EYE_SAMPLES, EYE_TRACES, eyePointCount, eyePoints } from '../src/labs/eyePoints.ts'
import {
  SPECTRUM_BAND,
  SPECTRUM_TRACES,
  spectrumAmplitude,
  spectrumPoint,
  spectrumPointCount,
  spectrumPoints,
} from '../src/labs/spectrumPoints.ts'

test('两个形态的点数一模一样，下标才能逐帧对齐', () => {
  assert.equal(SPECTRUM_TRACES, EYE_TRACES)
  assert.equal(spectrumPointCount(), eyePointCount())
  assert.equal(spectrumPointCount(), EYE_TRACES * EYE_SAMPLES)
  const sp = spectrumPoints()
  const ep = eyePoints()
  assert.equal(sp.length, ep.length)
  assert.equal(sp.length, spectrumPointCount() * 3)
})

test('谱线与眼图用的是同一张网格：x、z 逐点相同，只有 y 换了含义', () => {
  const sp = spectrumPoints()
  const ep = eyePoints()
  let differ = 0
  for (let i = 0; i < sp.length; i += 3) {
    assert.equal(sp[i], ep[i], '横向必须同一列')
    assert.equal(sp[i + 2], ep[i + 2], '深度必须同一条迹')
    if (Math.abs(sp[i + 1] - ep[i + 1]) > 1e-6) differ += 1
  }
  assert.ok(differ > spectrumPointCount() / 2, '纵向应该换成了频谱幅度')
})

test('幅度归一化到与眼图同一量级：峰值接近 1，旁瓣依次衰减', () => {
  const sp = spectrumPoints()
  let maxAbs = 0
  for (let i = 1; i < sp.length; i += 3) maxAbs = Math.max(maxAbs, Math.abs(sp[i]))
  assert.ok(maxAbs <= 1.0 + 1e-6, `峰值不该超过 1，实测 ${maxAbs}`)
  assert.ok(maxAbs > 0.95, `峰值不该被压得太低，实测 ${maxAbs}`)
  // 主瓣中心 1，第一旁瓣约 −0.165，第二旁瓣约 +0.064，第三旁瓣约 −0.023。
  assert.ok(Math.abs(spectrumAmplitude(0) - 1) < 1e-12)
  const l1 = Math.abs(spectrumAmplitude(1.5))
  const l2 = Math.abs(spectrumAmplitude(2.5))
  const l3 = Math.abs(spectrumAmplitude(3.5))
  assert.ok(l1 > l2 && l2 > l3, `旁瓣要依次衰减，实测 ${l1} / ${l2} / ${l3}`)
  assert.ok(l1 < 0.2, '第一旁瓣不该太肥')
  // 旁瓣是正负交替的：一三负、二正。
  assert.ok(spectrumAmplitude(1.5) < 0 && spectrumAmplitude(2.5) > 0 && spectrumAmplitude(3.5) < 0)
  // 横轴能看到 ±SPECTRUM_BAND 个零点间距。
  assert.ok(SPECTRUM_BAND > 3, '至少要看得到第一旁瓣')
})

test('每条谱线的形状相同，只是沿深度错开', () => {
  const sp = spectrumPoints()
  const row = (trace: number) => trace * EYE_SAMPLES * 3
  const a = row(0)
  const b = row(SPECTRUM_TRACES - 1)
  for (let sample = 0; sample < EYE_SAMPLES; sample += 1) {
    assert.equal(sp[a + sample * 3 + 1], sp[b + sample * 3 + 1], '同列幅度必须一致')
  }
  assert.ok(sp[a + 2] < sp[b + 2], '两条谱线要在深度上分开')
})

test('spectrumPoint 与批量数组逐点一致', () => {
  const sp = spectrumPoints()
  for (const [trace, sample] of [
    [0, 0],
    [7, 33],
    [SPECTRUM_TRACES - 1, EYE_SAMPLES - 1],
  ] as const) {
    const p = spectrumPoint(trace, sample)
    const at = (trace * EYE_SAMPLES + sample) * 3
    assert.ok(Math.abs(sp[at] - p.x) < 1e-6)
    assert.ok(Math.abs(sp[at + 1] - p.y) < 1e-6)
    assert.ok(Math.abs(sp[at + 2] - p.z) < 1e-6)
  }
})
