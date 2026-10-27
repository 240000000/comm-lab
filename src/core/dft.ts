/**
 * 按定义算的 DFT / IDFT。
 *
 * 这一版故意不写快速算法，就是照着公式：
 *   X[k] = Σ x[n] · e^(-j2πkn/N)
 *   x[n] = (1/N) Σ X[k] · e^(+j2πkn/N)
 * 好处是除了「怎么解释公式」以外没有别的东西可以出错，测试里能直接和定义对；
 * 坏处是 O(N²)——64 点一次 4096 次复数乘加，网页上够用，所以先这样。
 *
 * 旋转因子按 N 缓存一张表：角度只可能是 2π·m/N 的整数倍，
 * 同一张表反复查，比每次现算 Math.cos/Math.sin 快，也不会引入额外误差。
 */

export type Complex = { re: number; im: number }

type Twiddles = { cos: Float64Array; sin: Float64Array }

const TWO_PI = Math.PI * 2
const twiddleCache = new Map<number, Twiddles>()

/** 取 N 点旋转因子表：table.cos[m] = cos(2πm/N)，table.sin[m] = sin(2πm/N)。 */
function twiddles(n: number): Twiddles {
  const cached = twiddleCache.get(n)
  if (cached) return cached

  const cos = new Float64Array(n)
  const sin = new Float64Array(n)
  for (let m = 0; m < n; m++) {
    const angle = (TWO_PI * m) / n
    cos[m] = Math.cos(angle)
    sin[m] = Math.sin(angle)
  }
  const table = { cos, sin }
  twiddleCache.set(n, table)
  return table
}

/** 正变换：X[k] = Σ x[n]·e^(-j2πkn/N)。长度必须是 2 的幂且 ≥ 2。 */
export function dft(input: Complex[]): Complex[] {
  const n = input.length
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new RangeError(`DFT 长度必须是 2 的幂且不小于 2，收到 ${n}`)
  }

  const { cos, sin } = twiddles(n)
  const out: Complex[] = new Array(n)

  for (let k = 0; k < n; k++) {
    let re = 0
    let im = 0
    for (let t = 0; t < n; t++) {
      // 负频率：e^(-jθ) = cosθ - j·sinθ
      const m = (k * t) % n
      const c = cos[m]
      const s = -sin[m]
      const xr = input[t].re
      const xi = input[t].im
      re += xr * c - xi * s
      im += xr * s + xi * c
    }
    out[k] = { re, im }
  }

  return out
}

/** 反变换：x[n] = (1/N)·Σ X[k]·e^(+j2πkn/N)。 */
export function idft(input: Complex[]): Complex[] {
  const n = input.length
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new RangeError(`IDFT 长度必须是 2 的幂且不小于 2，收到 ${n}`)
  }

  const { cos, sin } = twiddles(n)
  const out: Complex[] = new Array(n)

  for (let k = 0; k < n; k++) {
    let re = 0
    let im = 0
    for (let t = 0; t < n; t++) {
      // 正频率：e^(+jθ) = cosθ + j·sinθ
      const m = (k * t) % n
      const c = cos[m]
      const s = sin[m]
      const xr = input[t].re
      const xi = input[t].im
      re += xr * c - xi * s
      im += xr * s + xi * c
    }
    out[k] = { re: re / n, im: im / n }
  }

  return out
}
