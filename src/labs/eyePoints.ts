// 首页那两块粒子云的取点：一张升余弦滚降的三维眼图瀑布。
//
// 一条迹 = 一段从 −1 到 +1 个码元宽的时间窗，横向是时间相位（−1…+1），
// 纵向是左右各两个码元的脉冲尾巴叠出来的幅度；第 k 条迹沿深度方向等距排开，
// 于是 60 条迹摞成一堵会转的「眼图瀑布」。
//
// 这里只有取点，没有 DOM、没有 canvas、没有时间——node --test 可以直接加载。
// 数学与课程视图第 6 章同源（那边的 raisedCosine），滚降系数取第 6 章默认档 0.35。

export const EYE_TRACES = 60
export const EYE_SAMPLES = 100
export const EYE_ALPHA = 0.35
/** 深度方向的总跨度，与首页原来那条螺旋的落程同一量级。 */
export const EYE_SPAN = 1.4
/** 每侧参与叠加的相邻码元个数：窗口只要 ±1 个码元，±2 已经够脉冲收尾。 */
export const EYE_NEIGHBORS = 2

export type EyePoint = { x: number; y: number; z: number }

/** 升余弦滚降的单位脉冲响应，t 以码元周期为单位。 */
export function raisedCosinePulse(t: number): number {
  if (Math.abs(t) < 1e-9) return 1
  const x = 2 * EYE_ALPHA * t
  if (Math.abs(Math.abs(x) - 1) < 1e-9) {
    // t = ±1/(2α) 处分母为 0，这里取极限 π/4·sinc(1/(2α))，免得把 NaN 打进点云。
    const limit = 1 / (2 * EYE_ALPHA)
    return (Math.PI / 4) * (Math.sin(Math.PI * limit) / (Math.PI * limit))
  }
  const sinc = Math.sin(Math.PI * t) / (Math.PI * t)
  return (sinc * Math.cos(Math.PI * EYE_ALPHA * t)) / (1 - x * x)
}

/**
 * 第 trace 条迹上第 k 个码元取 +1 还是 −1。
 * 整数哈希定符号：60 条迹因此各有各的码型组合，转起来不是一张薄片。
 */
export function eyeSymbol(trace: number, k: number): number {
  let h = Math.imul(trace + 1, 0x9e3779b1) ^ Math.imul(k + 8, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35)
  h ^= h >>> 16
  return (h & 1) === 1 ? 1 : -1
}

/** 第 trace 条迹在第 sample 列上的叠加幅度（纵向）。 */
export function eyeAmplitude(trace: number, sample: number): number {
  const u = -1 + (2 * sample) / (EYE_SAMPLES - 1)
  let sum = 0
  for (let k = -EYE_NEIGHBORS; k <= EYE_NEIGHBORS; k += 1) {
    sum += eyeSymbol(trace, k) * raisedCosinePulse(u - k)
  }
  return sum
}

/** 第 trace 条迹（0…59）第 sample 列（0…99）落在三维里的哪个点。 */
export function eyePoint(trace: number, sample: number): EyePoint {
  return {
    x: -1 + (2 * sample) / (EYE_SAMPLES - 1),
    y: eyeAmplitude(trace, sample),
    z: (trace / (EYE_TRACES - 1) - 0.5) * EYE_SPAN,
  }
}

/** 总共多少个点（= 迹数 × 列数）。 */
export function eyePointCount(): number {
  return EYE_TRACES * EYE_SAMPLES
}

/** 一次算好全部点：[x, y, z, x, y, z, …]，画布那边逐帧只读不建。 */
export function eyePoints(): Float32Array {
  const out = new Float32Array(eyePointCount() * 3)
  let at = 0
  for (let trace = 0; trace < EYE_TRACES; trace += 1) {
    const z = (trace / (EYE_TRACES - 1) - 0.5) * EYE_SPAN
    for (let sample = 0; sample < EYE_SAMPLES; sample += 1) {
      out[at] = -1 + (2 * sample) / (EYE_SAMPLES - 1)
      out[at + 1] = eyeAmplitude(trace, sample)
      out[at + 2] = z
      at += 3
    }
  }
  return out
}
