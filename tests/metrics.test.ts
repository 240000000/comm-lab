import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveSeed, simulateAwgn } from '../src/core/metrics.ts'
import { theoryBer } from '../src/core/ber.ts'

const ORDER = 16
const SYMBOLS = 20000
const SEED = 20261027

test('同种子同信噪比：跑两次，每一个统计量都逐位相同', () => {
  const a = simulateAwgn({ order: ORDER, snrDb: 12, symbolCount: SYMBOLS, seed: SEED })
  const b = simulateAwgn({ order: ORDER, snrDb: 12, symbolCount: SYMBOLS, seed: SEED })
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

test('换种子：统计结果随之改变（不是永远同一组数）', () => {
  const a = simulateAwgn({ order: ORDER, snrDb: 8, symbolCount: SYMBOLS, seed: SEED })
  const b = simulateAwgn({ order: ORDER, snrDb: 8, symbolCount: SYMBOLS, seed: SEED + 1 })
  assert.notEqual(a.seedUsed, b.seedUsed)
  assert.ok(a.bitErrors !== b.bitErrors || a.evmPercent !== b.evmPercent)
})

test('高信噪比（20 dB）：2 万个符号里基本不出错', () => {
  const stats = simulateAwgn({ order: ORDER, snrDb: 20, symbolCount: SYMBOLS, seed: SEED })
  assert.equal(stats.bitErrors, 0)
  assert.ok(stats.ber === 0)
})

test('低信噪比（0 dB）比 10 dB 错得明显多', () => {
  const low = simulateAwgn({ order: ORDER, snrDb: 0, symbolCount: SYMBOLS, seed: SEED })
  const mid = simulateAwgn({ order: ORDER, snrDb: 10, symbolCount: SYMBOLS, seed: SEED })
  assert.ok(low.ber > mid.ber * 3, `0 dB: ${low.ber}，10 dB: ${mid.ber}`)
})

test('实测误比特率与理论值在同一数量级（差不到 3 倍）', () => {
  for (const snrDb of [8, 10, 12, 14]) {
    const stats = simulateAwgn({ order: ORDER, snrDb, symbolCount: SYMBOLS, seed: SEED })
    const theory = theoryBer(ORDER, snrDb)
    const ratio = stats.ber / theory
    assert.ok(ratio > 1 / 3 && ratio < 3, `${snrDb} dB：实测 ${stats.ber}，理论 ${theory}，比值 ${ratio}`)
  }
})

test('实际使用的种子 = deriveSeed(种子, 信噪比)，且随信噪比变化', () => {
  const stats = simulateAwgn({ order: ORDER, snrDb: 7.5, symbolCount: 500, seed: SEED })
  assert.equal(stats.seedUsed, deriveSeed(SEED, 7.5))
  assert.notEqual(deriveSeed(SEED, 7.5), deriveSeed(SEED, 8))
})

test('EVM：20 dB 时点云很紧，0 dB 时几乎糊满整个平面', () => {
  const clean = simulateAwgn({ order: ORDER, snrDb: 20, symbolCount: SYMBOLS, seed: SEED })
  const noisy = simulateAwgn({ order: ORDER, snrDb: 0, symbolCount: SYMBOLS, seed: SEED })
  assert.ok(clean.evmPercent < 15, `20 dB EVM = ${clean.evmPercent}`)
  assert.ok(noisy.evmPercent > 50, `0 dB EVM = ${noisy.evmPercent}`)
})

test('分母口径：比特数 = 符号数 × 每符号比特数，点云数量与符号数一致', () => {
  const stats = simulateAwgn({ order: ORDER, snrDb: 12, symbolCount: 2000, seed: SEED })
  assert.equal(stats.bitCount, 2000 * 4)
  assert.equal(stats.received.length, 2000)
  assert.equal(stats.decided.length, 2000)
  assert.equal(stats.ser, stats.symbolErrors / 2000)
  assert.equal(stats.ber, stats.bitErrors / stats.bitCount)
})

test('keepSamples=false：不存点云，但统计数字与存点云时完全一样', () => {
  const withSamples = simulateAwgn({ order: ORDER, snrDb: 9, symbolCount: 4000, seed: SEED })
  const without = simulateAwgn({
    order: ORDER,
    snrDb: 9,
    symbolCount: 4000,
    seed: SEED,
    keepSamples: false,
  })
  assert.equal(without.received.length, 0)
  assert.equal(without.decided.length, 0)
  assert.equal(without.bitErrors, withSamples.bitErrors)
  assert.equal(without.symbolErrors, withSamples.symbolErrors)
  assert.equal(without.evmPercent, withSamples.evmPercent)
})

test('非法符号数：0、负数、小数都抛 RangeError', () => {
  for (const symbolCount of [0, -5, 1.5]) {
    assert.throws(
      () => simulateAwgn({ order: ORDER, snrDb: 10, symbolCount, seed: SEED }),
      RangeError,
    )
  }
})
