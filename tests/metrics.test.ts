import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveSeed, simulateAwgn } from '../src/core/metrics.ts'
import { theoryBer } from '../src/core/ber.ts'
import { bitsPerSymbol } from '../src/core/qam.ts'

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

// ---------- 四个阶数：EVM 不变、BER 变、BPSK 的 SER=BER ----------

test('同一信噪比下四阶 EVM 完全相等（噪声只看 Es/N0，与阶数无关）', () => {
  const base = simulateAwgn({ order: 2, snrDb: 12, symbolCount: SYMBOLS, seed: SEED }).evmPercent
  for (const order of [4, 16, 64]) {
    const stats = simulateAwgn({ order, snrDb: 12, symbolCount: SYMBOLS, seed: SEED })
    assert.equal(stats.evmPercent, base, `${order}QAM 的 EVM 跟 BPSK 不一致`)
  }
  // 12 dB 时 N0 = 1e-1.2，EVM 应逼近 √N0 = 25.12%，样本均值的误差在 1% 以内。
  assert.ok(Math.abs(base / (Math.sqrt(Math.pow(10, -12 / 10)) * 100) - 1) < 0.01, `EVM=${base}`)
})

test('同种子同信噪比，四阶的 BER 互不相同（确实按阶数重算）', () => {
  const bers = [2, 4, 16, 64].map(
    (order) => simulateAwgn({ order, snrDb: 8, symbolCount: SYMBOLS, seed: SEED }).ber,
  )
  assert.equal(new Set(bers).size, 4, `四阶 BER 出现重复：${bers.join(', ')}`)
})

test('BPSK 每符号 1 比特：SER 与 BER 严格相等，分母也相等', () => {
  const stats = simulateAwgn({ order: 2, snrDb: 8, symbolCount: SYMBOLS, seed: SEED })
  assert.equal(stats.bitCount, stats.symbolCount)
  assert.equal(stats.symbolErrors, stats.bitErrors)
  assert.equal(stats.ser, stats.ber)
  assert.ok(stats.symbolErrors > 0, '这个点应该有错，否则相等没有说服力')
})

test('每阶的比特分母 = 符号数 × bitsPerSymbol', () => {
  for (const order of [2, 4, 16, 64]) {
    const stats = simulateAwgn({ order, snrDb: 10, symbolCount: 2000, seed: SEED })
    assert.equal(stats.bitCount, 2000 * bitsPerSymbol(order))
  }
})

test('16QAM 的既有结果不因换阶数实现而漂移：12 dB 仍是 2331/80000', () => {
  const stats = simulateAwgn({ order: 16, snrDb: 12, symbolCount: SYMBOLS, seed: SEED })
  assert.equal(stats.bitErrors, 2331)
  assert.equal(stats.ber, 2331 / 80000)
})
