/**
 * 理论误比特率：跟仿真结果对照用的那条虚线。
 *
 * 用的是方形 M-QAM 的标准近似式（格雷映射）：
 *
 *   Pb ≈ (4 / b) · (1 - 1/√M) · Q( √( 3b / (M-1) · Eb/N0 ) )
 *
 * 其中 b = log2 M 是每符号比特数，Eb/N0 = Es/N0 / b。
 * 它假设格雷映射下相邻符号错只错一个比特，所以是**近似**而不是精确值——
 * 低信噪比时实测会比这条线略高一点，曲线图上贴着走而不会完全重合。
 *
 * 本文件不依赖第三方库：互补误差函数用 Numerical Recipes 的拟合式，
 * 相对误差在 1.2e-7 以内，画图对照足够；浏览器和 Node 也都没有内置 Math.erfc。
 */

/** 互补误差函数 erfc(x)，Numerical Recipes 式 (7.1.26)。 */
function erfc(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + z / 2)
  const inner =
    1.00002368 +
    t *
      (0.37409196 +
        t *
          (0.09678418 +
            t *
              (-0.18628806 +
                t *
                  (0.27886807 +
                    t *
                      (-1.13520398 +
                        t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))
  const value = t * Math.exp(-z * z - 1.26551223 + t * inner)
  return x >= 0 ? value : 2 - value
}

/** 高斯 Q 函数：Q(x) = 0.5 · erfc(x / √2)。 */
export function qFunction(x: number): number {
  return 0.5 * erfc(x / Math.SQRT2)
}

/**
 * 给定阶数与每符号信噪比（dB），返回理论误比特率。
 *
 * 参数口径与 src/core/channel.ts 一致：snrDb 是 Es/N0，不是 Eb/N0。
 * 换算：Eb/N0 = Es/N0 / b，即 dB 上减 10·log10(b)。
 */
export function theoryBer(order: number, snrDb: number): number {
  const bitsPerSymbol = Math.log2(order)
  if (!Number.isInteger(bitsPerSymbol) || bitsPerSymbol < 1) {
    throw new RangeError(`不支持的 QAM 阶数：${order}`)
  }
  const ebn0 = Math.pow(10, (snrDb - 10 * Math.log10(bitsPerSymbol)) / 10)
  const argument = Math.sqrt(((3 * bitsPerSymbol) / (order - 1)) * ebn0)
  return ((4 / bitsPerSymbol) * (1 - 1 / Math.sqrt(order)) * qFunction(argument))
}
