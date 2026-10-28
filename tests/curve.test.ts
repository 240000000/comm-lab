import assert from 'node:assert/strict'
import test from 'node:test'
import { sweepBer } from '../src/core/curve.ts'
import { bitsPerSymbol } from '../src/core/qam.ts'

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

// ---------- 换阶数：整条曲线按新阶数重扫 ----------

test('四阶各自扫满 21 点，比特分母 = 20000 × bitsPerSymbol', () => {
  for (const order of [2, 4, 16, 64]) {
    const points = sweepBer({ order, fromDb: 0, toDb: 20, stepDb: 1, symbolCount: SYMBOLS, seed: SEED })
    assert.equal(points.length, 21)
    assert.equal(points[0].snrDb, 0)
    assert.equal(points[20].snrDb, 20)
    for (const point of points) {
      assert.equal(point.bitCount, SYMBOLS * bitsPerSymbol(order))
    }
  }
})

test('四阶的实测点与理论在同一带状内（只看理论值 1e-3–1e-1 的可比点）', () => {
  for (const order of [2, 4, 16, 64]) {
    const points = sweepBer({ order, fromDb: 0, toDb: 20, stepDb: 1, symbolCount: SYMBOLS, seed: SEED })
    const comparable = points.filter((point) => point.theory >= 1e-3 && point.theory <= 1e-1)
    assert.ok(comparable.length >= 1, `${order}QAM 没有落在可比区间的点`)
    for (const point of comparable) {
      const ratio = point.ber / point.theory
      assert.ok(
        ratio > 0.7 && ratio < 1.6,
        `${order}QAM ${point.snrDb} dB：实测 ${point.ber}，理论 ${point.theory}，比值 ${ratio}`,
      )
    }
  }
})

test('换阶数不是给旧点改标题：16QAM 与 64QAM 的曲线数值不同', () => {
  const sixteen = sweepBer({ order: 16, fromDb: 0, toDb: 20, stepDb: 1, symbolCount: SYMBOLS, seed: SEED })
  const sixtyFour = sweepBer({ order: 64, fromDb: 0, toDb: 20, stepDb: 1, symbolCount: SYMBOLS, seed: SEED })
  assert.notDeepEqual(sixteen.map((point) => point.ber), sixtyFour.map((point) => point.ber))
  assert.notDeepEqual(sixteen.map((point) => point.theory), sixtyFour.map((point) => point.theory))
  assert.equal(sixteen[12].ber, 2331 / 80000)
  assert.notEqual(sixtyFour[12].ber, sixteen[12].ber)
})
