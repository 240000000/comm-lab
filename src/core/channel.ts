/**
 * AWGN 信道：加噪声、判决。
 *
 * 能量的口径在 src/core/qam.ts 里定死了：平均符号能量 Es = 1。
 * 于是给定每符号信噪比 Es/N0 = snrDb，两路噪声的方差各是
 * σ² = 1 / (2 · 10^(snrDb/10))：总噪声功率 N0 = 1/10^(snrDb/10) 摊到 I、Q 两路。
 *
 * 判决只做一件事：找欧氏距离最近的那个星座点。没有别的花活——
 * 一旦给判决加「就近但偏袒某个点」的规则，误码率曲线就跟理论对不上，
 * 而那种错误在没有对照的情况下根本看不出来。
 */
import type { QamPoint } from './qam.ts'
import type { Rng } from './rng.ts'

/**
 * 每符号信噪比（dB）对应的单路噪声标准差。
 *
 * snrDb = 10 → σ ≈ 0.2236（10^0.5 = 3.162，N0 = 0.3162，单路一半 = 0.1581，开方）。
 * snrDb = 0 → σ ≈ 0.7071。
 */
export function noiseSigma(snrDb: number): number {
  return Math.sqrt(1 / (2 * Math.pow(10, snrDb / 10)))
}

/**
 * 把一个接收点判给最近的星座点，返回点在数组里的下标。
 *
 * 距离相等时取下标更小的那个（先出现的赢）。这条规则是确定的，
 * 不是「随便挑一个」，所以同一组数据在任何机器上判出的结果一致。
 */
export function decide(i: number, q: number, points: QamPoint[]): number {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let k = 0; k < points.length; k += 1) {
    const di = i - points[k].i
    const dq = q - points[k].q
    const distance = di * di + dq * dq
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = k
    }
  }
  return bestIndex
}

/**
 * 在理想点上叠一路高斯噪声。
 *
 * 返回新对象，不改传进来的点。
 */
export function addNoise(
  point: { i: number; q: number },
  sigma: number,
  rng: Rng,
): { i: number; q: number } {
  return {
    i: point.i + sigma * rng.gauss(),
    q: point.q + sigma * rng.gauss(),
  }
}
