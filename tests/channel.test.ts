import assert from 'node:assert/strict'
import test from 'node:test'
import { addNoise, decide, noiseSigma } from '../src/core/channel.ts'
import { buildConstellation } from '../src/core/qam.ts'
import { createRng } from '../src/core/rng.ts'

const points16 = buildConstellation(16)

test('噪声标准差：0 dB 时单路方差为 1/2，即 sigma = 1/√2', () => {
  assert.ok(Math.abs(noiseSigma(0) - Math.SQRT1_2) < 1e-12)
})

test('噪声标准差：10 dB 时 sigma = √(1/20)', () => {
  assert.ok(Math.abs(noiseSigma(10) - Math.sqrt(1 / 20)) < 1e-12)
})

test('噪声标准差：信噪比越高，sigma 越小', () => {
  assert.ok(noiseSigma(0) > noiseSigma(10))
  assert.ok(noiseSigma(10) > noiseSigma(20))
})

test('判决：接收点正好落在理想点上时，判回它自己', () => {
  for (let index = 0; index < points16.length; index += 1) {
    const point = points16[index]
    assert.equal(decide(point.i, point.q, points16), index)
  }
})

test('判决：稍微偏一点点，仍然判回原来的点', () => {
  for (let index = 0; index < points16.length; index += 1) {
    const point = points16[index]
    const offset = 0.05 // 这里最小的点间距是 0.632，0.05 远小于半个间距
    assert.equal(decide(point.i + offset, point.q - offset, points16), index)
  }
})

test('判决：和暴力搜一遍最近点得到的结果完全一致', () => {
  const bruteForce = (i: number, q: number) => {
    let best = 0
    let bestDistance = Infinity
    for (let index = 0; index < points16.length; index += 1) {
      const d = (points16[index].i - i) ** 2 + (points16[index].q - q) ** 2
      if (d < bestDistance) {
        bestDistance = d
        best = index
      }
    }
    return best
  }

  for (let i = -1.4; i <= 1.4; i += 0.13) {
    for (let q = -1.4; q <= 1.4; q += 0.11) {
      assert.equal(decide(i, q, points16), bruteForce(i, q), `(${i.toFixed(2)}, ${q.toFixed(2)})`)
    }
  }
})

test('判决：到两个点一样近时，取下标小的那个（确定性的平手规则）', () => {
  // 原点到底部四个点等距，取下标最小者。
  const distances = points16.map((p) => Math.hypot(p.i, p.q))
  const nearest = Math.min(...distances)
  const expected = distances.findIndex((d) => Math.abs(d - nearest) < 1e-12)
  assert.equal(decide(0, 0, points16), expected)
})

test('加噪：sigma 为 0 时点不动，返回的是新对象而不是改原对象', () => {
  const rng = createRng(12345)
  const source = { i: 0.5, q: -0.25 }
  const noisy = addNoise(source, 0, rng)
  assert.deepEqual(noisy, { i: 0.5, q: -0.25 })
  assert.notEqual(noisy, source)
})
