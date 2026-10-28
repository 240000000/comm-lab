/**
 * 理论误比特率（虚线）的单测。
 *
 * 重点盯 BPSK：方阵 M-QAM 的近似式在 M=2 时不成立。下面这些参考值
 * 用 Python 的 math.erfc 现算（Q(x)=0.5·erfc(x/√2)），不走被测代码里的拟合式：
 * 0/4/8/10 dB 的 BPSK 是 7.864960e-2 / 1.250082e-2 / 1.909078e-4 / 3.872108e-6。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { theoryBer } from '../src/core/ber.ts'

/** 阶数 → [信噪比 dB, 理论 Q 值]；值见文件头，来自独立的 math.erfc。 */
const BPSK_REFERENCES: Array<[number, number]> = [
  [0, 0.07864960352514255],
  [4, 0.012500818040737565],
  [8, 0.00019090777407599314],
  [10, 3.872108215522048e-6],
]

const QPSK_REFERENCES: Array<[number, number]> = [
  [0, 0.15865525393145707],
  [4, 0.05649530174936167],
  [8, 0.006004386400163567],
  [12, 3.430262386641539e-5],
]

test('BPSK 与 Q(√(2·Eb/N0)) 对得上（独立参考值）', () => {
  for (const [snrDb, expected] of BPSK_REFERENCES) {
    const actual = theoryBer(2, snrDb)
    const relative = Math.abs(actual - expected) / expected
    assert.ok(relative < 1e-6, `${snrDb} dB：实际 ${actual}，参考 ${expected}，相对误差 ${relative}`)
  }
})

test('BPSK 在 0 dB 是 7.86e-2，不是旧近似式的 4.88e-2', () => {
  const actual = theoryBer(2, 0)
  assert.ok(Math.abs(actual - 0.0786496035) < 1e-6, `0 dB 实际 ${actual}`)
  assert.ok(actual > 0.07, 'BPSK 0 dB 的理论值不该低于 0.07——低于就说明又用回方阵 QAM 的近似式了')
})

test('QPSK 代数上等价于 Q(√(2·Eb/N0))，数值上也要对上', () => {
  for (const [snrDb, expected] of QPSK_REFERENCES) {
    const actual = theoryBer(4, snrDb)
    const relative = Math.abs(actual - expected) / expected
    assert.ok(relative < 1e-6, `${snrDb} dB：实际 ${actual}，参考 ${expected}，相对误差 ${relative}`)
  }
})

test('四阶理论值都随信噪比严格下降', () => {
  for (const order of [2, 4, 16, 64]) {
    let previous = Number.POSITIVE_INFINITY
    for (let snrDb = 0; snrDb <= 20; snrDb += 1) {
      const value = theoryBer(order, snrDb)
      assert.ok(value > 0, `${order}QAM ${snrDb} dB 理论值不为正：${value}`)
      assert.ok(value < previous, `${order}QAM 在 ${snrDb} dB 没有继续下降`)
      previous = value
    }
  }
})

test('非法阶数抛 RangeError，不返回 NaN', () => {
  for (const order of [0, 3, 2.5, Number.NaN]) {
    assert.throws(() => theoryBer(order, 10), RangeError, `阶数 ${order} 应该抛错`)
  }
})
