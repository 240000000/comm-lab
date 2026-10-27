/**
 * 一次「发—加噪—判」的统计。
 *
 * 这里把信道实验要用的数一次算完：收到多少个点、错了多少符号、错了多少比特、
 * 点云偏离理想位置多远（EVM）。界面只负责显示，不再自己算，避免两处口径不一致。
 *
 * **分母是显式的**：每个统计量都同时返回样本数（symbolCount、bitCount），
 * 界面上必须把分母写出来。「误码率 1e-5」这种没有分母的数字，
 * 在 2,000 个符号和 200,000 个符号下意味着完全不同的可信度。
 */
import { addNoise, decide, noiseSigma } from './channel.ts'
import { buildConstellation } from './qam.ts'
import type { QamPoint } from './qam.ts'
import { createRng } from './rng.ts'

export type Sample = { i: number; q: number }

export type Stats = {
  /** 发了多少个符号。 */
  symbolCount: number
  /** 每个符号几个比特。 */
  bitsPerSymbol: number
  /** 一共比对了多少个比特。 */
  bitCount: number
  /** 判错的符号数。 */
  symbolErrors: number
  /** 判错的比特数（格雷码下相邻符号错通常只错一位）。 */
  bitErrors: number
  /** 误符号率 = symbolErrors / symbolCount。 */
  ser: number
  /** 误比特率 = bitErrors / bitCount。 */
  ber: number
  /** 误差向量幅度，百分比：rms(接收 - 理想) / rms(理想)。理想点平均能量为 1，所以分母是 1。 */
  evmPercent: number
  /** 接收点（keepSamples 为 false 时是空数组）。 */
  received: Sample[]
  /** 每个接收点被判到的星座点下标。 */
  decided: number[]
  /** 实际用的种子（由 seed 与 snrDb 派生，界面要显示它）。 */
  seedUsed: number
}

/**
 * 由「用户种子 + 信噪比」派生出这一次真正用的种子。
 *
 * 为什么要掺 snrDb：滑块每动一格就换一个噪声实现，点云才会跟着变；
 * 但只要用户种子和信噪比都没变，派生出来的种子就一模一样，
 * 统计数字也就完全可复现。混入用 32 位整数哈希（murmur3 的混合步骤），
 * 不用 Math.random，也不用时间戳。
 */
export function deriveSeed(seed: number, snrDb: number): number {
  let x = (seed ^ Math.round(snrDb * 10)) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}

/** 两个等长比特串之间不同的位数。 */
function hammingDistance(a: string, b: string): number {
  let diff = 0
  for (let k = 0; k < a.length; k += 1) {
    if (a[k] !== b[k]) diff += 1
  }
  return diff
}

/**
 * 跑一次 AWGN 链路。
 *
 * 发送符号在星座点里等概率随机抽（每个符号各自抽一次），
 * 所以 2,000 个符号并不意味着每个点正好 125 次——这点随机性正是要展示的。
 *
 * keepSamples=false 时只统计、不保存点，扫描曲线时用：曲线有 21 个点、
 * 每点 20,000 个符号，全存下来是四十多万个对象，白白占内存。
 */
export function simulateAwgn(options: {
  order: number
  snrDb: number
  symbolCount: number
  seed: number
  keepSamples?: boolean
}): Stats {
  const { order, snrDb, symbolCount, seed, keepSamples = true } = options
  if (!Number.isInteger(symbolCount) || symbolCount < 1) {
    throw new RangeError(`符号数必须是正整数：${symbolCount}`)
  }

  const points: QamPoint[] = buildConstellation(order)
  const bitsPerSymbol = points[0].bits.length
  const seedUsed = deriveSeed(seed, snrDb)
  const rng = createRng(seedUsed)
  const sigma = noiseSigma(snrDb)

  const received: Sample[] = []
  const decided: number[] = []
  let symbolErrors = 0
  let bitErrors = 0
  let squaredError = 0

  for (let n = 0; n < symbolCount; n += 1) {
    const sentIndex = Math.floor(rng.next() * points.length)
    const sent = points[sentIndex]
    const rx = addNoise(sent, sigma, rng)
    const decidedIndex = decide(rx.i, rx.q, points)

    if (decidedIndex !== sentIndex) symbolErrors += 1
    if (decidedIndex !== sentIndex) {
      bitErrors += hammingDistance(sent.bits, points[decidedIndex].bits)
    }
    squaredError += (rx.i - sent.i) ** 2 + (rx.q - sent.q) ** 2

    if (keepSamples) {
      received.push(rx)
      decided.push(decidedIndex)
    }
  }

  const bitCount = symbolCount * bitsPerSymbol
  return {
    symbolCount,
    bitsPerSymbol,
    bitCount,
    symbolErrors,
    bitErrors,
    ser: symbolErrors / symbolCount,
    ber: bitErrors / bitCount,
    evmPercent: Math.sqrt(squaredError / symbolCount) * 100,
    received,
    decided,
    seedUsed,
  }
}
