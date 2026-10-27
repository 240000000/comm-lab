import assert from 'node:assert/strict'
import test from 'node:test'
import { sweepBer } from '../src/core/curve.ts'

const ORDER = 16
const SYMBOLS = 20000
const SEED = 20261027

const sweep = () =>
  sweepBer({ order: ORDER, fromDb: 0, toDb: 20, stepDb: 1, symbolCount: SYMBOLS, seed: SEED })

test('扫描 0–20 dB、步长 1：正好 21 个点，端点正确', () => {
  const points = sweep()
  assert.equal(points.length, 21)
  assert.equal(points[0].snrDb, 0)
  assert.equal(points[20].snrDb, 20)
})

test('每个信噪比点的分母一致：2 万符号 × 4 比特 = 8 万比特', () => {
  for (const point of sweep()) {
    assert.equal(point.bitCount, SYMBOLS * 4)
    assert.ok(point.bitErrors >= 0 && point.bitErrors <= point.bitCount)
    assert.equal(point.ber, point.bitErrors / point.bitCount)
  }
})

test('曲线单调下降：信噪比越高，误比特率越低', () => {
  const points = sweep()
  for (let k = 1; k < points.length; k += 1) {
    assert.ok(
      points[k].ber <= points[k - 1].ber,
      `${points[k - 1].snrDb} → ${points[k].snrDb} 的误比特率没有下降`,
    )
  }
})

test('高信噪比尾部：某个点一个比特都没错（界面上要画成空心点），但理论值仍然大于 0', () => {
  const points = sweep()
  const last = points[points.length - 1]
  assert.equal(last.bitErrors, 0)
  assert.ok(last.theory > 0)
})

test('非法参数：步长为 0 或负数、终点小于起点都抛 RangeError', () => {
  assert.throws(
    () => sweepBer({ order: ORDER, fromDb: 0, toDb: 20, stepDb: 0, symbolCount: 100, seed: 1 }),
    RangeError,
  )
  assert.throws(
    () => sweepBer({ order: ORDER, fromDb: 20, toDb: 0, stepDb: 1, symbolCount: 100, seed: 1 }),
    RangeError,
  )
})
