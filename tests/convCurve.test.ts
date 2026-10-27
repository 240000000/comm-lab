/**
 * 三条线（不编码 / 硬判决 / 软判决）的扫描测试。
 *
 * 重点不是数字精确等于多少，而是形状与关系对不对：
 * 每个点都真的用同一规模样本算出来、曲线随信噪比下降、软判决确实赢、
 * 以及同一颗种子重跑完全一致。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sweepConv } from '../src/core/convCurve.ts'

const SWEEP = sweepConv({ fromDb: 0, toDb: 6, stepDb: 1, bits: 2000, seed: 20261027 })

describe('扫描出来的三条线', () => {
  it('点数与端点对得上', () => {
    assert.equal(SWEEP.length, 7)
    assert.equal(SWEEP[0].ebN0, 0)
    assert.equal(SWEEP.at(-1)?.ebN0, 6)
  })

  it('每个点都标着自己的分母', () => {
    for (const point of SWEEP) {
      assert.equal(point.bits, 2000)
      assert.ok(point.uncodedErrors <= point.bits)
      assert.ok(point.hardErrors <= point.bits)
      assert.ok(point.softErrors <= point.bits)
    }
  })

  it('三条线整体随信噪比下降（不要求每一步都严格下降）', () => {
    const first = SWEEP[0]
    const last = SWEEP.at(-1)!
    assert.ok(first.uncoded > last.uncoded)
    assert.ok(first.hard > last.hard)
    assert.ok(first.soft > last.soft)
  })

  it('软判决在低信噪比明显好于硬判决——几乎重合就报错', () => {
    const low = SWEEP[1]
    assert.ok(low.hardErrors > 0 && low.softErrors > 0, '低信噪比两点都该有错')
    assert.ok(
      low.soft < low.hard / 2,
      `软判决 ${low.soft} 与硬判决 ${low.hard} 贴得太近，软信息可能没进度量`,
    )
  })

  it('不编码实测与理论同数量级', () => {
    for (const point of SWEEP) {
      if (point.uncodedErrors < 20) continue // 样本太少的位置不比倍数
      const ratio = point.uncoded / point.theory
      assert.ok(ratio > 0.3 && ratio < 3, `${point.ebN0} dB 实测/理论 = ${ratio}`)
    }
  })

  it('同一颗种子重跑，整条曲线逐点相同', () => {
    const again = sweepConv({ fromDb: 0, toDb: 6, stepDb: 1, bits: 2000, seed: 20261027 })
    assert.deepEqual(again, SWEEP)
  })

  it('非法参数直接抛错，不静默给一条假曲线', () => {
    assert.throws(() => sweepConv({ fromDb: 0, toDb: 6, stepDb: 0, bits: 100, seed: 1 }), RangeError)
    assert.throws(() => sweepConv({ fromDb: 6, toDb: 0, stepDb: 1, bits: 100, seed: 1 }), RangeError)
    assert.throws(() => sweepConv({ fromDb: 0, toDb: 6, stepDb: 1, bits: 0, seed: 1 }), RangeError)
  })
})
