/**
 * 可复现的伪随机数。
 *
 * 用 mulberry32：状态是一个 32 位整数，全程只用整数运算（异或、移位、乘法），
 * 所以同一颗种子在任何机器、任何浏览器、任何 Node 版本上生成的序列逐位相同。
 * 这正是「同一个种子重跑一遍，数字必须一模一样」的地基——
 * 不依赖 Math.random()，那个既不能设种子，也没法复现。
 *
 * 高斯噪声用 Box–Muller 变换从均匀分布换出来，均值 0、方差 1。
 */

/** 一个随机源。 */
export type Rng = {
  /** [0, 1) 上的均匀分布。 */
  next(): number
  /** 标准正态分布，均值 0、方差 1。 */
  gauss(): number
}

/**
 * 用一颗种子建一个随机源。
 *
 * seed 会被截到无符号 32 位：传 0、-1、1e20 都是合法输入，
 * 但 1e20 和 1e20+2^32 会撞成同一颗种子（32 位状态装不下更多）。
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0
  let spare: number | null = null

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  function gauss(): number {
    // Box–Muller 一次出两个独立的正态数，第二个存起来下次用。
    if (spare !== null) {
      const value = spare
      spare = null
      return value
    }
    // u1 取 (0, 1]：next() 可能返回 0，而 log(0) 是 -Infinity。
    const u1 = 1 - next()
    const u2 = next()
    const radius = Math.sqrt(-2 * Math.log(u1))
    const theta = 2 * Math.PI * u2
    spare = radius * Math.sin(theta)
    return radius * Math.cos(theta)
  }

  return { next, gauss }
}
